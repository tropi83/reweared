import { boolean, check, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type {
  AppSettings,
  AspectRatio,
  CategorySelection,
  GenerationError,
  GenerationSettings,
  GenerationStatus,
  ImageSize,
  ListingCopy,
  Localized,
  Recipe,
} from "@aiv/domain/models";
import { user } from "./auth-schema";

export * from "./auth-schema";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

/** One listing (the item being sold). Every row belongs to one user and goes when the user goes. */
export const listing = pgTable(
  "listing",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    originalImageId: text("original_image_id"),
    coverImageId: text("cover_image_id"),
    category: jsonb("category").$type<CategorySelection>(),
    brand: text("brand"),
    useMannequin: boolean("use_mannequin").default(false).notNull(),
    copy: jsonb("copy").$type<ListingCopy>(),
    toPost: jsonb("to_post").$type<string[]>().default([]).notNull(),
    ...timestamps,
  },
  (t) => [index("listing_user_updated_idx").on(t.userId, t.updatedAt.desc())],
);

/** Metadata of a stored image; the bytes (full size and thumbnail) live in the object store under `objectKey` / `thumbKey`. */
export const imageAsset = pgTable(
  "image_asset",
  {
    id: text("id").primaryKey(),
    listingId: text("listing_id")
      .notNull()
      .references(() => listing.id, { onDelete: "cascade" }),
    // Denormalized for scoping every lookup by the session user without a join.
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"original" | "generation">().notNull(),
    mimeType: text("mime_type").$type<"image/png" | "image/jpeg" | "image/webp">().notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    byteSize: integer("byte_size").notNull(),
    fileName: text("file_name"),
    objectKey: text("object_key").notNull(),
    thumbKey: text("thumb_key").notNull(),
    sha256: text("sha256").notNull(),
    generationId: text("generation_id"),
    jobId: text("job_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("image_asset_listing_idx").on(t.listingId),
    index("image_asset_user_idx").on(t.userId),
    check("image_asset_kind_check", sql`${t.kind} in ('original', 'generation')`),
    check("image_asset_mime_check", sql`${t.mimeType} in ('image/png', 'image/jpeg', 'image/webp')`),
  ],
);

/** The user-level settings subset (`userSettingsDto`); device and provider settings stay on the device. */
export type StoredUserSettings = Pick<AppSettings, "locale" | "theme" | "vintedAutomationAcknowledged" | "defaultAspectRatio" | "mannequin">;

export const userSettings = pgTable("user_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  settings: jsonb("settings").$type<StoredUserSettings>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** A user's custom recipe; built-in recipes come from the catalogue and are never stored. */
export const recipe = pgTable(
  "recipe",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    data: jsonb("data").$type<Omit<Recipe, "builtIn">>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("recipe_user_idx").on(t.userId)],
);

/** Server-side job lifecycle; exposed to clients as the domain's JobStatus (dispatched → queued, active → generating). */
export type ServerJobStatus = "queued" | "dispatched" | "active" | "completed" | "failed" | "cancelled";
export type GenerationKind = "images" | "copy";

/** A run the user asked for: a photo pack (one job per shot) or the listing's title and description (one job). */
export const generation = pgTable(
  "generation",
  {
    id: text("id").primaryKey(),
    listingId: text("listing_id")
      .notNull()
      .references(() => listing.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").$type<GenerationKind>().notNull(),
    sourceImageId: text("source_image_id"),
    parentGenerationId: text("parent_generation_id"),
    prompt: text("prompt").notNull().default(""),
    category: jsonb("category").$type<CategorySelection>(),
    settings: jsonb("settings").$type<GenerationSettings>().notNull(),
    status: text("status").$type<GenerationStatus>().notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("generation_listing_idx").on(t.listingId),
    check("generation_kind_check", sql`${t.kind} in ('images', 'copy')`),
    check("generation_status_check", sql`${t.status} in ('active', 'completed', 'partial', 'failed', 'cancelled')`),
  ],
);

/** One provider request. Prompts live here, never in Redis (BullMQ job data carries the id only). */
export const generationJob = pgTable(
  "generation_job",
  {
    id: text("id").primaryKey(),
    generationId: text("generation_id")
      .notNull()
      .references(() => generation.id, { onDelete: "cascade" }),
    listingId: text("listing_id")
      .notNull()
      .references(() => listing.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").$type<GenerationKind>().notNull(),
    index: integer("index").notNull(),
    sourceImageId: text("source_image_id"),
    prompt: text("prompt").notNull(),
    shotId: text("shot_id"),
    shotLabel: jsonb("shot_label").$type<Localized>(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    aspectRatio: text("aspect_ratio").$type<AspectRatio>().notNull().default("original"),
    imageSize: text("image_size").$type<ImageSize>(),
    providerOptions: jsonb("provider_options").$type<Record<string, string | number | boolean>>(),
    seed: integer("seed"),
    status: text("status").$type<ServerJobStatus>().notNull().default("queued"),
    attempt: integer("attempt").notNull().default(0),
    credits: integer("credits").notNull(),
    resultImageId: text("result_image_id"),
    error: jsonb("error").$type<GenerationError>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("generation_job_user_status_idx").on(t.userId, t.status, t.createdAt),
    index("generation_job_status_dispatched_idx").on(t.status, t.dispatchedAt),
    index("generation_job_generation_idx").on(t.generationId),
    check("generation_job_status_check", sql`${t.status} in ('queued', 'dispatched', 'active', 'completed', 'failed', 'cancelled')`),
    check("generation_job_credits_check", sql`${t.credits} >= 0`),
  ],
);

/** Append-only history of credit movements; every balance change has exactly one row here. */
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    reason: text("reason").$type<"grant" | "reserve" | "refund" | "adjust">().notNull(),
    jobId: text("job_id"),
    generationId: text("generation_id"),
    // reserve:<generationId>, refund:<jobId>, grant:<userId>:<YYYY-MM> — a replay is a no-op.
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("credit_ledger_user_idx").on(t.userId, t.createdAt),
    check("credit_ledger_reason_check", sql`${t.reason} in ('grant', 'reserve', 'refund', 'adjust')`),
  ],
);

/** Current balance, kept in step with the ledger in the same transaction; never negative. */
export const creditBalance = pgTable(
  "credit_balance",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    balance: integer("balance").notNull().default(0),
    plan: text("plan").notNull().default("free"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [check("credit_balance_non_negative", sql`${t.balance} >= 0`)],
);
