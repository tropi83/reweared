import { z } from "zod";
import { GENERATION_ERROR_CODES, type AspectRatio, type GenerationError, type Locale } from "@aiv/domain/models";
import { startedRunDto } from "@aiv/contracts/generation";
import type { ApiClient } from "@/infrastructure/api/ApiClient";
import { runEventStream } from "@/infrastructure/api/sse";
import { toAppError } from "@/infrastructure/api/to-app-error";

export type StartedRun = z.infer<typeof startedRunDto>;

/** What `/api/v1/events` sends: ids, statuses and safe messages (never a prompt or an image). */
export const runEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("job"),
    jobId: z.string(),
    generationId: z.string(),
    listingId: z.string(),
    status: z.string(),
    attempt: z.number(),
    resultImageId: z.string().optional(),
    error: z.object({ code: z.string(), message: z.string() }).optional(),
  }),
  z.object({ type: z.literal("generation"), generationId: z.string(), listingId: z.string(), status: z.string() }),
  z.object({ type: z.literal("listing"), listingId: z.string() }),
  z.object({ type: z.literal("credits"), balance: z.number() }),
]);
export type RunEvent = z.infer<typeof runEvent>;

const TERMINAL = new Set(["completed", "failed", "cancelled"]);
export const isTerminalStatus = (status: string) => TERMINAL.has(status);

const KNOWN_CODES: ReadonlySet<string> = new Set(GENERATION_ERROR_CODES);

/** A failed job's event error in the app's vocabulary. */
export function eventError(error: { code: string; message: string } | undefined): GenerationError {
  if (!error) return { code: "UNKNOWN_ERROR", message: "The run failed.", retryable: false };
  return { code: KNOWN_CODES.has(error.code) ? (error.code as GenerationError["code"]) : "UNKNOWN_ERROR", message: error.message, retryable: false };
}

/**
 * Photo packs and listing copy run by the platform (API mode): the server plans, charges and queues them, its worker
 * generates, and progress comes back over SSE.
 */
export class RemoteRunEngine {
  constructor(private readonly client: ApiClient) {}

  startPhotos(listingId: string, body: { sourceImageId?: string; shotIds?: string[]; aspectRatio?: AspectRatio }): Promise<StartedRun> {
    return this.start(`/api/v1/listings/${encodeURIComponent(listingId)}/generations`, body);
  }

  startCopy(listingId: string, language: Locale): Promise<StartedRun> {
    return this.start(`/api/v1/listings/${encodeURIComponent(listingId)}/copy`, { language });
  }

  async cancel(jobId: string): Promise<void> {
    try {
      await this.client.request("POST", `/api/v1/jobs/${encodeURIComponent(jobId)}/cancel`);
    } catch (error) {
      throw toAppError(error);
    }
  }

  retry(jobId: string): Promise<StartedRun> {
    return this.start(`/api/v1/jobs/${encodeURIComponent(jobId)}/retry`);
  }

  /** Follows the account's events until the returned function is called; `onOpen` runs at each (re)connection. */
  watch(onEvent: (event: RunEvent) => void, onOpen: () => void): () => void {
    const controller = new AbortController();
    void runEventStream({
      url: this.client.url("/api/v1/events"),
      fetch: this.client.fetch,
      headers: () => this.client.headers({ accept: "text/event-stream" }),
      onEvent: (event) => {
        const parsed = runEvent.safeParse(event.data);
        if (parsed.success) onEvent(parsed.data);
      },
      onOpen,
      signal: controller.signal,
    });
    return () => controller.abort();
  }

  private async start(path: string, json?: unknown): Promise<StartedRun> {
    try {
      return await this.client.request("POST", path, { ...(json !== undefined ? { json } : {}), schema: startedRunDto });
    } catch (error) {
      throw toAppError(error);
    }
  }
}
