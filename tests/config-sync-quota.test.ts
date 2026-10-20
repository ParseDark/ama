import { expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import { captureConfig, packConfig, unpackConfig } from "@/lib/config-sync";

it("chunks a multi-item credential config and rejects oversized data rather than omitting settings", async () => {
  // Browser-like webcrypto is needed for integrity hashes in happy-dom.
  const old = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
  try {
    const snapshot = await captureConfig();
    const bytes = new Uint8Array(15000);
    webcrypto.getRandomValues(bytes);
    snapshot.settings.providers.openai.apiKey = Array.from(bytes, (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const revision = { time: 1, id: crypto.randomUUID() };
    const packed = await packConfig(snapshot, revision);
    expect(packed.manifest.parts).toBeGreaterThan(1);
    expect(
      (await unpackConfig(packed.values))?.snapshot.settings.providers.openai
        .apiKey,
    ).toBe(snapshot.settings.providers.openai.apiKey);
    const more = new Uint8Array(50000);
    webcrypto.getRandomValues(more);
    snapshot.settings.providers.openai.apiKey = Array.from(more, (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    await expect(packConfig(snapshot, revision)).rejects.toThrow("quota");
  } finally {
    Object.defineProperty(globalThis, "crypto", {
      value: old,
      configurable: true,
    });
  }
});
