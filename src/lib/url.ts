export function hostnameOf(url?: string) {
  try {
    return new URL(url!).hostname;
  } catch {
    return undefined;
  }
}
export function webURL(url: string) {
  const u = new URL(url);
  if (!["http:", "https:"].includes(u.protocol))
    throw new Error("Only http and https URLs can be opened.");
  return u.href;
}
