import {
  CATALOG_ANY,
  CATALOG_MODELS,
  CATALOG_PROVIDERS,
} from "./model-catalog-data";
import type { ModelInfo, ModelPricing, ProviderId } from "./settings";

type CatalogEntry = {
  i?: number;
  o?: number;
  p?: ModelPricing;
};

const normal = (value: string) =>
  value
    .trim()
    .replace(/^models\//i, "")
    .toLowerCase();

const providerModels = new Map<string, Map<string, CatalogEntry>>();
for (const [provider, models] of Object.entries(CATALOG_PROVIDERS))
  providerModels.set(provider, new Map(Object.entries(models)));
const anyModel = new Map<string, CatalogEntry>(
  Object.entries(CATALOG_ANY).map(([id, entry]) => [normal(id), entry]),
);
const canonical = new Map<string, CatalogEntry>(
  Object.entries(CATALOG_MODELS).map(([id, entry]) => [normal(id), entry]),
);

function findIn(
  models: Map<string, CatalogEntry> | undefined,
  modelId: string,
): CatalogEntry | undefined {
  if (!models) return undefined;
  const direct = models.get(modelId);
  if (direct) return direct;
  const wanted = normal(modelId);
  for (const [key, entry] of models) if (normal(key) === wanted) return entry;
  return undefined;
}

function findCatalogModel(
  provider: ProviderId,
  modelId: string,
): CatalogEntry | undefined {
  const wanted = normal(modelId);
  if (!wanted) return undefined;
  if (provider !== "openai-compatible") {
    const direct = findIn(providerModels.get(provider), modelId);
    if (direct) return direct;
  }
  // A custom gateway's price is not necessarily the catalog provider's price,
  // so compatible providers get limits only. If a known gateway host were
  // modeled here, its provider entry could provide prices, but it is not.
  return anyModel.get(wanted) ?? canonical.get(wanted);
}

function toModelInfo(entry: CatalogEntry): ModelInfo | undefined {
  const maxInputTokens = entry.i,
    maxOutputTokens = entry.o,
    pricing = entry.p;
  if (maxInputTokens === undefined && maxOutputTokens === undefined && !pricing)
    return undefined;
  return {
    ...(maxInputTokens !== undefined ? { maxInputTokens } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(pricing ? { pricing } : {}),
    source: "models.dev",
  };
}

/**
 * Looks up a model in the compact models.dev snapshot bundled with AMA. Used
 * only as a fallback: the provider's `/models` response wins when it contains
 * the same fields.
 */
export function catalogModelInfo(
  provider: ProviderId,
  model: string,
  _baseURL?: string,
): ModelInfo | undefined {
  const found = findCatalogModel(provider, model);
  return found ? toModelInfo(found) : undefined;
}

/** Fills only the fields the provider did not return; gateway data wins. */
export function mergeModelInfo(
  gateway: ModelInfo | undefined,
  catalog: ModelInfo | undefined,
): ModelInfo | undefined {
  if (!gateway) return catalog;
  if (!catalog) return gateway;
  const merged = { ...gateway };
  let limitFromCatalog = false;
  if (
    merged.maxInputTokens === undefined &&
    catalog.maxInputTokens !== undefined
  ) {
    merged.maxInputTokens = catalog.maxInputTokens;
    limitFromCatalog = true;
  }
  if (
    merged.maxOutputTokens === undefined &&
    catalog.maxOutputTokens !== undefined
  )
    merged.maxOutputTokens = catalog.maxOutputTokens;
  if (merged.pricing === undefined && catalog.pricing !== undefined)
    merged.pricing = catalog.pricing;
  if (limitFromCatalog) merged.source = "models.dev";
  return merged;
}
