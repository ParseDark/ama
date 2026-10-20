export function fillElement(id: string, text: string) {
  const el = document.querySelector<HTMLElement>(
    `[data-ama-id="${CSS.escape(id)}"]`,
  );
  if (!el)
    return { ok: false, error: `Element ${id} is no longer on the page.` };
  if (el instanceof HTMLSelectElement)
    return { ok: false, error: "Use the select tool." };
  if (el instanceof HTMLInputElement) {
    if (["checkbox", "radio"].includes(el.type))
      return { ok: false, error: "Use the check tool." };
    if (["button", "submit", "reset", "image"].includes(el.type))
      return { ok: false, error: "Use the click tool." };
    if (el.type === "file")
      return { ok: false, error: "Ask the user to choose the file." };
  }
  el.scrollIntoView?.({ block: "center" });
  el.focus();
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto =
      el instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, text);
  } else if (el.isContentEditable || el.hasAttribute("contenteditable"))
    el.textContent = text;
  else return { ok: false, error: "This element is not an editable field." };
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true };
}
export function selectElement(id: string, option: string) {
  const el = document.querySelector(`[data-ama-id="${CSS.escape(id)}"]`);
  if (!(el instanceof HTMLSelectElement))
    return { ok: false, error: "Element is not a select." };
  const options = [...el.options],
    q = option.toLowerCase();
  const match =
    options.find((o) => o.value === option) ??
    options.find((o) => o.text.trim() === option) ??
    options.find((o) => o.text.toLowerCase().includes(q));
  if (!match)
    return {
      ok: false,
      error: `No matching option. Options: ${options
        .slice(0, 20)
        .map((o) => `${o.value}: ${o.text}`)
        .join(", ")}`,
    };
  el.scrollIntoView?.({ block: "center" });
  el.focus();
  Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )!.set!.call(el, match.value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, selected: match.text };
}
export function checkElement(id: string, checked: boolean) {
  const el = document.querySelector<HTMLElement>(
    `[data-ama-id="${CSS.escape(id)}"]`,
  );
  if (!el)
    return { ok: false, error: `Element ${id} is no longer on the page.` };
  const native =
    el instanceof HTMLInputElement && ["checkbox", "radio"].includes(el.type);
  if (
    !native &&
    !["checkbox", "radio", "switch"].includes(el.getAttribute("role") ?? "")
  )
    return { ok: false, error: "Element is not a checkbox or radio." };
  const current = native
    ? (el as HTMLInputElement).checked
    : el.getAttribute("aria-checked") === "true";
  el.scrollIntoView?.({ block: "center" });
  if (current !== checked) el.click();
  return { ok: true, checked };
}
export function describeClickTarget(id: string) {
  const el = document.querySelector<HTMLElement>(
    `[data-ama-id="${CSS.escape(id)}"]`,
  );
  if (!el) return { found: false, submit: false, label: "" };
  const name = (
    el.getAttribute("aria-label") ||
    (el instanceof HTMLInputElement &&
    ["submit", "button", "reset"].includes(el.type)
      ? el.value
      : "") ||
    el.textContent ||
    el.title ||
    ""
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const kind =
    el.getAttribute("role") ||
    (el.tagName === "A" ? "link" : el.tagName.toLowerCase());
  const committing =
    /\b(submit|send|pay|buy|purchase|order|checkout|check out|confirm|delete|remove|sign up|register|subscribe|publish|post|save|transfer|approve)\b|提交|发送|支付|付款|购买|下单|结算|确认|删除|移除|注册|订阅|发布|保存|转账|批准/i.test(
      name,
    );
  const form =
    el instanceof HTMLInputElement || el instanceof HTMLButtonElement
      ? el.form
      : null;
  const navigate =
    !!form &&
    (form.getAttribute("role") === "search" ||
      !!form.querySelector("input[type=search]") ||
      (form.method.toLowerCase() === "get" && form.hasAttribute("action")) ||
      /\b(search|find|go)\b|搜索|查找|检索/i.test(name));
  const submits =
    !!form &&
    ((el instanceof HTMLButtonElement && el.type === "submit") ||
      (el instanceof HTMLInputElement &&
        ["submit", "image"].includes(el.type)));
  return {
    found: true,
    submit:
      committing ||
      (submits && !navigate) ||
      (!form && el.getAttribute("type") === "submit"),
    label: `${kind} "${name}"`,
  };
}
export function clickElement(id: string) {
  const el = document.querySelector<HTMLElement>(
    `[data-ama-id="${CSS.escape(id)}"]`,
  );
  if (!el)
    return { ok: false, error: `Element ${id} is no longer on the page.` };
  el.scrollIntoView?.({ block: "center" });
  el.click();
  return { ok: true };
}
