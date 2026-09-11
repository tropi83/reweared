import type { GenerationError } from "./errors";

export type AspectRatio = "original" | "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9" | "21:9";

export const ALL_ASPECT_RATIOS: AspectRatio[] = ["original", "1:1", "4:5", "5:4", "3:4", "4:3", "2:3", "3:2", "16:9", "9:16", "21:9"];

export type ImageSize = "512px" | "1K" | "2K" | "4K";

export interface GenerationSettings {
  providerId: string;
  modelId: string;
  aspectRatio: AspectRatio;
  imageSize?: ImageSize;
  /** Provider-specific options as chosen in the composer (e.g. diffusion strength). */
  providerOptions?: Record<string, string | number | boolean>;
  /** Number of independent variations requested. */
  variationCount: number;
}

export type GenerationStatus = "active" | "completed" | "partial" | "failed" | "cancelled";

/**
 * A Generation groups the N independent jobs launched together from one source + one prompt.
 * It is the node of the branch tree: `parentGenerationId` points to the generation that
 * produced `sourceImageId` (undefined when the source is the imported original).
 */
export interface Generation {
  id: string;
  projectId: string;
  /** Image used as input. May be an imported original or any previous result. */
  sourceImageId: string;
  parentGenerationId?: string;
  prompt: string;
  recipeId?: string;
  settings: GenerationSettings;
  status: GenerationStatus;
  jobIds: string[];
  createdAt: string;
  completedAt?: string;
}

export type JobStatus = "queued" | "generating" | "completed" | "failed" | "cancelled";

export interface GenerationJob {
  id: string;
  projectId: string;
  generationId: string;
  sourceImageId: string;
  /** 1-based position inside its generation, for display ("Variation 3"). */
  index: number;
  prompt: string;
  provider: string;
  model: string;
  aspectRatio: AspectRatio;
  imageSize?: ImageSize;
  providerOptions?: Record<string, string | number | boolean>;
  /** Random seed given to deterministic providers so each variation differs; kept for reproducibility. */
  seed?: number;
  status: JobStatus;
  /** Number of attempts made so far (0 before the first request). */
  attempt: number;
  resultImageId?: string;
  error?: GenerationError;
  /** Set while waiting for an automatic retry (ISO timestamp of the next attempt). */
  nextRetryAt?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export const TERMINAL_JOB_STATUSES: ReadonlySet<JobStatus> = new Set(["completed", "failed", "cancelled"]);

export function isTerminalJob(job: Pick<GenerationJob, "status">): boolean {
  return TERMINAL_JOB_STATUSES.has(job.status);
}

/** Derives the aggregate generation status from its jobs. */
export function deriveGenerationStatus(jobs: ReadonlyArray<Pick<GenerationJob, "status">>): GenerationStatus {
  if (jobs.length === 0) return "failed";
  if (jobs.some((j) => !isTerminalJob(j))) return "active";
  const completed = jobs.filter((j) => j.status === "completed").length;
  if (completed === jobs.length) return "completed";
  if (completed > 0) return "partial";
  if (jobs.every((j) => j.status === "cancelled")) return "cancelled";
  return "failed";
}
