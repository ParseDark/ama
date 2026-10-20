import { useState, useEffect } from "react";
import { memoryStore } from "@/lib/memory/store";
import { learningStore, type LearningState } from "@/lib/memory/learning";
import type { Memory } from "@/lib/memory/types";
export function useLearningState() {
  const [state, setState] = useState<LearningState>({
    cursors: {},
    eventCursor: 0,
    runs: 0,
    lastRunAt: 0,
  });
  useEffect(() => {
    void learningStore.getValue().then(setState);
    return learningStore.watch(setState);
  }, []);
  return state;
}
export function useMemory() {
  const [memories, setMemories] = useState<Memory[]>([]),
    [enabled, setEnabled] = useState(true);
  useEffect(() => {
    const apply = (s: Awaited<ReturnType<typeof memoryStore.getValue>>) => {
      setMemories(s.memories);
      setEnabled(s.enabled);
    };
    void memoryStore.getValue().then(apply);
    return memoryStore.watch(apply);
  }, []);
  return { memories, enabled };
}
