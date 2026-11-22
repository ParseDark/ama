import {
  streamText,
  convertToModelMessages,
  isStepCount,
  wrapLanguageModel,
  generateId,
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
import { McpTools, testMcpServer, getMcpToolInfo } from "./mcp-tools";
import { RunContext } from "./run-context";
import {
  describeComposerTools,
  requestedComposerTool,
  type ComposerToolCatalog,
} from "./composer-tools";
import { buildInstructions } from "./prompt";
import { createPageTools } from "./page-tools";
import type { CaptureImage } from "./capture-image";
import {
  capturePageImage,
  createPageVisualTools,
  isPageVisualTool,
  nativeCapturePart,
  CaptureAttempts,
  type CaptureFeedback,
  type PageVisualTool,
} from "./page-visual-tools";
import {
  captureEvidence,
  captureTokens,
  imageInputError,
  IMAGE_INPUT_ERROR,
  LiveCapture,
  pairedCapture,
} from "./live-capture";
import { createWebTools } from "./web-search/tools";
import { latestUserText, messageText, toolsUsedIn } from "./messages";
import { withoutRetiredWorkspaceTools } from "./retired-workspace-tools";
import { embedQuery } from "./memory/retrieval";
import { loadMemoryContext, planFor, referenceSearch } from "./memory/context";
import { splitMemoryBlocks } from "./memory/selector";
import { sourcedSignal } from "./memory/provenance";
import { sensitiveDomain } from "./memory/signals";
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
  private captureAttempts = new CaptureAttempts();
  private liveCapture: LiveCapture;
  private captureEpoch = 0;
  clearCapture() {
    this.captureEpoch++;
    this.liveCapture.clear();
  }
  private trackers = new Map<string, GenerationTracker>();
  interruptStats(chatId: string, status: "stopped" | "error") {
    this.clearCapture();
    const tracker = this.trackers.get(chatId);
    return tracker?.observe(
      status === "stopped"
        ? { type: "abort" }
        : { type: "error", error: "Interrupted" },
    );
  }
  /** Discover schemas only: never read page contents or execute a tool. */
  async composerTools(
    chatId: string,
    onNative?: (catalog: ComposerToolCatalog) => void,
  ): Promise<ComposerToolCatalog> {
    const settings = await (
      this.options.loadSettings ?? (() => settingsStore.getValue())
    )();
    const data = createDataActions({ sessionId: chatId });
    const native = {
      ...createPageTools(new RunContext()),
      ...createPageVisualTools(),
      ...createCodeTools(data, this.options.runCode),
      ...createDataTools(data),
      ...createWebTools(settings, []),
      ...createChatHistoryTool([]),
      ...createHistoryTools({ search: async () => [] }),
      ...(this.options.saveSettings
        ? createSettingsTools({ save: this.options.saveSettings })
        : {}),
      ...createMemoryTools({
        userTexts: [],
        judgeIntent: async () => false,
        searchReferences: async () => [],
      }),
    };
    onNative?.({
      tools: describeComposerTools(native, "Built-in tools"),
      errors: [],
    });
    const remote = await this.mcp.load(getMcpServers(settings));
    return {
      tools: [
        ...describeComposerTools(native, "Built-in tools"),
        ...describeComposerTools(remote.tools, "MCP").map((tool) => ({
          ...tool,
          group: `MCP · ${getMcpToolInfo(tool.name)?.server ?? "server"}`,
        })),
      ],
      errors: remote.servers
        .filter((s) => !s.ok)
        .map((s) => `${s.name}: ${s.error ?? "Unavailable"}`),
    };
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
      captureImage?: typeof capturePageImage;
    } = {},
  ) {
    this.runs = new RunContexts(options.readActivePage, options.readTabPage);
    this.liveCapture = new LiveCapture(options.now);
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
    const continuation =
      trigger !== "regenerate-message" && last?.role === "assistant";
    const captureEpoch = ++this.captureEpoch;
    if (!continuation) this.liveCapture.clear();
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
    if (problem) {
      this.liveCapture.clear();
      throw new Error(
        `${problem} Open settings to configure ${settings.provider}.`,
      );
    }
    const currentModel = settings.providers[settings.provider];
    const turnId =
      messages.findLast((message) => message.role === "user")?.id ?? "";
    const captureKey = {
      chatId,
      turnId,
      model: JSON.stringify([
        settings.provider,
        currentModel.model,
        currentModel.baseURL,
        currentModel.apiKey,
      ]),
    };
    this.liveCapture.resume(captureKey, continuation);
    const config = getEmbeddingConfig(settings),
      query = latestUserText(messages),
      queryVector = embedQuery(query, config, {
        fetchFn: this.options.embeddingFetch,
      });
    const [{ run, page, captureTarget }, mcp, memory] = await Promise.all([
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
    const selectedTool = requestedComposerTool(query);
    const retainedTools = toolsUsedIn(withoutRetiredWorkspaceTools(messages));
    if (selectedTool) retainedTools.add(selectedTool.name);
    const remote = await filterMcpTools(mcp.tools, {
      queryVector: await queryVector,
      used: retainedTools,
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
    let candidate = this.liveCapture.candidate(captureKey);
    if (!candidate && continuation && last?.role === "assistant") {
      const part = last.parts.find(
        (p) =>
          nativeCapturePart(p) &&
          "state" in p &&
          p.state === "output-available" &&
          (p.output as { ok?: boolean } | undefined)?.ok,
      );
      if (part && "toolCallId" in part)
        candidate = {
          id: part.toolCallId,
          name: part.type.slice(5) as PageVisualTool,
        };
    }
    const tools = {
      ...remote,
      ...createPageTools(run, { dangerMode: settings.dangerMode === true }),
      ...createPageVisualTools({
        target: captureTarget,
        claim: () =>
          !!turnId && this.captureAttempts.claim(chatId, turnId, messages),
        capture: this.options.captureImage,
        receive: (image, name, id, target) => {
          if (this.captureEpoch !== captureEpoch || abortSignal?.aborted)
            return false;
          this.liveCapture.put(captureKey, id, name, image, target);
          candidate = { id, name };
          return true;
        },
      }),
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
        source: (() => {
          const message = messages.findLast((m) => m.role === "user");
          return message &&
            !(message.metadata as any)?.incognito &&
            !sensitiveDomain(domain)
            ? sourcedSignal(
                chatId,
                message.id,
                "user_msg",
                messageText(message).slice(0, 500),
                domain,
              ).source
            : undefined;
        })(),
        privateContext:
          !!(messages.findLast((m) => m.role === "user")?.metadata as any)
            ?.incognito || sensitiveDomain(domain),
        dangerMode: settings.dangerMode === true,
        userTexts: messages.filter((m) => m.role === "user").map(messageText),
        judgeIntent: () => judgeMemoryIntent(query, models),
        searchReferences: referenceSearch(memory, config, domain),
        relate: async (text, scope) =>
          relateToExisting(text, scope, await listMemories(), {
            config,
            judge: (t, c) => judgeRelations(t, c, models),
            isCandidate: (m) => !m.disabled && m.status !== "dismissed",
          }),
      }),
    };
    if (selectedTool && !(selectedTool.name in tools))
      throw new Error(
        `Selected tool ${selectedTool.name} is unavailable. Refresh the @ tool list or check its settings.`,
      );
    const pageView = budgetPage(page, budget.input);
    const memoryBlocks = splitMemoryBlocks(plan, domain),
      instructions = buildInstructions(
        pageView,
        mcp.servers,
        memoryBlocks,
        getWebSearchConfig(settings),
        settings.dangerMode === true,
        selectedTool?.name,
      );
    const autoCompact = settings.compaction?.enabled !== false;
    const modelView = async () => {
      const tail = await convertToModelMessages(
        withoutRetiredWorkspaceTools(messages.slice(compact?.covered ?? 0)),
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
    // The SDK carries prepareStep's messages into step history. Strip the
    // evidence label before processing; pixels are added only at dispatch.
    const transient = new WeakSet<ModelMessage>();
    let imageStep:
      | {
          id: string;
          sent: boolean;
          image?: CaptureImage;
          watch: {
            check: (signal?: AbortSignal) => Promise<void>;
            dispose: () => void;
          };
        }
      | undefined;
    let captureFeedback: CaptureFeedback | undefined;
    let waitingForApproval = false;
    const disposeImageStep = () => {
      if (!imageStep) return;
      imageStep.image = undefined;
      imageStep.watch.dispose();
    };
    const discard = () => {
      disposeImageStep();
      if (this.captureEpoch === captureEpoch) this.clearCapture();
    };
    abortSignal?.addEventListener("abort", discard, { once: true });
    if (abortSignal?.aborted) discard();
    const result = streamText({
      model: wrapLanguageModel({
        model,
        middleware: {
          specificationVersion: "v4",
          wrapStream: async ({ doStream, params }) => {
            const step = imageStep;
            if (!step) return doStream();
            const last = params.prompt.at(-1);
            if (last?.role !== "user")
              throw new Error(
                "The screenshot evidence could not be paired with its tool result.",
              );
            try {
              await step.watch.check(params.abortSignal);
              if (this.captureEpoch !== captureEpoch || !step.image)
                throw new Error();
            } catch {
              params.abortSignal?.throwIfAborted();
              const note =
                "The starting page or chat changed before the screenshot could be sent.";
              last.content = [
                {
                  type: "text",
                  text: `AMA visual evidence unavailable: ${note} Continue with text, not guesses.`,
                },
              ];
              captureFeedback = { toolCallId: step.id, note, failed: true };
              disposeImageStep();
              imageStep = undefined;
              return doStream();
            }
            const content = last.content;
            last.content = [
              ...content,
              {
                type: "file",
                data: { type: "data", data: step.image.bytes },
                mediaType: "image/jpeg",
              },
            ];
            step.sent = true;
            disposeImageStep();
            try {
              // The adapter has the image only for this call. Do not keep a
              // second copy in request metadata or in the SDK's model history.
              return { ...(await doStream()), request: undefined };
            } catch (error) {
              params.abortSignal?.throwIfAborted();
              // A plain Error is non-retryable in the AI SDK. Keep normal text
              // request retries unchanged and do not retain provider request bodies.
              throw new Error(
                imageInputError(error)
                  ? IMAGE_INPUT_ERROR
                  : error instanceof Error
                    ? error.message
                    : "The model request with the screenshot failed.",
              );
            } finally {
              last.content = content;
            }
          },
        },
      }),
      instructions:
        settings.provider === "anthropic"
          ? {
              role: "system",
              content: instructions,
              providerOptions: {
                anthropic: { cacheControl: { type: "ephemeral", ttl: "5m" } },
              },
            }
          : instructions,
      messages: modelMessages,
      maxOutputTokens: budget.output,
      prepareStep: async ({ messages: stepMessages }) => {
        abortSignal?.throwIfAborted();
        imageStep = undefined;
        const textHistory = stepMessages.filter(
          (message) => !transient.has(message),
        );
        let working: ModelMessage[] = autoCompact
          ? thinToolResults(textHistory)
          : textHistory;
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
        if (candidate && pairedCapture(working, candidate.id)) {
          const { id, name } = candidate;
          candidate = undefined;
          const live = await this.liveCapture.take(captureKey, id, abortSignal);
          const note = !live
            ? "The screenshot is no longer available or its starting page changed. Continue with text or ask again from that page."
            : size + captureTokens(live.image) > budget.input
              ? "The screenshot did not fit the safe context budget. Continue with text or shorten the conversation before asking again."
              : undefined;
          if (note) {
            live?.watch.dispose();
            captureFeedback = { toolCallId: id, note, failed: true };
          } else if (live) {
            imageStep = {
              id,
              sent: false,
              image: live.image,
              watch: live.watch,
            };
          }
          const evidence = captureEvidence(
            name,
            note ? undefined : live?.image,
            note,
          );
          if (!note || size + modelMessageTokens([evidence]) <= budget.input) {
            transient.add(evidence);
            return { messages: [...working, evidence] };
          }
        }
        return { messages: working };
      },
      onAbort: discard,
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
      originalMessages: messages,
      generateMessageId: generateId,
      onEnd: ({ isAborted, isCancelled, outcome }) => {
        abortSignal?.removeEventListener("abort", discard);
        disposeImageStep();
        if (
          isAborted ||
          isCancelled ||
          outcome.status !== "completed" ||
          !waitingForApproval
        )
          discard();
      },
      onError: (error) => {
        const rejected = imageStep?.sent && imageInputError(error);
        return rejected
          ? IMAGE_INPUT_ERROR
          : error instanceof Error
            ? error.message
            : String(error);
      },
      messageMetadata: ({ part }) => {
        if (part.type === "start-step") waitingForApproval = false;
        if (part.type === "tool-approval-request") waitingForApproval = true;
        if (part.type === "error") {
          if (imageStep?.sent)
            captureFeedback = {
              toolCallId: imageStep.id,
              note: imageInputError(part.error)
                ? IMAGE_INPUT_ERROR
                : "The model request with the screenshot failed.",
              failed: true,
            };
          discard();
        }
        if (part.type === "finish-step") {
          if (imageStep?.sent && !captureFeedback)
            captureFeedback = {
              toolCallId: imageStep.id,
              note: "Image accepted by the selected model",
            };
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
            ...(captureFeedback ? { captureFeedback } : {}),
          };
        }
        if (!generationStats && !captureFeedback) return undefined;
        return {
          ...(part.type === "start" ? metadata : {}),
          ...(generationStats ? { generationStats } : {}),
          ...(captureFeedback ? { captureFeedback } : {}),
        };
      },
    });
  }
  reconnectToStream = async () => null;
}
