import { tool } from "ai";
import { z } from "zod";
import { runInTab, readTabPage } from "./active-tab";
import {
  fillElement,
  selectElement,
  checkElement,
  clickElement,
  describeClickTarget,
} from "./page-actions";
import { highlightElement } from "./highlight";
import { scrollPage, doubleClickElement, dragElement } from "./page-gestures";
import { getTab, listTabs, openTab, switchTab, closeTab } from "./tabs";
import type { RunContext } from "./run-context";
const tab = z.number().int().optional();
export interface ApprovalDetails {
  tabId: number;
  tabTitle?: string;
  label?: string;
  submit?: boolean;
  targetLabel?: string;
}
const approvals = new Map<string, ApprovalDetails>();
export const getApprovalDetails = (id: string) => approvals.get(id);
export function createPageTools(
  run: RunContext,
  deps: {
    dangerMode?: boolean;
    run?: typeof runInTab;
    highlight?: typeof highlightElement;
    readPage?: typeof readTabPage;
    wait?: (ms: number) => Promise<unknown>;
    tabs?: {
      get: typeof getTab;
      list: typeof listTabs;
      open: typeof openTab;
      switchTo: typeof switchTab;
      close: typeof closeTab;
    };
  } = {},
) {
  const execute = deps.run ?? runInTab,
    read = deps.readPage ?? readTabPage,
    tabs = deps.tabs ?? {
      get: getTab,
      list: listTabs,
      open: openTab,
      switchTo: switchTab,
      close: closeTab,
    };
  const target = (t?: number) => {
    const id = t ?? run.startTabId;
    if (id === undefined)
      throw new Error(
        "No tab to act on: the current page cannot be scripted. Open a web page first.",
      );
    return id;
  };
  const requireApproval = async (
    input: { tab?: number; id?: string },
    options: { toolCallId: string },
    click = false,
  ) => {
    if (deps.dangerMode === true) return false;
    const id = target(input.tab),
      allowed = run.isAllowed(id),
      t = allowed ? null : await tabs.get(id);
    const info =
      click && input.id
        ? await execute(id, describeClickTarget, [input.id])
        : undefined;
    approvals.set(options.toolCallId, {
      tabId: id,
      ...(!allowed ? { tabTitle: t?.title ?? "Untitled tab" } : {}),
      label: info?.label,
      submit: info?.submit,
    });
    return !allowed || !!info?.submit;
  };
  const act = async (input: { tab?: number }, fn: any, args: any[]) => {
    const id = target(input.tab);
    if (deps.dangerMode !== true) run.approve(id);
    return {
      ...((await execute(id, fn, args)) as Record<string, unknown>),
      tabId: id,
    };
  };
  const afterGesture = async (
    result: Record<string, unknown> & { tabId: number },
  ) => {
    await (
      deps.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    )(250);
    const page = await read(result.tabId);
    return {
      ...result,
      page: page
        ? {
            url: page.url,
            title: page.title,
            elements: page.elements,
            markdown: page.markdown.slice(0, 12000),
            truncated: page.truncated || page.markdown.length > 12000,
          }
        : null,
    };
  };
  const readResult = async (id: number) => {
    const p = await read(id);
    return p
      ? { ok: true, ...p, markdown: p.markdown.slice(0, 30000) }
      : { ok: false, tabId: id, error: "This page could not be read." };
  };
  return {
    plan: tool({
      description: "Create or update the checklist for a multi-step task.",
      inputSchema: z.object({
        steps: z.array(
          z.object({
            title: z.string(),
            status: z.enum(["pending", "in_progress", "done"]),
          }),
        ),
      }),
      execute: async () => ({ ok: true }),
    }),
    highlight: tool({
      description: "Scroll to and highlight an indexed element on the page.",
      inputSchema: z.object({ id: z.string(), note: z.string(), tab }),
      execute: async ({ id, note, tab }) => {
        const tabId = target(tab);
        if (!run.isAllowed(tabId) && deps.dangerMode !== true)
          return { found: false, error: "Read this tab with approval first." };
        const r = await execute(tabId, deps.highlight ?? highlightElement, [
          id,
          note,
        ]);
        return {
          ...r,
          tabId,
          ...(!r.found
            ? {
                error: `Element ${id} is no longer on the page. Describe its location in words instead.`,
              }
            : {}),
        };
      },
    }),
    fill: tool({
      description: "Fill an indexed editable field.",
      inputSchema: z.object({ id: z.string(), text: z.string(), tab }),
      needsApproval: requireApproval,
      execute: (i) => act(i, fillElement, [i.id, i.text]),
    }),
    select: tool({
      description: "Select an option by value or text.",
      inputSchema: z.object({ id: z.string(), option: z.string(), tab }),
      needsApproval: requireApproval,
      execute: (i) => act(i, selectElement, [i.id, i.option]),
    }),
    check: tool({
      description: "Check or uncheck a checkbox or radio.",
      inputSchema: z.object({ id: z.string(), checked: z.boolean(), tab }),
      needsApproval: requireApproval,
      execute: (i) => act(i, checkElement, [i.id, i.checked]),
    }),
    click: tool({
      description:
        deps.dangerMode === true
          ? "Click an indexed element. Danger mode: committing actions execute without approval."
          : "Click an indexed element. Committing actions require approval.",
      inputSchema: z.object({ id: z.string(), tab }),
      needsApproval: (i, o) => requireApproval(i, o, true),
      execute: async (i) => {
        const r = await act(i, clickElement, [i.id]);
        await (deps.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(
          1000,
        );
        const page = await read(r.tabId);
        return {
          ...r,
          page: page
            ? { url: page.url, title: page.title, elements: page.elements }
            : null,
        };
      },
    }),
    scroll: tool({
      description:
        "Scroll a page or the nearest scrollable ancestor of an indexed element by CSS pixels. Positive deltaY moves down, positive deltaX right. Not a real mouse wheel: no map/chart zoom. Returns offsets, movement and fresh page state. Stop at a boundary; do not loop on an unmoved result.",
      inputSchema: z
        .object({
          tab,
          id: z.string().optional(),
          deltaX: z.number().finite().min(-10000).max(10000).default(0),
          deltaY: z.number().finite().min(-10000).max(10000).default(0),
        })
        .refine((i) => i.deltaX !== 0 || i.deltaY !== 0, {
          message: "Provide a non-zero scroll delta.",
        }),
      needsApproval: requireApproval,
      execute: async (i) =>
        afterGesture(
          await act(i, scrollPage, [i.id ?? null, i.deltaX, i.deltaY]),
        ),
    }),
    double_click: tool({
      description:
        "Send a synthetic double-click to an indexed element, then read the page. Two single-click handlers may also run. Committing targets are rejected: use click instead. Does not provide trusted input or native text selection. Verify the result before continuing.",
      inputSchema: z.object({ id: z.string(), tab }),
      needsApproval: (i, o) => requireApproval(i, o, true),
      execute: async (i) => {
        const info = await execute(target(i.tab), describeClickTarget, [i.id]);
        if (!info?.found)
          return {
            ok: false,
            tabId: target(i.tab),
            error: "The element is no longer on the page.",
          };
        if (info.submit)
          return {
            ok: false,
            tabId: target(i.tab),
            error:
              "Double-clicking a committing control could submit twice. Use click with approval instead.",
          };
        return afterGesture(await act(i, doubleClickElement, [i.id]));
      },
    }),
    drag: tool({
      description:
        "Experimental synthetic drag between two indexed elements in the same document. Both endpoints must fit in the viewport together. auto chooses HTML5 for draggable sources, pointer otherwise; never retries with a different mode automatically. Always asks approval unless Danger mode is on. No files, cross-tab/frame drags, pointer capture or trusted input. Events dispatched is NOT proof of success; inspect page state before proceeding.",
      inputSchema: z.object({
        tab,
        sourceId: z.string(),
        targetId: z.string(),
        mode: z.enum(["auto", "html5", "pointer"]).default("auto"),
      }),
      needsApproval: async (i, o) => {
        if (deps.dangerMode === true) return false;
        const tabId = target(i.tab);
        const t = run.isAllowed(tabId) ? null : await tabs.get(tabId);
        const source = await execute(tabId, describeClickTarget, [i.sourceId]);
        const destination = await execute(tabId, describeClickTarget, [
          i.targetId,
        ]);
        approvals.set(o.toolCallId, {
          tabId,
          ...(!run.isAllowed(tabId)
            ? { tabTitle: t?.title ?? "Untitled tab" }
            : {}),
          label: source?.label || "missing source",
          targetLabel: destination?.label || "missing target",
        });
        return true;
      },
      execute: async (i) =>
        afterGesture(
          await act(i, dragElement, [i.sourceId, i.targetId, i.mode]),
        ),
    }),
    read_tab: tool({
      description: "Read a tab as Markdown; defaults to the task start tab.",
      inputSchema: z.object({ tab }),
      needsApproval: requireApproval,
      execute: async (i) => {
        const id = target(i.tab);
        if (deps.dangerMode !== true) run.approve(id);
        return readResult(id);
      },
    }),
    open_tab: tool({
      description: "Open an http/https page in a background tab and read it.",
      inputSchema: z.object({ url: z.string().url() }),
      execute: async ({ url }) => {
        const t = await tabs.open(url, run.startTabId);
        run.own(t.id!);
        return readResult(t.id!);
      },
    }),
    list_tabs: tool({
      description:
        "List tabs in the start window, without reading their content.",
      inputSchema: z.object({}),
      execute: async () => {
        const t =
          run.startTabId !== undefined ? await tabs.get(run.startTabId) : null;
        return {
          tabs: (await tabs.list(t?.windowId)).map((t) => ({
            tabId: t.id,
            title: t.title,
            url: t.url,
            access:
              run.isAllowed(t.id!) || deps.dangerMode === true
                ? "allowed"
                : "needs approval",
          })),
        };
      },
    }),
    switch_tab: tool({
      description: "Activate a tab.",
      inputSchema: z.object({ tab: z.number().int() }),
      execute: async ({ tab }) => {
        await tabs.switchTo(tab);
        return { ok: true, tabId: tab };
      },
    }),
    close_tab: tool({
      description: "Close only a tab you opened.",
      inputSchema: z.object({ tab: z.number().int() }),
      execute: async ({ tab }) => {
        if (!run.owns(tab))
          return { ok: false, error: "Only tabs you opened can be closed." };
        await tabs.close(tab);
        return { ok: true, tabId: tab };
      },
    }),
  };
}
