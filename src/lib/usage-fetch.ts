interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: unknown;
  completion_tokens_details?: unknown;
}

function merge(previous: Usage | undefined, next: Usage): Usage {
  if (!previous) return next;
  const prompt = Math.max(previous.prompt_tokens ?? 0, next.prompt_tokens ?? 0),
    completion = Math.max(
      previous.completion_tokens ?? 0,
      next.completion_tokens ?? 0,
    );
  const promptDetails =
    next.prompt_tokens_details ?? previous.prompt_tokens_details;
  return {
    ...previous,
    ...next,
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    ...(promptDetails !== undefined
      ? { prompt_tokens_details: promptDetails }
      : {}),
  };
}

/**
 * Rewrites each SSE usage chunk to the running total, so the last one (the one
 * the SDK keeps) covers the request. Some gateways send a first chunk with the
 * real prompt tokens and a second with only the completion count; keeping the
 * last chunk verbatim would report 0 input tokens.
 */
export function mergeSplitUsage(fetchFn: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await fetchFn(input, init);
    if (
      !response.body ||
      !response.headers.get("content-type")?.includes("text/event-stream")
    )
      return response;
    let usage: Usage | undefined,
      buffer = "";
    const rewrite = (line: string) => {
      if (!line.startsWith("data: {")) return line;
      try {
        const chunk = JSON.parse(line.slice(6)) as { usage?: Usage | null };
        if (!chunk.usage) return line;
        usage = merge(usage, chunk.usage);
        return `data: ${JSON.stringify({ ...chunk, usage })}`;
      } catch {
        return line;
      }
    };
    const body = response.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(
        new TransformStream<string, string>({
          transform(text, controller) {
            buffer += text;
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) controller.enqueue(`${rewrite(line)}\n`);
          },
          flush(controller) {
            if (buffer) controller.enqueue(rewrite(buffer));
          },
        }),
      )
      .pipeThrough(new TextEncoderStream());
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
