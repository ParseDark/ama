import { it, expect } from "vitest";
import { formatRelativeTime } from "@/lib/time";

it("formats the last learning run for humans", () => {
  const now = 10_000_000_000;
  expect(formatRelativeTime(now - 1000, now)).toBe("just now");
  expect(formatRelativeTime(now - 5 * 60000, now)).toBe("5 minutes ago");
  expect(formatRelativeTime(now - 3 * 3600000, now)).toBe("3 hours ago");
  expect(formatRelativeTime(now - 2 * 86400000, now)).toBe("2 days ago");
});
