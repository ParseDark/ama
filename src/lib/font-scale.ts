/** Text sizes in globals.css multiply by this variable, so one value on <html>
 * scales every message, menu and hint without touching layout spacing. */
export const FONT_SCALE_VAR = "--ama-font-scale";
export function applyFontScale(scale: number) {
  document.documentElement.style.setProperty(FONT_SCALE_VAR, String(scale));
}
