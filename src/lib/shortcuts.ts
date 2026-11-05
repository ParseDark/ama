export function panelShortcut(
  e: Pick<
    KeyboardEvent,
    "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
  >,
  platform = navigator.platform,
) {
  const toggleModifier = /Mac|iPhone|iPad|iPod/i.test(platform)
    ? e.metaKey && !e.ctrlKey
    : e.ctrlKey && !e.metaKey;
  if (e.code === "KeyK" && toggleModifier && !e.altKey && !e.shiftKey)
    return "close";
  if (e.code === "KeyL" && e.shiftKey && (e.metaKey || e.ctrlKey || e.altKey))
    return "clear";
  return null;
}
