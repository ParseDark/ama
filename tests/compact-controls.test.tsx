import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import type { LocalChatTransport } from "@/lib/local-chat-transport";
import { useCompact } from "@/hooks/use-compact";

it("shares Compact's single-flight state, cancellation, failures and pending-approval guard", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  let control!: ReturnType<typeof useCompact>;
  let finish!: () => void;
  const compact = vi.fn(
    (_id: string, _messages: UIMessage[], _signal?: AbortSignal) =>
      new Promise<null>((resolve) => {
        finish = () => resolve(null);
      }),
  );
  const transport = { compact } as unknown as LocalChatTransport;
  const messages: UIMessage[] = [
    { id: "user", role: "user", parts: [{ type: "text", text: "hello" }] },
  ];
  function Harness({
    busy = false,
    items = messages,
  }: {
    busy?: boolean;
    items?: UIMessage[];
  }) {
    control = useCompact({
      id: "shared-compact",
      messages: items,
      busy,
      transport,
    });
    return null;
  }
  const node = document.createElement("div");
  const root = createRoot(node);
  try {
    await act(async () => root.render(<Harness busy />));
    await act(async () => {
      expect(await control.compact()).toBe(false);
    });
    expect(compact).not.toHaveBeenCalled();
    await act(async () => root.render(<Harness />));
    let first!: Promise<boolean>;
    await act(async () => {
      first = control.compact();
      expect(await control.compact()).toBe(false);
    });
    expect(compact).toHaveBeenCalledTimes(1);
    expect(control.running).toBe(true);
    expect(control.disabledReason).toContain("already running");
    const signal = compact.mock.calls[0][2]!;
    await act(async () => control.cancel());
    expect(signal.aborted).toBe(true);
    expect(control.running).toBe(false);
    await act(async () => {
      finish();
      await first;
    });
    compact.mockImplementationOnce(async () => {
      throw new Error("provider unavailable");
    });
    await act(async () => {
      await control.compact();
    });
    expect(control.error).toBe("provider unavailable");
    expect(control.running).toBe(false);
    await act(async () =>
      root.render(
        <Harness
          items={[
            ...messages,
            {
              id: "approval",
              role: "assistant",
              parts: [
                {
                  type: "tool-click",
                  toolCallId: "pending",
                  state: "approval-requested",
                  input: { id: 1 },
                  approval: { id: "permission" },
                },
              ],
            },
          ]}
        />,
      ),
    );
    expect(control.disabledReason).toContain("approvals");
    await act(async () => {
      expect(await control.compact()).toBe(false);
    });
    expect(compact).toHaveBeenCalledTimes(2);
    await act(async () => root.render(<Harness />));
    await act(async () => {
      void control.compact();
    });
    const unmountSignal = compact.mock.calls[2][2]!;
    await act(async () => root.unmount());
    expect(unmountSignal.aborted).toBe(true);
    finish();
  } finally {
    await act(async () => root.unmount());
    node.remove();
  }
});
