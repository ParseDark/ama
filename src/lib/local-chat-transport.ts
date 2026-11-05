import {
  streamText,
  convertToModelMessages,
  isStepCount,
  type ChatTransport,
  type LanguageModelUsage,
  type UIMessage,
  type ModelMessage,
} from "ai";
import {
  COMPACT_TRIGGER_RATIO,
  budgetPage,
  compactHistory,
  contextBudget,
  handoffMessage,
  hasPendingTools,
  modelMessageTokens,
  modelSummarizer,
  stepCut,
  summarizeText,
  textTokens,
  thinToolResults,
  validRecord,
  type CompactRecord,
  type Summarize,
} from "./compaction";
import { loadCompact, saveCompact } from "./sessions";
import { createChatHistoryTool } from "./chat-history-tool";
import {
  settingsStore,
  getConfigProblem,
  getEmbeddingConfig,
  getMcpServers,
  getWebSearchConfig,
  type Settings,
} from "./settings";
import { createModel } from "./model";
import { readActivePage, readTabPage } from "./active-tab";
import { RunContexts } from "./run-context";
import { McpTools, testMcpServer } from "./mcp-tools";
import { buildInstructions } from "./prompt";
import { createPageTools } from "./page-tools";
import { createFileTools } from "./files/tools";
import { createWebTools } from "./web-search/tools";
import { latestUserText, messageText, toolsUsedIn } from "./messages";
import { embedQuery } from "./memory/retrieval";
import { loadMemoryContext, planFor, referenceSearch } from "./memory/context";
import { splitMemoryBlocks } from "./memory/selector";
import { createMemoryTools } from "./memory/tools";
import { memoryModels } from "./memory/models";
import { judgeMemoryIntent } from "./memory/intent";
import { relateToExisting, judgeRelations } from "./memory/relation";
import { listMemories } from "./memory/store";
import { createHistoryTools } from "./history-tools";
import { createSettingsTools } from "./settings-tools";
import { createCodeTools } from "./code-tools";
import { createDataActions } from "./data/actions";
import { createDataTools } from "./data/tools";
import type { runCode } from "./code-runner";
import { searchHistory } from "./history-search";
import { filterMcpTools } from "./tool-filter";
import { hostnameOf } from "./url";
import { GenerationTracker, type GenerationStats } from "./generation-stats";
import {
  calibrate,
  estimatePrompt,
  type ContextBreakdown,
} from "./context-breakdown";

/** Last-step usage plus the run totals the meter and popup show. */
export interface ReplyUsage {
  model: string;
  contextTokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  total: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    cacheWriteTokens: number;
  };
  breakdown?: ContextBreakdown;
}

const counts = (usage: LanguageModelUsage | undefined) => ({
  input: usage?.inputTokens ?? 0,
  output: usage?.outputTokens ?? 0,
  cached: usage?.inputTokenDetails.cacheReadTokens ?? 0,
  write: usage?.inputTokenDetails.cacheWriteTokens ?? 0,
});

