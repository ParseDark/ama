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
  const candidates = [
    el.getAttribute("aria-label"),
    labelled,
    labels,
    el.getAttribute("placeholder"),
    tag === "input" &&
    ["submit", "button", "reset"].includes(el.getAttribute("type") ?? "")
      ? el.getAttribute("value")
      : null,
    !control ? el.textContent : null,
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
    'a[href],button,input:not([type=hidden]),textarea,select,summary,[contenteditable=""],[contenteditable="true"],[role="button"],[role="link"],[role="searchbox"],[role="textbox"],[role="combobox"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="radio"],[role="switch"],h1,h2,h3,h4';
  const candidates = Array.from(
    doc.querySelectorAll<HTMLElement>(selector),
  ).filter(
    (el) =>
      !el.closest("#ama-highlight") &&
      (!el.checkVisibility ||
        el.checkVisibility({ visibilityProperty: true })) &&
      (accessibleName(el, doc) ||
        el.matches("input,textarea,select,[contenteditable]")),
  );
  const sorted = [
    ...candidates.filter((e) => e.tagName !== "A"),
    ...candidates.filter((e) => e.tagName === "A"),
  ].slice(0, 400);
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
    return `[${el.dataset.amaId}] ${kind}${type} "${accessibleName(el, doc)}"`;
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
