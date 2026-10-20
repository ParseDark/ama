/** Human-readable age for "last ran" labels. */
export function formatRelativeTime(ts: number, now = Date.now()): string {
  const delta = Math.max(0, now - ts);
  if (delta < 60000) return "just now";
  if (delta < 3600000) return `${Math.floor(delta / 60000)} minutes ago`;
  if (delta < 86400000) return `${Math.floor(delta / 3600000)} hours ago`;
  return `${Math.floor(delta / 86400000)} days ago`;
}
