import { it, expect, vi, afterEach, beforeEach } from "vitest";
import { runLearning, learningStore } from "@/lib/memory/learning";
import { setMemoryEnabled, listMemories } from "@/lib/memory/store";
import { settingsStore, DEFAULT_SETTINGS } from "@/lib/settings";
import { saveSession } from "@/lib/sessions";
const answer = (body: unknown) =>
  Response.json({
    choices: [
      {
        message: {
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: { name: "answer", arguments: JSON.stringify(body) },
            },
          ],
        },
      },
    ],
  });
beforeEach(() => {
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: vi.fn(async (_name: any, opts: any, fn?: any) =>
        (fn ?? opts)({ name: "test" }),
      ),
    },
  });
});
afterEach(() => vi.restoreAllMocks());
it("handles off, cooldown, no signals and busy lock", async () => {
  await setMemoryEnabled(false);
  expect((await runLearning()).status).toBe("off");
  await setMemoryEnabled(true);
  await learningStore.setValue({
    cursors: {},
    eventCursor: 0,
    runs: 1,
    lastRunAt: Date.now(),
  });
  expect((await runLearning()).status).toBe("cooldown");
  expect((await runLearning({ force: true })).status).toBe("nothing");
  vi.spyOn(navigator.locks, "request").mockImplementation(((
    _name: any,
    _opts: any,
    fn: any,
  ) => fn(null)) as any);
  expect((await runLearning({ force: true })).status).toBe("busy");
});
it("danger mode auto-activates learned habits only after evidence threshold and keeps sensitive exclusions", async () => {
  await settingsStore.setValue({ ...DEFAULT_SETTINGS, dangerMode: true });
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    answer({
      ops: [
        {
          op: "add",
          text: "Prefers concise answers",
          reason: "Repeated preference",
        },
        {
          op: "add",
          text: "password is test-only",
          reason: "Must still be excluded",
        },
      ],
    }),
  );
  const user = (id: string) => ({
    id,
    role: "user" as const,
    parts: [{ type: "text" as const, text: "Use concise answers" }],
  });
  await saveSession("learn", [user("one")]);
  expect((await runLearning({ force: true })).status).toBe("done");
  expect(await listMemories()).toMatchObject([
    { status: "suggested", evidence: 1 },
  ]);
  await saveSession("learn", [user("one"), user("two")]);
  expect((await runLearning({ force: true })).status).toBe("done");
  expect(await listMemories()).toMatchObject([
    { status: "active", evidence: 2, kind: "inferred" },
  ]);
  expect(await listMemories()).toHaveLength(1);
});

it("keeps progress on inference failure and commits successful runs only", async () => {
  await saveSession("a", [
    {
      id: "u",
      role: "user",
      metadata: { domain: "example.com" },
      parts: [{ type: "text", text: "Use short answers" }],
    },
  ]);
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("offline"));
  expect((await runLearning({ force: true })).status).toBe("failed");
  expect((await learningStore.getValue()).cursors).toEqual({});
  fetchMock.mockImplementation(async () => answer({ ops: [] }));
  expect((await runLearning({ force: true })).status).toBe("done");
  expect((await learningStore.getValue()).cursors).toEqual({ a: 1 });
  expect((await runLearning({ force: true })).status).toBe("nothing");
});

it("re-learns chats processed by an old version without dropping run history", async () => {
  await saveSession("s1", [
    {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "Use short answers" }],
    },
  ]);
  await learningStore.setValue({
    cursors: { s1: 2 },
    eventCursor: 0,
    runs: 24,
    lastRunAt: 0,
  });
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    answer({
      ops: [
        {
          op: "add",
          text: "Prefers brief answers",
          reason: "asked twice",
        },
      ],
    }),
  );
  expect((await runLearning({ force: true })).status).toBe("done");
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(await learningStore.getValue()).toMatchObject({
    runs: 25,
    version: 2,
    cursors: { s1: 1 },
  });
  fetchMock.mockClear();
  expect((await runLearning({ force: true })).status).toBe("nothing");
  expect(fetchMock).not.toHaveBeenCalled();
  expect((await learningStore.getValue()).runs).toBe(25);
});
