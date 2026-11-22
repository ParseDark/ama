import type { UIMessage } from "ai";
import type { ActivePage } from "./page-content";
import { readActivePage, readTabPage } from "./active-tab";
export class RunContext {
  captureTarget?: ActivePage["captureTarget"];
  captureTurnId?: string;
  private owned = new Set<number>();
  private approved = new Set<number>();
  constructor(public startTabId?: number) {}
  own(tab: number) {
    this.owned.add(tab);
  }
  owns(tab: number) {
    return this.owned.has(tab);
  }
  approve(tab: number) {
    this.approved.add(tab);
  }
  isAllowed(tab: number) {
    return (
      tab === this.startTabId || this.owned.has(tab) || this.approved.has(tab)
    );
  }
}
export class RunContexts {
  private contexts = new Map<string, RunContext>();
  constructor(
    private readActive: () => Promise<ActivePage | null> = readActivePage,
    private readTab: (id: number) => Promise<ActivePage | null> = readTabPage,
  ) {}
  async forRequest(chatId: string, messages: UIMessage[]) {
    let run = this.contexts.get(chatId);
    const turnId = messages.findLast((message) => message.role === "user")?.id;
    const continuation = messages.at(-1)?.role === "assistant";
    if (continuation && run?.startTabId !== undefined)
      return {
        run,
        page: await this.readTab(run.startTabId),
        captureTarget:
          run.captureTurnId === turnId ? run.captureTarget : undefined,
      };
    const page = await this.readActive();
    if (!run) {
      run = new RunContext();
      this.contexts.set(chatId, run);
    }
    run.startTabId = page?.tabId;
    if (run.captureTurnId !== turnId) {
      run.captureTurnId = turnId;
      run.captureTarget = continuation ? undefined : page?.captureTarget;
    }
    return { run, page, captureTarget: run.captureTarget };
  }
}
