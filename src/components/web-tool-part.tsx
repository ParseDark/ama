import { Search, Globe, Loader2, AlertTriangle } from "lucide-react";
import { publicWebUrl, type WebSource } from "@/lib/web-search/client";

export function WebToolPart({ part, name }: { part: any; name: string }) {
  const input = part.input ?? {},
    out = part.output ?? {};
  const failed =
    part.state === "output-error" || part.state === "output-denied";
  const complete = part.state === "output-available";
  const search = name === "web_search";
  const sources: WebSource[] =
    complete && search && Array.isArray(out.results) ? out.results : [];
  const safeLink = (url: string) => {
    try {
      return publicWebUrl(url);
    } catch {
      return null;
    }
  };
  const fetchedUrl = typeof out.url === "string" ? safeLink(out.url) : null;
  return (
    <details className={`web-tool-card ${failed ? "error" : ""}`}>
      <summary>
        {failed ? (
          <AlertTriangle size={13} />
        ) : !complete ? (
          <Loader2 size={13} className="spin" />
        ) : search ? (
          <Search size={13} />
        ) : (
          <Globe size={13} />
        )}
        <span>
          {search
            ? `Search: ${input.query ?? "…"}`
            : `Read web page: ${out.title || input.url || "…"}`}
          {complete && search ? ` · ${sources.length} sources` : ""}
          {!complete && !failed ? "…" : ""}
          {failed ? " · Failed" : ""}
        </span>
      </summary>
      {failed && (
        <p role="alert">{part.errorText ?? "Web request was not completed."}</p>
      )}
      {complete && search && (
        <>
          {!sources.length && (
            <p>
              No usable public results. Try another query; this is not proof no
              matching information exists.
            </p>
          )}
          <ol>
            {sources.map((source, i) => {
              const url =
                typeof source.url === "string" ? safeLink(source.url) : null;
              return url ? (
                <li key={`${url}-${i}`}>
                  <a href={url} target="_blank" rel="noreferrer noopener">
                    {source.title || url}
                  </a>
                  <small>
                    {source.siteName || new URL(url).hostname}
                    {source.date ? ` · ${source.date}` : ""}
                  </small>
                  <p>{source.snippet}</p>
                </li>
              ) : null;
            })}
          </ol>
          {out.omitted > 0 && <p>{out.omitted} unsafe source URLs omitted.</p>}
        </>
      )}
      {complete && !search && fetchedUrl && (
        <a href={fetchedUrl} target="_blank" rel="noreferrer noopener">
          {out.title || fetchedUrl}
        </a>
      )}
      {complete && out.truncated && (
        <p>Content truncated to fit the reply context.</p>
      )}
    </details>
  );
}
