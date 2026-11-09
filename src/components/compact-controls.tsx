import { Button } from "./ui/button";
import type { useCompact } from "@/hooks/use-compact";

export function CompactControls({
  control,
}: {
  control: ReturnType<typeof useCompact>;
}) {
  const { record: latest, running, error, cancel } = control;
  if (!latest && !running && !error) return null;
  return (
    <div className="px-1 pb-1 text-xs text-muted-foreground">
      {running && (
        <Button size="sm" variant="ghost" onClick={cancel}>
          Compacting… · Cancel compact
        </Button>
      )}
      {latest && (
        <details>
          <summary>
            Compacted history · ~{latest.beforeTokens.toLocaleString()} →{" "}
            {latest.afterTokens.toLocaleString()} tokens
          </summary>
          <p>
            Historical prefix only, not the whole prompt. {latest.covered}{" "}
            messages · {(latest.durationMs / 1000).toFixed(1)}s · {latest.model}
            . Summary usage: {latest.inputTokens} in / {latest.outputTokens}{" "}
            out. Full chat retained locally; summaries are sent to the
            configured model.
          </p>
          <pre className="whitespace-pre-wrap">{latest.summary}</pre>
        </details>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
