import { useEffect, useState } from "react";
import type { Memory } from "@/lib/memory/types";
import type { EmbeddingConfig } from "@/lib/settings";
import { findSimilarPairs } from "@/lib/memory/dedupe";
import { distinctStore, markDistinct, keepMemory } from "@/lib/memory/store";
import { Button } from "./ui/button";
export function SimilarMemories({
  memories,
  config,
}: {
  memories: Memory[];
  config: EmbeddingConfig;
}) {
  const [pairs, setPairs] = useState<
      Awaited<ReturnType<typeof findSimilarPairs>>
    >([]),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    void distinctStore
      .getValue()
      .then((distinct) => findSimilarPairs(memories, { config, distinct }))
      .then((p) => {
        if (live) setPairs(p.slice(0, 3));
      });
    return () => {
      live = false;
    };
  }, [memories, config.enabled, config.url, config.model, revision]);
  if (!pairs.length) return null;
  return (
    <section className="card">
      <h3>These look alike: same thing said twice, or conflicting?</h3>
      {pairs.map(({ a, b }) => (
        <div
          className="similar-pair"
          role="group"
          aria-label="Similar pair"
          key={`${a.id}|${b.id}`}
        >
          <p>A · {a.text}</p>
          <p>B · {b.text}</p>
          <div className="row">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await markDistinct(a.id, b.id);
                setRevision((n) => n + 1);
              }}
            >
              Keep both
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void keepMemory(a.id, b.id)}
            >
              Keep A
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void keepMemory(b.id, a.id)}
            >
              Keep B
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
}
