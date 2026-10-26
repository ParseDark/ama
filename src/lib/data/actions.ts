import { createDataStore } from "./store";
import type { DataLimits } from "./types";

/** Session-bound data access. Limits/clock injection is intended for deterministic tests. */
export function createDataActions(options: {
  sessionId: string;
  limits?: Partial<DataLimits>;
  now?: () => number;
}) {
  return createDataStore(options);
}

export type DataActions = ReturnType<typeof createDataActions>;
export type {
  DataDescriptor,
  DataMetadata,
  DataInspectOptions,
  DataLimits,
} from "./types";
