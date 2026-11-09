import { request } from "node:http";
import { it, expect, vi } from "vitest";
import { DEFAULT_EMBEDDING } from "@/lib/settings";
import { embedQuery, scoreReferences } from "@/lib/memory/retrieval";
import { planFor, referenceSearch } from "@/lib/memory/context";
import { memory } from "./helpers";
// Explicit opt-in: synthetic text only; never require a local model in CI.
it.skipIf(process.env.AMA_TEST_LOCAL_EMBEDDING !== "1")(
  "recalls a procedure through the existing local Jina server and vector cache",
  async () => {
    // happy-dom's browser fetch enforces CORS; extensions use host_permissions.
    // Exercise actual HTTP via Node without weakening the loopback server's CORS policy.
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(
      (url, init) =>
        new Promise((resolve, reject) => {
          const req = request(
            String(url),
            {
              method: init?.method,
              headers: init?.headers as any,
              signal: init?.signal ?? undefined,
            },
            (res) => {
              const chunks: Buffer[] = [];
              res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
              res.on("end", () =>
                resolve(
                  new Response(Buffer.concat(chunks).toString(), {
                    status: res.statusCode,
                  }),
                ),
              );
            },
          );
          req.on("error", reject);
          req.end(init?.body);
        }),
    );
    try {
      const config = { ...DEFAULT_EMBEDDING, enabled: true };
      const ms = [
        memory(
          "export",
          "To export a report, open the Export menu and select CSV.",
          { category: "procedure", topic: "CSV report export" },
        ),
        memory("vacation", "Vacation requests are managed in Workday.", {
          category: "reference",
          topic: "Vacation",
        }),
        memory("language", "Reply in Chinese", { category: "preference" }),
      ];
      const query = "How do I export a report as CSV?";
      const vector = await embedQuery(query, config);
      expect(vector).not.toBeNull();
      expect(vector).toHaveLength(config.dimensions);
      const scores = await scoreReferences(ms, ms.slice(0, 2), vector, config);
      expect(scores).not.toBeNull();
      expect(scores!.get("export")!).toBeGreaterThan(scores!.get("vacation")!);
      const context = { memories: ms, scores };
      expect(
        planFor(context, undefined, config).injected.some(
          (m) => m.id === "export",
        ),
      ).toBe(true);
      expect((await referenceSearch(context, config)(query))[0].id).toBe(
        "export",
      );
    } finally {
      spy.mockRestore();
    }
  },
  15000,
);
