export function findSensitiveContent(
  text: string,
  { userTexts = [] }: { userTexts?: string[] } = {},
) {
  if (
    /password|passwd|passcode|密码|口令|验证码|\bapi[ _-]?key\b|\btoken\b|secret|\bsk-[a-z0-9]{16,}/i.test(
      text,
    )
  )
    return "credentials";
  if (/\b(?:\d[ -]?){13,19}\b/.test(text)) return "a card number";
  const urls =
    text.match(
      /https?:\/\/[^\s<>"'，。；！？、）】]+|\bwww\.[a-z0-9.-]+(?:\/[^\s<>"'，。；！？、）】]*)?|\b[a-z0-9][a-z0-9.-]*\.(?:com|net|org|io|cn|xyz|ru|dev|app|ai|co)\b(?:\/[^\s<>"'，。；！？、）】]*)?/gi,
    ) ?? [];
  if (urls.some((u) => !userTexts.some((t) => t.includes(u)))) return "a URL";
  return null;
}
