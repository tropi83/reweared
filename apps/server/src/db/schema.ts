import { boolean, check, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AppSettings, CategorySelection, ListingCopy, Recipe } from "@aiv/domain/models";
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
