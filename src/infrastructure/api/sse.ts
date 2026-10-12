export interface ServerEvent {
  id: string;
  data: unknown;
}

/** Incremental parser of a `text/event-stream` body: feed it chunks, it calls back once per complete event. */
export function createSseParser(onEvent: (event: ServerEvent) => void): (chunk: string) => void {
  let buffer = "";
  return (chunk) => {
    buffer += chunk.replace(/\r\n/g, "\n");
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let id = "";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith(":")) continue;
        if (line.startsWith("id:")) id = line.slice(3).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (data.length === 0) continue;
      try {
        onEvent({ id, data: JSON.parse(data.join("\n")) });
      } catch {
        // A malformed event is skipped; the stream goes on.
      }
    }
  };
}

export interface EventStreamOptions {
  url: string;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  headers: () => Promise<Record<string, string>>;
  onEvent: (event: ServerEvent) => void;
  /** Called when the stream is (re)connected, e.g. to refetch what may have changed meanwhile. */
  onOpen?: () => void;
  signal: AbortSignal;
  /** Delay before reconnecting after a drop; grows up to 30 s. */
  retryMs?: number;
}

/**
 * Keeps an SSE stream open with `fetch` (works with cookies on the web and with a bearer header in the Tauri apps,
 * which `EventSource` cannot send), resuming from the last event id after a drop.
 */
export async function runEventStream(options: EventStreamOptions): Promise<void> {
  let lastEventId = "";
  let delay = options.retryMs ?? 1_000;
  while (!options.signal.aborted) {
    try {
      const headers: Record<string, string> = { ...(await options.headers()), ...(lastEventId ? { "last-event-id": lastEventId } : {}) };
      const response = await options.fetch(options.url, { headers, credentials: headers.authorization ? "omit" : "include", signal: options.signal });
      if (!response.ok || !response.body) throw new Error(`event stream answered ${response.status}`);
      delay = options.retryMs ?? 1_000;
      options.onOpen?.();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const feed = createSseParser((event) => {
        if (event.id) lastEventId = event.id;
        options.onEvent(event);
      });
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        feed(decoder.decode(value, { stream: true }));
      }
    } catch {
      if (options.signal.aborted) return;
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, 30_000);
  }
}
