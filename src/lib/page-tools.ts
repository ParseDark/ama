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
import { getTab, listTabs, openTab, switchTab, closeTab } from "./tabs";
import type { RunContext } from "./run-context";
const tab = z.number().int().optional();
export interface ApprovalDetails {
  tabId: number;
  tabTitle?: string;
  label?: string;
  submit?: boolean;
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
