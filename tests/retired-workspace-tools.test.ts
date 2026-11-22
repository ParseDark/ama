import {
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from "ai";
import { expect, it } from "vitest";
import { hasPendingTools } from "@/lib/compaction";
import { withoutRetiredWorkspaceTools } from "@/lib/retired-workspace-tools";

type Part = UIMessage["parts"][number];
const assistant = (...parts: Part[]): UIMessage => ({
  id: "assistant",
  role: "assistant",
  parts: [{ type: "step-start" }, ...parts],
});
const pending: Part = {
  type: "tool-delete_file",
  state: "approval-requested",
  toolCallId: "old-call",
  input: { path: "old.txt" },
  approval: { id: "old-approval" },
};
const mcpResponse: Part = {
  type: "dynamic-tool",
  toolName: "delete_file", // Even a name collision isn't a native workspace tool.
  state: "approval-responded",
  toolCallId: "mcp-call",
  input: {},
  approval: { id: "mcp-approval", approved: true },
};
const canContinue = (message: UIMessage) =>
  lastAssistantMessageIsCompleteWithApprovalResponses({
    messages: withoutRetiredWorkspaceTools([message]),
  });

it("does not resume a previously responded workspace approval", () => {
  const oldResponse: Part = {
    ...pending,
    state: "approval-responded",
    approval: { id: "old-approval", approved: true },
  };
  expect(canContinue(assistant(oldResponse))).toBe(false);
  expect(hasPendingTools([assistant(pending, oldResponse)])).toBe(false);
});

it("preserves an MCP response in the same step as a retired pending approval", () => {
  const message = assistant(pending, mcpResponse);
  expect(canContinue(message)).toBe(true);
  expect(hasPendingTools([message])).toBe(true);
  expect(withoutRetiredWorkspaceTools([message])).toEqual([
    assistant(mcpResponse),
  ]);
  expect(message).toEqual(assistant(pending, mcpResponse));
});
