// Generates the compact model catalog used by the side panel.
// Source: @opencode-ai/models (models.dev). Regenerate with `pnpm models:generate`.
import { writeFileSync } from "node:fs";
import {
  generatedAt,
  models as canonical,
  providers,
} from "@opencode-ai/models/snapshot";

const KNOWN = ["openai", "anthropic", "google"];
const number = (value) =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : undefined;
const money = (value) =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;

function prices(cost) {
  if (!cost) return undefined;
  const input = money(cost.input),
    output = money(cost.output);
  if (input === undefined || output === undefined) return undefined;
  const cacheRead = money(cost.cache_read),
    cacheWrite = money(cost.cache_write);
  const result = {
    input,
    output,
    ...(cacheRead !== undefined ? { cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cacheWrite } : {}),
  };
  const tiers = (cost.tiers ?? [])
    .filter((tier) => tier?.tier?.type === "context" && number(tier.tier.size))
    .sort((a, b) => a.tier.size - b.tier.size);
  if (tiers.length) {
    const long = {
      input: money(tiers[0].input),
      output: money(tiers[0].output),
      ...(money(tiers[0].cache_read) !== undefined
        ? { cacheRead: money(tiers[0].cache_read) }
        : {}),
      ...(money(tiers[0].cache_write) !== undefined
        ? { cacheWrite: money(tiers[0].cache_write) }
        : {}),
    };
    if (long.input !== undefined && long.output !== undefined) {
      result.threshold = Math.round(tiers[0].tier.size);
      result.long = long;
    }
  }
  return result;
}

function entry(model) {
  const input = number(model.limit?.input) ?? number(model.limit?.context),
    output = number(model.limit?.output),
    cost = prices(model.cost);
  if (input === undefined && output === undefined && !cost) return undefined;
  return {
    ...(input !== undefined ? { i: input } : {}),
    ...(output !== undefined ? { o: output } : {}),
    ...(cost ? { p: cost } : {}),
  };
}

const known = {};
for (const id of KNOWN) {
  const provider = providers[id];
  if (!provider) continue;
  const models = {};
  for (const [key, model] of Object.entries(provider.models ?? {})) {
    const value = entry(model);
    if (value) models[key] = value;
  }
  known[id] = models;
}

const canonicalModels = {};
for (const [key, model] of Object.entries(canonical ?? {})) {
  const leaf = key.split("/").pop();
  if (!leaf || canonicalModels[leaf]) continue;
  const value = entry(model);
  if (value) canonicalModels[leaf] = { i: value.i, o: value.o };
}

// Any provider model ID covers custom gateways. Keep limits only: provider
// pricing is not the gateway's price.
const anyModel = {};
for (const provider of Object.values(providers)) {
  for (const [key, model] of Object.entries(provider.models ?? {})) {
    const id = String(model.id ?? key).toLowerCase();
    if (!id || anyModel[id]) continue;
    const value = entry(model);
    if (value) anyModel[id] = { i: value.i, o: value.o };
  }
}

const data = `// Generated from @opencode-ai/models${generatedAt ? ` (models.dev ${generatedAt})` : ""}.
// Regenerate with: pnpm models:generate
export const CATALOG_GENERATED_AT = ${JSON.stringify(generatedAt)};
export const CATALOG_PROVIDERS: Record<string, Record<string, any>> = ${JSON.stringify(known)};
export const CATALOG_MODELS: Record<string, any> = ${JSON.stringify(canonicalModels)};
export const CATALOG_ANY: Record<string, any> = ${JSON.stringify(anyModel)};
`;
writeFileSync("src/lib/model-catalog-data.ts", data);
console.log(
  "wrote src/lib/model-catalog-data.ts",
  `${(data.length / 1024).toFixed(0)} KiB`,
  "providers",
  Object.keys(known).length,
  "canonical",
  Object.keys(canonicalModels).length,
  "any",
  Object.keys(anyModel).length,
);
