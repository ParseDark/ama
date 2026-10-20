import { storage } from "wxt/utils/storage";
import { settingsStore, getEmbeddingConfig } from "../settings";
import { sessionsStore, loadSession } from "../sessions";
import {
  listMemories,
  isMemoryEnabled,
  memoryEventsStore,
  updateMemories,
} from "./store";
import { collectSignals } from "./signals";
import { extractMemoryOps } from "./extractor";
import { applyMemoryOps, isReadyToSuggest } from "./merger";
import { memoryModels } from "./models";
import { refineLearnedOps } from "./dedupe";
import { relateToExisting, judgeRelations } from "./relation";
export interface LearningState {
  cursors: Record<string, number>;
  eventCursor: number;
  runs: number;
  lastRunAt: number;
  version?: number;
}
/**
 * Bumped when earlier runs lost their results, so the chats they covered are
 * learned again. 2: structured answers through some gateways failed to
 * parse and every run learned nothing.
 */
const LEARNING_VERSION = 2;
export const learningStore = storage.defineItem<LearningState>(
  "local:memoryLearning",
  { fallback: { cursors: {}, eventCursor: 0, runs: 0, lastRunAt: 0 } },
);
export async function runLearning({ force = false } = {}) {
  if (!(await isMemoryEnabled())) return { status: "off" };
  const perform = async () => {
    const stored = await learningStore.getValue();
    const migrated = (stored.version ?? 1) < LEARNING_VERSION;
    const state = migrated
      ? { ...stored, cursors: {}, eventCursor: 0, version: LEARNING_VERSION }
      : stored;
    if (!force && Date.now() - state.lastRunAt < 300000)
      return { status: "cooldown" };
    try {
      const sessions = await sessionsStore.getValue(),
        loaded = await Promise.all(
          sessions.map(async (s) => ({
            id: s.id,
            messages: await loadSession(s.id),
          })),
        );
      const collected = collectSignals(
        loaded,
        await memoryEventsStore.getValue(),
        state.cursors,
        state.eventCursor,
      );
      if (!collected.signals.length) {
        // Persist the reset once, so later runs read the current version.
        if (migrated) await learningStore.setValue(state);
        return { status: "nothing" };
      }
      const memories = await listMemories(),
        settings = await settingsStore.getValue(),
        models = memoryModels(settings);
      const ops = await extractMemoryOps(memories, collected.signals, models);
      if (ops === null) return { status: "failed" };
      const refined = await refineLearnedOps(ops, memories, (text, scope) =>
        relateToExisting(text, scope, memories, {
          config: getEmbeddingConfig(settings),
          judge: (t, c) => judgeRelations(t, c, models),
          isCandidate: () => true,
        }),
      );
      await updateMemories((ms) => {
        const next = applyMemoryOps(ms, refined);
        return settings.dangerMode === true
          ? next.map((m) =>
              isReadyToSuggest(m) ? { ...m, status: "active" as const } : m,
            )
          : next;
      });
      await learningStore.setValue({
        cursors: collected.cursors,
        eventCursor: collected.eventCursor,
        runs: state.runs + 1,
        lastRunAt: Date.now(),
        version: LEARNING_VERSION,
      });
      return { status: "done" };
    } catch {
      return { status: "failed" };
    }
  };
  if (!navigator.locks) return { status: "busy" };
  return navigator.locks.request(
    "ama-memory-learning",
    { ifAvailable: true },
    (lock) => (lock ? perform() : Promise.resolve({ status: "busy" })),
  );
}
