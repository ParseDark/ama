import { Readability } from "@mozilla/readability";
import Turndown from "turndown";
import { gfm } from "turndown-plugin-gfm";
export interface PageContent {
  url: string;
  title: string;
  markdown: string;
  selection: string;
  truncated: boolean;
  elements: string[];
}
export type ActivePage = PageContent & { tabId: number };
export function accessibleName(el: Element, doc: Document) {
  const tag = el.tagName.toLowerCase(),
    control =
      ["input", "textarea", "select"].includes(tag) ||
      el.hasAttribute("contenteditable");
  const labelled = (el.getAttribute("aria-labelledby") ?? "")
    .split(/\s+/)
    .map((id) => doc.getElementById(id)?.textContent ?? "")
    .join(" ");
  const labels =
    "labels" in el
      ? Array.from((el as HTMLInputElement).labels ?? [])
          .map((l) => {
            const clone = l.cloneNode(true) as Element;
            clone
              .querySelectorAll("input,textarea,select,[contenteditable]")
              .forEach((e) => e.remove());
            return clone.textContent;
          })
          .join(" ")
      : "";
  const editableSelector = "input,textarea,select,[contenteditable]";
  const text = !control
    ? el.querySelector(editableSelector)
      ? (el.cloneNode(true) as Element)
      : el
    : null;
  if (text && text !== el)
    text.querySelectorAll(editableSelector).forEach((e) => e.remove());
  const candidates = [
    el.getAttribute("aria-label"),
    labelled,
    labels,
    el.getAttribute("placeholder"),
    tag === "input" &&
    ["submit", "button", "reset"].includes(el.getAttribute("type") ?? "")
      ? el.getAttribute("value")
      : null,
    text?.textContent,
    el.getAttribute("title"),
    el.querySelector("img[alt]")?.getAttribute("alt"),
  ];
  return (candidates.find((s) => s?.trim()) ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}
export function extractPageContent(doc: Document): PageContent {
  const selector =
    'a[href],button,input:not([type=hidden]),textarea,select,summary,[contenteditable=""],[contenteditable="true"],[role="button"],[role="link"],[role="searchbox"],[role="textbox"],[role="combobox"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="radio"],[role="switch"],[role="slider"],[role="gridcell"],[role="listitem"],[role="list"],[draggable="true"],[ondblclick],[ondrop],[aria-dropeffect],h1,h2,h3,h4';
  const scrollable = new Set<HTMLElement>();
  // Bound extra layout inspection. Index named or unnamed scrolling containers,
  // without turning every generic div into a target.
  for (const el of Array.from(
    doc.querySelectorAll<HTMLElement>("body *"),
  ).slice(0, 10000)) {
    if (el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth)
      continue;
    const style = doc.defaultView?.getComputedStyle(el);
    if (
      style &&
      ((el.scrollHeight > el.clientHeight &&
        /^(auto|scroll|overlay)$/.test(style.overflowY)) ||
        (el.scrollWidth > el.clientWidth &&
          /^(auto|scroll|overlay)$/.test(style.overflowX)))
    )
      scrollable.add(el);
  }
  const candidates = Array.from(
    new Set([...doc.querySelectorAll<HTMLElement>(selector), ...scrollable]),
  ).filter(
    (el) =>
      !el.closest("#ama-highlight") &&
      (!el.checkVisibility ||
        el.checkVisibility({ visibilityProperty: true })) &&
      (accessibleName(el, doc) ||
        el.matches(
          "input,textarea,select,[contenteditable],[draggable=true],[ondblclick],[ondrop],[aria-dropeffect],[role=slider],[role=gridcell],[role=listitem],[role=list]",
        ) ||
        scrollable.has(el)),
  );
  const inViewport = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return (
      r.width > 0 &&
      r.height > 0 &&
      r.bottom > 0 &&
      r.right > 0 &&
      r.top < (doc.defaultView?.innerHeight ?? 0) &&
      r.left < (doc.defaultView?.innerWidth ?? 0)
    );
  };
  const visible = new Set(candidates.filter(inViewport));
  const sorted = candidates
    .sort(
      (a, b) =>
        Number(visible.has(b)) - Number(visible.has(a)) ||
        Number(a.tagName === "A") - Number(b.tagName === "A"),
    )
    .slice(0, 400);
  let next = Number(doc.documentElement.dataset.amaNextId) || 0;
  const elements = sorted.map((el) => {
    if (!el.dataset.amaId) el.dataset.amaId = `e${++next}`;
    const tag = el.tagName.toLowerCase(),
      kind = el.getAttribute("role") || (tag === "a" ? "link" : tag),
      type =
        tag === "input" &&
        el.getAttribute("type") &&
        el.getAttribute("type") !== "text"
          ? ` type=${el.getAttribute("type")}`
          : "";
    const flags = [
      visible.has(el) ? "in-view" : "",
      el.draggable ? "draggable" : "",
      scrollable.has(el)
        ? `scrollable x=${el.scrollLeft}/${Math.max(0, el.scrollWidth - el.clientWidth)} y=${el.scrollTop}/${Math.max(0, el.scrollHeight - el.clientHeight)}`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    const name = scrollable.has(el)
      ? el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        "scroll container"
      : accessibleName(el, doc);
    return `[${el.dataset.amaId}] ${kind}${type} "${name.replace(/\s+/g, " ").trim().slice(0, 80)}"${flags ? ` (${flags})` : ""}`;
  });
  doc.documentElement.dataset.amaNextId = String(next);
  const clean = (root: Element) => {
    root
      .querySelectorAll(
        "#ama-highlight,script,style,noscript,template,iframe,svg,canvas,nav,footer,dialog,[aria-hidden=true],[hidden]",
      )
      .forEach((e) => e.remove());
    root
      .querySelectorAll("input,textarea,select,[contenteditable]")
      .forEach((e) => {
        e.removeAttribute("value");
        if (e.matches("textarea,select,[contenteditable]")) e.textContent = "";
      });
    root.querySelectorAll("a[href],img[src]").forEach((e) => {
      const a = e.tagName === "A" ? "href" : "src";
      try {
        e.setAttribute(a, new URL(e.getAttribute(a)!, doc.baseURI).href);
      } catch {}
    });
    return root;
  };
  const main = clean(
    (
      doc.querySelector("main,[role=main]") ??
      doc.body ??
      doc.documentElement
    ).cloneNode(true) as Element,
  );
  let html = main.innerHTML;
  try {
    const clone = doc.cloneNode(true) as Document;
    clean(clone.documentElement);
    const article = new Readability(clone).parse();
    if (
      article?.content &&
      (article.textContent?.length ?? 0) >=
        (main.textContent?.length ?? 0) * 0.5
    )
      html = article.content;
  } catch {}
  const td = new Turndown({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  td.use(gfm);
  td.addRule("empty-links", {
    filter: (n) =>
      n.nodeName === "A" && !n.textContent?.trim() && !n.querySelector("img"),
    replacement: () => "",
  });
  td.addRule("table-cells", {
    filter: ["th", "td"],
    replacement: (content, node) => {
      const i = Array.prototype.indexOf.call(
        (node.parentNode as Element).children,
        node,
      );
      return `${i === 0 ? "| " : " "}${content
        .replace(/\s*\n\s*/g, " ")
        .replace(/\|/g, "\\|")
        .trim()} |`;
    },
  });
  let markdown = td.turndown(html).replace(/\n{3,}/g, "\n\n");
  const truncated = markdown.length > 120000;
  markdown = markdown.slice(0, 120000);
  return {
    url: doc.URL,
    title: doc.title,
    markdown,
    selection: doc.getSelection()?.toString().trim() ?? "",
    truncated,
    elements,
  };
}
