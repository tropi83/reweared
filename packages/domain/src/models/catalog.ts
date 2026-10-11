import type { Locale } from "./settings";

/** Short localized string kept in data files (catalogue labels), as opposed to UI strings in i18n/. */
export type Localized = Record<Locale, string>;

export type CategoryId = "women" | "men" | "kids" | "home" | "electronics" | "entertainment" | "hobbies" | "sport" | "pets" | "luxury";

/**
 * What the object physically is. Drives the 4-shot plan: a shirt is photographed worn and folded,
 * a phone in hand and from the back, a trading card in a sleeve with its corners in focus.
 */
export type ProductKind =
  | "garment"
  | "footwear"
  | "bag"
  | "accessory"
  | "jewelry"
  | "watch"
  | "beauty"
  | "toy"
  | "childcare"
  | "stationery"
  | "decor"
  | "home-textile"
  | "kitchenware"
  | "tableware"
  | "storage"
  | "furniture"
  | "phone"
  | "computer"
  | "audio"
  | "camera"
  | "gaming"
  | "smart-device"
  | "book"
  | "board-game"
  | "video-game"
  | "disc"
  | "vinyl"
  | "trading-card"
  | "figurine"
  | "collectible"
  | "instrument"
  | "sport-gear"
  | "outdoor"
  | "bike"
  | "pet-clothing"
  | "pet-toy"
  | "pet-accessory"
  | "pet-bedding"
  | "pet-carrier"
  | "leather-goods";

export interface Subcategory {
  id: string;
  label: Localized;
  kind: ProductKind;
  /** English noun phrase injected into prompts and copy requests ("women's shirt or top"). */
  subject: string;
}

export interface Category {
  id: CategoryId;
  label: Localized;
  /** Who wears/uses the item in "in use" shots ("a woman", "a child (face not visible)"). */
  wearer: string;
  subcategories: Subcategory[];
}

/** One of the photos of a listing pack (four, plus a mirror selfie for fashion items). */
export interface ShotSpec {
  /** Stable id inside the plan ("retouch", "studio", "worn", "folded"…). */
  id: string;
  label: Localized;
  /** Final English prompt (subject/wearer already interpolated). */
  prompt: string;
}

export interface CategorySelection {
  categoryId: CategoryId;
  subcategoryId: string;
}

export type ListingCondition = "new_with_tags" | "new" | "very_good" | "good" | "satisfactory";

/** Title + description generated from the original photo. Editable by the user, stored in the listing. */
export interface ListingCopy {
  title: string;
  description: string;
  condition?: ListingCondition;
  brand?: string;
  color?: string;
  keywords: string[];
  language: Locale;
  generatedAt: string;
  provider: string;
  model: string;
}
