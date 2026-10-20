export function panelShortcut(
  e: Pick<
    KeyboardEvent,
    "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
  >,
) {
  if (e.code === "KeyK" && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey)
    return "close";
  if (e.code === "KeyL" && e.shiftKey && (e.metaKey || e.ctrlKey || e.altKey))
    return "clear";
  return null;
}