export class LocalChatTransport implements ChatTransport<UIMessage> {
  private runs: RunContexts;
  private mcp = new McpTools();
  private trackers = new Map<string, GenerationTracker>();
  interruptStats(chatId: string, status: "stopped" | "error") {
    const tracker = this.trackers.get(chatId);
    return tracker?.observe(
      status === "stopped"
        ? { type: "abort" }
        : { type: "error", error: "Interrupted" },
    );
  }
  async compact(chatId: string, messages: UIMessage[], signal?: AbortSignal) {
    if (hasPendingTools(messages))
      throw new Error("Finish or deny pending tool approvals before Compact.");
    const settings = await (
      this.options.loadSettings ?? (() => settingsStore.getValue())
    )();
    const problem = getConfigProblem(settings);
    if (problem) throw new Error(problem);
    const summarize =
      this.options.summarize ??
      modelSummarizer(
        await (this.options.createModel ?? createModel)(settings),
      );
    const record = await compactHistory(
      messages,
      await loadCompact(chatId),
      summarize,
      contextBudget(settings).input,
      `${settings.provider}/${settings.providers[settings.provider].model}`,
      signal,
    );
    if (!record)
      throw new Error(
        "Not enough completed history to compact. Two recent turns are retained.",
      );
    signal?.throwIfAborted();
    await saveCompact(chatId, record, signal);
    return record;
  }
  constructor(
    private options: {
      summarize?: Summarize;
      loadSettings?: () => Promise<Settings>;
      saveSettings?: (settings: Settings) => Promise<void>;
      readActivePage?: typeof readActivePage;
      readTabPage?: typeof readTabPage;
      createModel?: typeof createModel;
      embeddingFetch?: typeof fetch;
      webFetch?: typeof fetch;
      runCode?: typeof runCode;
      now?: () => number;
    } = {},
  ) {
    this.runs = new RunContexts(options.readActivePage, options.readTabPage);
  }
  async sendMessages({
    chatId,
    messages,
    abortSignal,
    trigger,
  }: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0]) {
    // An approval continuation extends the same assistant turn. New user turns
    // and retries after a user message start a fresh measurement.
    const last = messages.at(-1);
    const previous =
      trigger !== "regenerate-message" && last?.role === "assistant"
        ? (last.metadata as { generationStats?: GenerationStats } | undefined)
            ?.generationStats
        : undefined;
    const tracker = new GenerationTracker(this.options.now, previous);
    this.trackers.set(chatId, tracker);
    const loadSettings =
      this.options.loadSettings ?? (() => settingsStore.getValue());
    const settings = await loadSettings();
    const problem = getConfigProblem(settings);
    if (problem)
      throw new Error(
        `${problem} Open settings to configure ${settings.provider}.`,
      );
    const config = getEmbeddingConfig(settings),
      query = latestUserText(messages),
      queryVector = embedQuery(query, config, {
        fetchFn: this.options.embeddingFetch,
      });
    const [{ run, page }, mcp, memory] = await Promise.all([
      this.runs.forRequest(chatId, messages),
      this.mcp.load(getMcpServers(settings)),
      loadMemoryContext(queryVector, config),
    ]);
    const budget = contextBudget(settings);
    const model = await (this.options.createModel ?? createModel)(settings);
    const summarize = this.options.summarize ?? modelSummarizer(model);
    const saved = await loadCompact(chatId);
    let compact: CompactRecord | null = (await validRecord(saved, messages))
      ? saved
      : null;
    const domain = hostnameOf(page?.url),
      plan = planFor(memory, domain, config),
      models = memoryModels(settings);
    const remote = await filterMcpTools(mcp.tools, {
      queryVector: await queryVector,
      used: toolsUsedIn(messages),
      config,
    });
    const settingsTools = this.options.saveSettings
      ? createSettingsTools({
          load: loadSettings,
          save: this.options.saveSettings,
          testServer: (s) => testMcpServer(s),
        })
      : {};
    const data = createDataActions({ sessionId: chatId });
    const tools = {
      ...remote,
      ...createPageTools(run, { dangerMode: settings.dangerMode === true }),
      ...createFileTools(undefined, data),
      ...createCodeTools(data, this.options.runCode),
      ...createDataTools(data),
      ...createWebTools(settings, messages, this.options.webFetch),
      ...createChatHistoryTool(messages),
      ...createHistoryTools({
        search: (q) => searchHistory(q, { config, excludeSessionId: chatId }),
      }),
      ...settingsTools,
      ...createMemoryTools({
        domain,
        dangerMode: settings.dangerMode === true,
        userTexts: messages.filter((m) => m.role === "user").map(messageText),
        judgeIntent: () => judgeMemoryIntent(query, models),
        searchReferences: referenceSearch(memory, config),
        relate: async (text, scope) =>
          relateToExisting(text, scope, await listMemories(), {
            config,
            judge: (t, c) => judgeRelations(t, c, models),
            isCandidate: (m) => !m.disabled && m.status !== "dismissed",
          }),
      }),
    };
    const pageView = budgetPage(page, budget.input);
    const memoryBlocks = splitMemoryBlocks(plan, domain),
      instructions = buildInstructions(
        pageView,
        mcp.servers,
        memoryBlocks,
        getWebSearchConfig(settings),
        settings.dangerMode === true,
      );
    const autoCompact = settings.compaction?.enabled !== false;
    const modelView = async () => {
      const tail = await convertToModelMessages(
        messages.slice(compact?.covered ?? 0),
        { tools },
      );
      return compact ? [handoffMessage(compact.summary), ...tail] : tail;
    };
    let modelMessages = await modelView();
    const toolEstimate = await estimatePrompt({
      instructions: "",
      pageText: "",
      memoryText: "",
      tools,
      messages: [],
    });
    const fixedTokens =
      textTokens(instructions) + Math.ceil(toolEstimate.tools * 1.3);
    if (autoCompact) {
      modelMessages = thinToolResults(modelMessages);
      if (
        fixedTokens + modelMessageTokens(modelMessages) >
        budget.input * COMPACT_TRIGGER_RATIO
      ) {
        compact = await compactHistory(
          messages,
          compact,
          summarize,
          budget.input,
          `${settings.provider}/${settings.providers[settings.provider].model}`,
          abortSignal,
        );
        if (compact) {
          await saveCompact(chatId, compact, abortSignal);
          modelMessages = thinToolResults(await modelView());
        }
      }
    }
    const estimate = await estimatePrompt({
      instructions,
      pageText: pageView
        ? [
            pageView.markdown,
            pageView.elements.join("\n"),
            pageView.selection,
          ].join("\n")
        : "",
      memoryText: memoryBlocks.preferences + memoryBlocks.references,
      tools,
      messages: [],
    });
    // Measure the model-facing history, not the retained full UI transcript.
    estimate.conversation = Math.round(modelMessageTokens(modelMessages) / 1.3);
    let runCompact:
      | {
          count: number;
          beforeTokens: number;
          afterTokens: number;
          inputTokens: number;
          outputTokens: number;
          durationMs: number;
        }
      | undefined;
    // Usage is reported per step. Keep the first prompt and the latest context
    // so the meter can show the window and the breakdown can separate them.
    let firstStep: LanguageModelUsage | undefined,
      lastStep: LanguageModelUsage | undefined;
    const total = {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
    };
    const replyUsage = (fallback?: LanguageModelUsage): ReplyUsage => {
      const lastCounts = counts(lastStep ?? fallback),
        totalCounts = lastStep
          ? total
          : {
              inputTokens: lastCounts.input,
              outputTokens: lastCounts.output,
              cachedInputTokens: lastCounts.cached,
              cacheWriteTokens: lastCounts.write,
            };
      // Normally both come from finish-step. If a provider only reports usage
      // in the final chunk, fall back to that total so the popup still shows
      // prompt sources instead of a single "Reply" arc.
      const base = lastStep ?? firstStep ?? fallback,
        first = firstStep ?? base,
        last = lastStep ?? base,
        breakdown =
          base &&
          (base.inputTokens !== undefined || base.outputTokens !== undefined)
            ? calibrate(estimate, {
                firstInput: first?.inputTokens ?? 0,
                lastInput: last?.inputTokens ?? 0,
                output: last?.outputTokens ?? 0,
              })
            : undefined;
      return {
        model: `${settings.provider}/${settings.providers[settings.provider].model}`,
        contextTokens: lastCounts.input + lastCounts.output,
        inputTokens: lastCounts.input,
        outputTokens: lastCounts.output,
        cachedInputTokens: lastCounts.cached,
        ...(breakdown ? { breakdown } : {}),
        total: totalCounts,
      };
    };
    const result = streamText({
      model,
      instructions,
      messages: modelMessages,
      maxOutputTokens: budget.output,
      prepareStep: async ({ messages: stepMessages }) => {
        abortSignal?.throwIfAborted();
        let working: ModelMessage[] = autoCompact
          ? thinToolResults(stepMessages)
          : stepMessages;
        let size = fixedTokens + modelMessageTokens(working);
        if (autoCompact && size > budget.input * COMPACT_TRIGGER_RATIO) {
          const cut = stepCut(working);
          if (cut) {
            const started = performance.now();
            const beforeTokens = modelMessageTokens(working);
            const source = JSON.stringify(working.slice(cut.start, cut.end));
            const summary = await summarizeText(
              source,
              "",
              summarize,
              budget.input,
              abortSignal,
            );
            const replacement = handoffMessage(summary.summary);
            if (
              modelMessageTokens([replacement]) <
              modelMessageTokens(working.slice(cut.start, cut.end))
            ) {
              working = [
                ...working.slice(0, cut.start),
                replacement,
                ...working.slice(cut.end),
              ];
              const afterTokens = modelMessageTokens(working);
              size = fixedTokens + afterTokens;
              runCompact = {
                count: (runCompact?.count ?? 0) + 1,
                beforeTokens,
                afterTokens,
                inputTokens:
                  (runCompact?.inputTokens ?? 0) + summary.inputTokens,
                outputTokens:
                  (runCompact?.outputTokens ?? 0) + summary.outputTokens,
                durationMs:
                  (runCompact?.durationMs ?? 0) +
                  Math.round(performance.now() - started),
              };
            }
          }
        }
        if (size > budget.input)
          throw new Error(
            `Context budget exceeded (${size.toLocaleString()} estimated tokens; safe input budget ${budget.input.toLocaleString()}). Original history is retained. Use Compact, reduce the current request, or adjust the context-window override in Settings. Pending tools are never discarded.`,
          );
        return { messages: working };
      },
      tools,
      stopWhen: isStepCount(60),
      abortSignal,
    });
    const metadata = {
      ...(compact
        ? {
            compaction: {
              covered: compact.covered,
              createdAt: compact.createdAt,
              model: compact.model,
              beforeTokens: compact.beforeTokens,
              afterTokens: compact.afterTokens,
              inputTokens: compact.inputTokens,
              outputTokens: compact.outputTokens,
              durationMs: compact.durationMs,
            },
          }
        : {}),
      ...(plan.injected.length
        ? {
            usedMemories: plan.injected.map(({ id, text, scope }) => ({
              id,
              text,
              scope,
            })),
          }
        : {}),
    };
    return result.toUIMessageStream({
      onError: (e) => (e instanceof Error ? e.message : String(e)),
      messageMetadata: ({ part }) => {
        if (part.type === "finish-step") {
          firstStep ??= part.usage;
          lastStep = part.usage;
          const step = counts(part.usage);
          total.inputTokens += step.input;
          total.outputTokens += step.output;
          total.cachedInputTokens += step.cached;
          total.cacheWriteTokens += step.write;
        }
        const generationStats = tracker.observe(part);
        if (part.type === "finish") {
          const usage = replyUsage(part.totalUsage);
          return {
            ...(metadata ?? {}),
            usage,
            ...(runCompact ? { runCompaction: runCompact } : {}),
            ...(generationStats ? { generationStats } : {}),
          };
        }
        if (!generationStats) return undefined;
        return {
          ...(part.type === "start" ? metadata : {}),
          generationStats,
        };
      },
    });
  }
  reconnectToStream = async () => null;
}
