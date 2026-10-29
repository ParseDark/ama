import "fake-indexeddb/auto";
import { it, expect } from "vitest";
import { createDataActions } from "@/lib/data/actions";
import {
  sessionTitle,
  saveSession,
  loadSession,
  sessionsStore,
  deleteSession,
  activeSessionStore,
} from "@/lib/sessions";
const messages: any = [
  { id: "u", role: "user", parts: [{ type: "text", text: "First question" }] },
];
it("derives titles including screenshots", () => {
  expect(sessionTitle(messages)).toBe("First question");
  expect(
    sessionTitle([
      {
        id: "u",
        role: "user",
        parts: [{ type: "file", mediaType: "image/jpeg", url: "data:" }],
      },
    ]),
  ).toBe("Screenshot");
});
it("saves newest first, restores and deletes without saving empty chats", async () => {
  await saveSession("empty", []);
  await saveSession("a", messages);
  await saveSession("b", messages);
  expect((await sessionsStore.getValue()).map((s) => s.id)).toEqual(["b", "a"]);
  expect(await loadSession("a")).toEqual(messages);
  const data = createDataActions({ sessionId: "b" });
  const stored = await data.save({ secret: "local-only" }, { source: "test" });
  await deleteSession("b");
  await expect(data.load(stored.dataId)).rejects.toThrow();
  await expect(data.save("late result", { source: "test" })).rejects.toThrow();
  expect(await activeSessionStore.getValue()).toBeNull();
  expect(await loadSession("b")).toEqual([]);
});
