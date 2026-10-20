import { Streamdown } from "streamdown";
import { cjk } from "@streamdown/cjk";
import { codeHighlighter } from "@/lib/code-highlighter";
export function Markdown({
  children,
  streaming = false,
}: {
  children: string;
  streaming?: boolean;
}) {
  return (
    <Streamdown
      className="prose"
      plugins={{ cjk, code: codeHighlighter }}
      linkSafety={{ enabled: false }}
      isAnimating={streaming}
      controls={{ code: { copy: true, download: false }, table: false }}
    >
      {children}
    </Streamdown>
  );
}
