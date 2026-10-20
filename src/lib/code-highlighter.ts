import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import type { CodeHighlighterPlugin } from "streamdown";
const languages: Record<string, () => Promise<any>> = {
  javascript: () => import("@shikijs/langs/javascript"),
  typescript: () => import("@shikijs/langs/typescript"),
  tsx: () => import("@shikijs/langs/tsx"),
  jsx: () => import("@shikijs/langs/jsx"),
  json: () => import("@shikijs/langs/json"),
  jsonc: () => import("@shikijs/langs/jsonc"),
  html: () => import("@shikijs/langs/html"),
  css: () => import("@shikijs/langs/css"),
  scss: () => import("@shikijs/langs/scss"),
  python: () => import("@shikijs/langs/python"),
  bash: () => import("@shikijs/langs/bash"),
  shellscript: () => import("@shikijs/langs/shellscript"),
  sql: () => import("@shikijs/langs/sql"),
  yaml: () => import("@shikijs/langs/yaml"),
  markdown: () => import("@shikijs/langs/markdown"),
  xml: () => import("@shikijs/langs/xml"),
  java: () => import("@shikijs/langs/java"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  go: () => import("@shikijs/langs/go"),
  rust: () => import("@shikijs/langs/rust"),
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  csharp: () => import("@shikijs/langs/csharp"),
  ruby: () => import("@shikijs/langs/ruby"),
  php: () => import("@shikijs/langs/php"),
  swift: () => import("@shikijs/langs/swift"),
  dockerfile: () => import("@shikijs/langs/dockerfile"),
  diff: () => import("@shikijs/langs/diff"),
  toml: () => import("@shikijs/langs/toml"),
  vue: () => import("@shikijs/langs/vue"),
};
const highlighter = createHighlighterCore({
  themes: [
    import("@shikijs/themes/github-light"),
    import("@shikijs/themes/github-dark"),
  ],
  langs: [],
  engine: createJavaScriptRegexEngine(),
});
const aliases: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  sh: "shellscript",
  shell: "shellscript",
  py: "python",
  yml: "yaml",
  md: "markdown",
  cs: "csharp",
};
export const codeHighlighter: CodeHighlighterPlugin = {
  name: "shiki",
  type: "code-highlighter",
  getSupportedLanguages: () => Object.keys(languages),
  getThemes: () => ["github-light", "github-dark"],
  supportsLanguage: (lang) => !!languages[aliases[lang] ?? lang],
  highlight(options, callback) {
    const lang = aliases[options.language] ?? options.language;
    if (!languages[lang])
      return {
        tokens: options.code.split("\n").map((content) => [{ content }]),
      };
    void highlighter
      .then(async (h) => {
        if (!h.getLoadedLanguages().includes(lang))
          await h.loadLanguage(await languages[lang]());
        callback?.(
          h.codeToTokens(options.code, {
            lang,
            themes: { light: "github-light", dark: "github-dark" },
          }),
        );
      })
      .catch(() =>
        callback?.({
          tokens: options.code.split("\n").map((content) => [{ content }]),
        }),
      );
    return null;
  },
};
