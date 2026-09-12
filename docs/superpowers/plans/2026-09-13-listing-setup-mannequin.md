# Listing setup (brand, mannequin, one "Create the listing" button) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Resuming?** Read the "Progress" section at the bottom first: it says which tasks are done (with commits) and any deviation from the text below.

**Goal:** After importing a photo the user fills one "Listing" card (brand, category, subcategory, optional "My mannequin") and presses one button that generates the listing photos and the title/description in parallel.

**Architecture:** Pure domain helpers describe the mannequin (`domain/services/mannequin.ts`) and inject it into the catalogue's person shots (`listing-catalog.ts`); the copy prompt learns the seller's brand (`listing-copy.ts`). The app layer gets one orchestration action, `useListingStore.createListing()`, plus a pure readiness helper. The UI replaces `ListingComposer` with `ListingSetupCard` (+ `AdvancedOptions`, `useComposerDefaults`) and adds a `MannequinDialog` and a Settings section.

**Tech Stack:** React 19, TypeScript 6 (strict, `noUncheckedIndexedAccess`), zustand 5, Tailwind 4, Vitest 4 + jsdom + Testing Library, pnpm 10.

**Spec:** `docs/superpowers/specs/2026-09-13-listing-setup-mannequin-design.md` (decisions table in §1 is binding).

## Global Constraints

- Branch `feat/vinted-publish`; Conventional Commits; every commit message ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Before every commit: `pnpm check` green (typecheck + lint + prettier + all tests + prefill freshness). Format touched files with `pnpm exec prettier --write <files>`.
- All user-facing strings through `src/i18n` (`en.ts` source, `fr.ts` overrides). React 19 hook rules: no `setState` inside effects; use the "adjust state during render" pattern.
- Layering: `domain` imports nothing from `app`/`features`/`infrastructure`; `app` may import `domain` + `infrastructure`; `features` import `app`, `domain`, `components`, `i18n`.
- Mannequin applies to every shot whose template contains `{{wearer}}`, never for categories `kids` and `pets`. One mannequin, stored in `AppSettings.mannequin`. Brand goes to the copy prompt only, never to image prompts. Brand max 60 characters, stored raw, trimmed when used.
- The main button runs photos and text with `Promise.allSettled`; a missing provider skips its part, a failure of one part never cancels the other.
- Windows shell note: the Bash tool corrupts long heredocs — write files with the Write tool.

## File map

| File                                                  | Responsibility                                                                                              |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `src/domain/models/mannequin.ts` (new)                | Mannequin types, option lists, UI swatches, default                                                         |
| `src/domain/services/mannequin.ts` (new)              | Prompt phrases, applicability, normalization                                                                |
| `src/domain/services/listing-catalog.ts`              | `{{pose                                                                                                     | default}}`slot,`buildListingShots(selection, { mannequin })` |
| `src/domain/services/listing-copy.ts`                 | `brand` in `ListingCopyRequest` and the prompt                                                              |
| `src/app/listing-readiness.ts` (new)                  | Pure "can the button run, what is skipped, why not"                                                         |
| `src/app/stores/listing-store.ts`                     | `setBrand`, `setUseMannequin`, brand-aware `generateCopy`, `createListing`, `cancelListing`, part readiness |
| `src/features/mannequin/MannequinDialog.tsx` (new)    | Editor dialog + `MannequinSummary`                                                                          |
| `src/features/settings/MannequinSection.tsx` (new)    | Settings → Mannequin                                                                                        |
| `src/features/workspace/useComposerDefaults.ts` (new) | Provider/model defaults (effects) + derived model data                                                      |
| `src/features/workspace/AdvancedOptions.tsx` (new)    | Provider, model, format, size, provider options, shot prompts, custom recipe, usage                         |
| `src/features/workspace/ListingSetupCard.tsx` (new)   | Brand, taxonomy, mannequin toggle, advanced, single button, hints                                           |
| `src/features/generation/ListingComposer.tsx`         | **Deleted** (split into the three files above)                                                              |

---

### Task 1: Mannequin model and prompt helpers

**Files:**

- Create: `src/domain/models/mannequin.ts`, `src/domain/services/mannequin.ts`, `src/domain/services/mannequin.test.ts`
- Modify: `src/domain/models/index.ts` (add `export * from "./mannequin";` next to the other `export *` lines), `src/domain/models/settings.ts`, `src/domain/models/project.ts`

**Interfaces:**

- Produces: types `Mannequin`, `MannequinBuild`, `MannequinPose`, `SkinTone`; constants `MANNEQUIN_BUILDS`, `MANNEQUIN_POSES`, `SKIN_TONES`, `SKIN_TONE_SWATCH`, `DEFAULT_MANNEQUIN` (from `@/domain/models`); functions `mannequinApplies(categoryId: ListingCategoryId): boolean`, `describeWearer(baseWearer: string, m: Mannequin): string`, `posePhrase(pose: MannequinPose): string`, `normalizeMannequin(value: unknown): Mannequin | undefined` (from `@/domain/services/mannequin`); fields `AppSettings.mannequin?: Mannequin | undefined`, `Project.brand?: string`, `Project.useMannequin?: boolean`.

- [ ] **Step 1: Write the failing test** — `src/domain/services/mannequin.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_MANNEQUIN, MANNEQUIN_BUILDS, MANNEQUIN_POSES, SKIN_TONES } from "@/domain/models";
import { describeWearer, mannequinApplies, normalizeMannequin, posePhrase } from "./mannequin";

describe("mannequin", () => {
  it("applies to every category whose wearer is an adult, never kids or pets", () => {
    for (const id of ["women", "men", "home", "electronics", "entertainment", "hobbies", "sport", "luxury"] as const)
      expect(mannequinApplies(id), id).toBe(true);
    expect(mannequinApplies("kids")).toBe(false);
    expect(mannequinApplies("pets")).toBe(false);
  });

  it("describes the wearer with body type and skin tone", () => {
    expect(describeWearer("a woman", { build: "S", pose: "standing", skinTone: "fair" })).toBe("a woman with a slim build and fair skin");
    expect(describeWearer("a man", { build: "L", pose: "sitting", skinTone: "deep" })).toBe("a man with a fuller, plus-size build and deep dark skin");
    const all = new Set<string>();
    for (const build of MANNEQUIN_BUILDS) for (const skinTone of SKIN_TONES) all.add(describeWearer("a person", { build, pose: "standing", skinTone }));
    expect(all.size).toBe(MANNEQUIN_BUILDS.length * SKIN_TONES.length);
  });

  it("has one distinct pose phrase per posture", () => {
    expect(new Set(MANNEQUIN_POSES.map(posePhrase)).size).toBe(MANNEQUIN_POSES.length);
    expect(posePhrase("arched")).toMatch(/arched back/);
    expect(posePhrase("crouching")).toBe("crouching down");
  });

  it("normalizes stored values field by field", () => {
    expect(normalizeMannequin(undefined)).toBeUndefined();
    expect(normalizeMannequin("M")).toBeUndefined();
    expect(normalizeMannequin({ build: "XL", pose: "sitting", skinTone: "blue" })).toEqual({
      build: DEFAULT_MANNEQUIN.build,
      pose: "sitting",
      skinTone: DEFAULT_MANNEQUIN.skinTone,
    });
    expect(normalizeMannequin({ build: "S", pose: "arched", skinTone: "olive" })).toEqual({ build: "S", pose: "arched", skinTone: "olive" });
  });
});
```

- [ ] **Step 2: Run it** — `pnpm exec vitest run src/domain/services/mannequin.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `src/domain/models/mannequin.ts`

```ts
/**
 * The seller's reusable model for photos with a person (worn, on the wrist, mirror selfie…). One per
 * device, stored in the settings; gender still comes from the listing category.
 */
export type MannequinBuild = "S" | "M" | "L";
export type MannequinPose = "standing" | "arched" | "crouching" | "sitting";
export type SkinTone = "very-fair" | "fair" | "medium" | "olive" | "brown" | "deep";

export interface Mannequin {
  build: MannequinBuild;
  pose: MannequinPose;
  skinTone: SkinTone;
}

export const MANNEQUIN_BUILDS: readonly MannequinBuild[] = ["S", "M", "L"];
export const MANNEQUIN_POSES: readonly MannequinPose[] = ["standing", "arched", "crouching", "sitting"];
export const SKIN_TONES: readonly SkinTone[] = ["very-fair", "fair", "medium", "olive", "brown", "deep"];

/** Display colours of the skin-tone picker (UI only, never sent to a model). */
export const SKIN_TONE_SWATCH: Record<SkinTone, string> = {
  "very-fair": "#F3D9C4",
  fair: "#E8BF9F",
  medium: "#C99570",
  olive: "#A9764F",
  brown: "#7B4E32",
  deep: "#4A2C1D",
};

export const DEFAULT_MANNEQUIN: Mannequin = { build: "M", pose: "standing", skinTone: "medium" };
```

`src/domain/services/mannequin.ts`

```ts
import {
  DEFAULT_MANNEQUIN,
  MANNEQUIN_BUILDS,
  MANNEQUIN_POSES,
  SKIN_TONES,
  type ListingCategoryId,
  type Mannequin,
  type MannequinBuild,
  type MannequinPose,
  type SkinTone,
} from "@/domain/models";

// English: image models are prompted in English (see listing-catalog.ts).
const BUILD: Record<MannequinBuild, string> = { S: "a slim build", M: "an average build", L: "a fuller, plus-size build" };
const SKIN: Record<SkinTone, string> = {
  "very-fair": "very fair skin",
  fair: "fair skin",
  medium: "medium skin",
  olive: "olive skin",
  brown: "brown skin",
  deep: "deep dark skin",
};
const POSE: Record<MannequinPose, string> = {
  standing: "standing naturally",
  arched: "standing with a slightly arched back and one hip out, in a confident fashion pose",
  crouching: "crouching down",
  sitting: "sitting on a stool",
};
/** Categories whose wearer is not an adult the seller could stand in for ("a child", "a pet"). */
const EXCLUDED: ReadonlySet<ListingCategoryId> = new Set<ListingCategoryId>(["kids", "pets"]);

export function mannequinApplies(categoryId: ListingCategoryId): boolean {
  return !EXCLUDED.has(categoryId);
}

/** "a woman" + mannequin → "a woman with a slim build and fair skin". */
export function describeWearer(baseWearer: string, m: Mannequin): string {
  return `${baseWearer} with ${BUILD[m.build]} and ${SKIN[m.skinTone]}`;
}

export function posePhrase(pose: MannequinPose): string {
  return POSE[pose];
}

/** Settings are user data: keep known values, fall back to the default field by field. */
export function normalizeMannequin(value: unknown): Mannequin | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const pick = <T extends string>(list: readonly T[], x: unknown, fallback: T): T => (list.includes(x as T) ? (x as T) : fallback);
  return {
    build: pick(MANNEQUIN_BUILDS, v.build, DEFAULT_MANNEQUIN.build),
    pose: pick(MANNEQUIN_POSES, v.pose, DEFAULT_MANNEQUIN.pose),
    skinTone: pick(SKIN_TONES, v.skinTone, DEFAULT_MANNEQUIN.skinTone),
  };
}
```

`src/domain/models/settings.ts`: add `import type { Mannequin } from "./mannequin";` and, in `AppSettings` after `vintedAutomationAcknowledged`:

```ts
  /** The seller's mannequin for photos with a person; absent until created (listing card or Settings → Mannequin). */
  mannequin?: Mannequin | undefined;
```

(no entry in `DEFAULT_SETTINGS`).

`src/domain/models/project.ts`, in `Project` after `listing?`:

```ts
  /** Brand typed by the seller (raw, max 60 chars); trimmed when used. Absent = no brand stated. */
  brand?: string;
  /** "My mannequin" toggle for this project's photos with a person. */
  useMannequin?: boolean;
```

- [ ] **Step 4: Run** the test file → PASS; `pnpm typecheck` → clean.
- [ ] **Step 5: Commit** — `git add src/domain/models/mannequin.ts src/domain/models/index.ts src/domain/models/settings.ts src/domain/models/project.ts src/domain/services/mannequin.ts src/domain/services/mannequin.test.ts && git commit -m "feat(listing): mannequin model and prompt helpers" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"`

---

### Task 2: Mannequin and pose in the catalogue prompts

**Files:**

- Modify: `src/domain/services/listing-catalog.ts` (garment "worn" template ~line 64, footwear "worn" template ~line 76, `interpolateShot` ~line 492, `buildListingShots` ~line 497)
- Test: `src/domain/services/listing-catalog.test.ts`

**Interfaces:**

- Consumes: `describeWearer`, `posePhrase`, `mannequinApplies` (Task 1).
- Produces: `interpolateShot(template: string, vars: { subject: string; wearer: string; pose?: string }): string`; `buildListingShots(selection: ListingSelection, options?: { mannequin?: Mannequin }): ShotSpec[]`.

- [ ] **Step 1: Write the failing tests** — append inside `describe("listing catalogue", …)` of `listing-catalog.test.ts` (add `LISTING_CATEGORIES` is already imported):

```ts
it("keeps the default poses when no mannequin is given", () => {
  expect(buildListingShots({ categoryId: "women", subcategoryId: "clothing" }).find((s) => s.id === "worn")?.prompt).toContain(
    "worn by a woman, standing naturally,",
  );
  expect(buildListingShots({ categoryId: "men", subcategoryId: "shoes" }).find((s) => s.id === "worn")?.prompt).toContain("worn by a man, standing, cropped");
});

it("puts the seller's mannequin in every shot with a person, with a single pose", () => {
  const mannequin = { build: "S", pose: "crouching", skinTone: "brown" } as const;
  const shots = buildListingShots({ categoryId: "women", subcategoryId: "clothing" }, { mannequin });
  const byId = Object.fromEntries(shots.map((s) => [s.id, s.prompt]));
  expect(byId.worn).toContain("worn by a woman with a slim build and brown skin, crouching down,");
  expect(byId.worn).not.toContain("standing naturally");
  expect(byId.selfie).toContain("mirror selfie taken by a woman with a slim build and brown skin");
  expect(byId.selfie).toMatch(/The person is crouching down\.$/);
  const plain = buildListingShots({ categoryId: "women", subcategoryId: "clothing" });
  for (const id of ["retouch", "studio", "folded"]) expect(byId[id], id).toBe(plain.find((s) => s.id === id)?.prompt);
  for (const s of shots) expect(s.prompt.match(/standing naturally|crouching down|sitting on a stool|arched back/g)?.length ?? 0, s.id).toBeLessThanOrEqual(1);
});

it("interpolates every subcategory with a mannequin", () => {
  const mannequin = { build: "L", pose: "arched", skinTone: "very-fair" } as const;
  for (const c of LISTING_CATEGORIES)
    for (const s of c.subcategories)
      for (const shot of buildListingShots({ categoryId: c.id, subcategoryId: s.id }, { mannequin }))
        expect(shot.prompt, `${c.id}/${s.id}/${shot.id}`).not.toMatch(/\{\{/);
});

it("ignores the mannequin for kids and pets", () => {
  const mannequin = { build: "L", pose: "sitting", skinTone: "fair" } as const;
  for (const categoryId of ["kids", "pets"] as const) {
    const subcategoryId = LISTING_CATEGORIES.find((c) => c.id === categoryId)!.subcategories[0]!.id;
    expect(buildListingShots({ categoryId, subcategoryId }, { mannequin })).toEqual(buildListingShots({ categoryId, subcategoryId }));
  }
});
```

- [ ] **Step 2: Run** `pnpm exec vitest run src/domain/services/listing-catalog.test.ts` → the four new tests FAIL.

- [ ] **Step 3: Implement** in `listing-catalog.ts`:
  - imports: add `type Mannequin` to the `@/domain/models` import and `import { describeWearer, mannequinApplies, posePhrase } from "./mannequin";`
  - `ShotTemplate.template` doc comment: `/** May use {{subject}}, {{wearer}} and {{pose|default}}. */`
  - garment "worn" body: `"The garment worn by {{wearer}}, {{pose|standing naturally}}, neutral studio background, fashion catalog photo, garment fully visible and unchanged."`
  - footwear "worn" body: `"The shoes worn by {{wearer}}, {{pose|standing}}, cropped at the ankles or knees, on a neutral floor, natural light."`
  - replace `interpolateShot` and `buildListingShots`:

```ts
const POSE_SLOT = /\{\{\s*pose\s*(?:\|([^}]*))?\}\}/g;
const WEARER = /\{\{\s*wearer\s*\}\}/;

/**
 * `{{pose|default}}` renders `vars.pose` or its default. When a pose is given and the template has a
 * person but no pose slot, the pose is appended as its own sentence — a prompt never gets two poses.
 */
export function interpolateShot(template: string, vars: { subject: string; wearer: string; pose?: string }): string {
  const hasSlot = /\{\{\s*pose/.test(template);
  let out = template.replace(POSE_SLOT, (_match, fallback: string | undefined) => vars.pose ?? (fallback ?? "").trim());
  out = out.replace(/\{\{\s*subject\s*\}\}/g, vars.subject).replace(/\{\{\s*wearer\s*\}\}/g, vars.wearer);
  if (vars.pose && !hasSlot && WEARER.test(template)) out = `${out} The person is ${vars.pose}.`;
  return out;
}

/** The prompts of a listing pack, fully interpolated; `mannequin` replaces the generic person where it applies. */
export function buildListingShots(selection: ListingSelection, options: { mannequin?: Mannequin } = {}): ShotSpec[] {
  const found = findSubcategory(selection);
  if (!found) throw new Error(`Unknown listing selection ${selection.categoryId}/${selection.subcategoryId}`);
  const { category, subcategory } = found;
  const m = options.mannequin && mannequinApplies(category.id) ? options.mannequin : undefined;
  const wearer = m ? describeWearer(category.wearer, m) : category.wearer;
  const pose = m ? posePhrase(m.pose) : undefined;
  return PLANS[subcategory.kind]
    .filter((s) => !s.excludeCategories?.includes(category.id))
    .map((s) => ({
      id: s.id,
      label: s.label,
      prompt: interpolateShot(s.template, { subject: subcategory.subject, wearer, ...(pose && WEARER.test(s.template) ? { pose } : {}) }),
    }));
}
```

- [ ] **Step 4: Run** the catalogue tests → all PASS (the existing ones too: "worn by a woman" / "worn by a man" still match).
- [ ] **Step 5: Commit** — `git add src/domain/services/listing-catalog.ts src/domain/services/listing-catalog.test.ts && git commit -m "feat(listing): seller's mannequin and pose in the photos with a person" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"`

---

### Task 3: Seller's brand in the copy prompt

**Files:**

- Modify: `src/domain/services/listing-copy.ts` (`ListingCopyRequest`, `buildListingCopyPrompt`)
- Test: `src/domain/services/listing-copy.test.ts`

**Interfaces:**

- Produces: `ListingCopyRequest.brand?: string` (providers already pass the request to `buildListingCopyPrompt`; check `GeminiListingCopy.ts` and `CloudflareListingCopy.ts` call it with the whole request).

- [ ] **Step 1: Write the failing test** — in `describe("listing copy prompt & parsing", …)`:

```ts
it("imposes the seller's brand (JSON-quoted) or keeps the 'only if readable' rule", () => {
  const withBrand = buildListingCopyPrompt({ image, language: "fr", brand: '  Levi\'s "501" ' });
  expect(withBrand).toContain('The seller states the brand is "Levi\'s \\"501\\""');
  expect(withBrand).not.toContain("clearly readable");
  const without = buildListingCopyPrompt({ image, language: "fr", brand: "   " });
  expect(without).toContain("only if it is clearly readable");
  expect(without).not.toContain("seller states the brand");
});
```

- [ ] **Step 2: Run** `pnpm exec vitest run src/domain/services/listing-copy.test.ts` → FAIL.

- [ ] **Step 3: Implement** — in `ListingCopyRequest` add `/** Brand stated by the seller; when set, the model must use it verbatim. */ brand?: string;`. In `buildListingCopyPrompt`, compute before the `return`:

```ts
const brand = request.brand?.trim();
const brandRule = brand
  ? `The seller states the brand is ${JSON.stringify(brand)}: use exactly this brand in the title and the description and return it in "brand"; never contradict it.`
  : "Put the brand only if it is clearly readable in the photo, otherwise null.";
```

and replace the "Be factual…" array item by two items:

```ts
    "Be factual: describe only what is visible. Mention the type of item, color, material or fabric when recognizable, visible pattern, notable features, and the visible condition (wear, marks, pilling, scratches). Never invent a size, model or year.",
    brandRule,
```

- [ ] **Step 4: Run** → PASS (existing tests unchanged).
- [ ] **Step 5: Commit** — `git add src/domain/services/listing-copy.ts src/domain/services/listing-copy.test.ts && git commit -m "feat(copy): the seller's brand is imposed in the title and description" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"`

---

### Task 4: Orchestration — `createListing`, brand-aware copy, readiness

**Files:**

- Create: `src/app/listing-readiness.ts`, `src/app/listing-flow.test.ts`
- Modify: `src/app/stores/listing-store.ts`, `src/i18n/en.ts`, `src/i18n/fr.ts`

**Interfaces:**

- Consumes: Tasks 1–3; `useGenerationStore.start(params: StartGenerationParams)`, `useComposerStore` (`providerId`, `modelId`, `aspectRatio`, `imageSize`, `providerOptions`, `sourceImageId`), `useAuthStore.providerStatus`, `useSettingsStore.settings.{copyProviderId, mannequin, lastModelByProvider}`, `MOCK_PROVIDER_ID`.
- Produces:

```ts
// src/app/listing-readiness.ts
export interface ListingReadinessInput {
  hasImage: boolean;
  hasSelection: boolean;
  photosReady: boolean;
  textReady: boolean;
}
export type ListingBlocker = "composer.needImage" | "listing.needCategory" | "listing.needProviders";
export type ListingPart = "photos" | "text";
export interface ListingReadiness {
  canCreate: boolean;
  blocker: ListingBlocker | null;
  skipped: ListingPart[];
}
export function listingReadiness(input: ListingReadinessInput): ListingReadiness;
// src/app/stores/listing-store.ts
export const BRAND_MAX_LENGTH = 60;
export type ListingPartOutcome = "done" | "skipped-provider" | { error: GenerationError };
export interface ListingRunReport {
  photos: ListingPartOutcome;
  text: ListingPartOutcome;
}
export interface CreateListingOptions {
  promptOverrides?: Record<string, string>;
  customRecipe?: { id: string; prompt: string };
}
export function photoPartReady(): boolean;
export function textPartReady(): boolean;
// new store members: creating: boolean; lastRun: ListingRunReport | null;
// setBrand(raw: string): void; setUseMannequin(on: boolean): void;
// createListing(options?: CreateListingOptions): Promise<ListingRunReport | null>; cancelListing(): void;
```

- i18n (en / fr), add next to the other `listing.*` keys:

| key                     | en                                                        | fr                                                               |
| ----------------------- | --------------------------------------------------------- | ---------------------------------------------------------------- |
| `listing.needProviders` | Connect an image provider or a text provider in Settings. | Connectez un fournisseur d'images ou de texte dans les Réglages. |

- [ ] **Step 1: Write the failing tests** — `src/app/listing-flow.test.ts`

```ts
/**
 * "Create the listing": photos and text in parallel through the stores, with the Mock image provider,
 * a fake copy provider and in-memory IndexedDB. Image decoding is stubbed (jsdom has no canvas).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/image/image-processing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infrastructure/image/image-processing")>();
  const fakeBitmap = { width: 640, height: 480, close: () => undefined } as unknown as ImageBitmap;
  return {
    ...actual,
    decodeImage: async () => ({ bitmap: fakeBitmap, width: 640, height: 480 }),
    createThumbnail: async () => new Blob([Uint8Array.from([1, 2, 3])], { type: "image/webp" }),
    prepareForProvider: async (blob: Blob) => ({ blob, mimeType: "image/jpeg" as const, width: 640, height: 480 }),
  };
});

import { AppError, type GenerationJob } from "@/domain/models";
import type { ListingCopyProvider, ListingCopyRequest } from "@/domain/services/listing-copy";
import { IndexedDbStorage } from "@/infrastructure/storage/IndexedDbStorage";
import { listingReadiness } from "./listing-readiness";
import { __setServices, createServices, getServices } from "./services";
import { useAuthStore } from "./stores/auth-store";
import { useComposerStore } from "./stores/composer-store";
import { applyJobUpdate, buildRequestForJob, persistJobResult, useGenerationStore } from "./stores/generation-store";
import { useListingStore } from "./stores/listing-store";
import { useProjectsStore } from "./stores/projects-store";
import { useSettingsStore } from "./stores/settings-store";

const PNG = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])], { type: "image/png" });

function fakeCopy(fail?: AppError) {
  const requests: ListingCopyRequest[] = [];
  const provider: ListingCopyProvider = {
    id: "gemini",
    displayName: "Fake vision",
    models: [{ id: "fake-vision", label: "Fake" }],
    getAuthStatus: async () => ({ state: "authenticated", kind: "api_key" }),
    describeListing: async (request) => {
      requests.push(request);
      if (fail) throw fail;
      return {
        copy: { title: "Baskets running", description: "Très bon état.", brand: "Adidas", keywords: ["baskets"] },
        providerMeta: { model: "fake-vision" },
      };
    },
  };
  return { provider, requests };
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}

const jobsOf = () => Object.values(useProjectsStore.getState().current?.jobs ?? {}) as GenerationJob[];

describe("createListing", () => {
  const storage = new IndexedDbStorage("listing-flow-test");
  let copy: ReturnType<typeof fakeCopy>;

  beforeAll(async () => {
    __setServices(null);
    const services = createServices({ buildRequest: buildRequestForJob, persistResult: persistJobResult, onJobUpdate: applyJobUpdate, storage });
    services.mock.setOptions({ latencyMs: 5, scenario: "success" });
    await storage.init();
  });

  beforeEach(async () => {
    copy = fakeCopy();
    __setServices({ ...getServices(), copyProviders: new Map([["gemini", copy.provider]]) });
    useAuthStore.setState({ providerStatus: { gemini: { state: "authenticated", kind: "api_key" } } });
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, copyProviderId: "gemini", mannequin: undefined } });
    await useProjectsStore.getState().createFromFile(PNG, "baskets.png");
    useListingStore.getState().setListing({ categoryId: "men", subcategoryId: "shoes" });
    useComposerStore.getState().setProvider("mock");
    await useGenerationStore.getState().loadModels("mock", true);
    useComposerStore.getState().setModel("mock-fast");
  });

  afterEach(async () => {
    await waitFor(() => jobsOf().every((j) => j.status !== "queued" && j.status !== "generating"));
  });

  it("creates photos and text in parallel, forces the seller's brand and applies the mannequin", async () => {
    useListingStore.getState().setBrand("  Nike  ");
    useListingStore.getState().setUseMannequin(true);
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, mannequin: { build: "S", pose: "sitting", skinTone: "olive" } } });

    const report = await useListingStore.getState().createListing();

    expect(report).toEqual({ photos: "done", text: "done" });
    expect(copy.requests[0]?.brand).toBe("Nike");
    expect(useProjectsStore.getState().current?.project.copy?.brand).toBe("Nike");
    const worn = jobsOf().find((j) => j.shotId === "worn");
    expect(worn?.prompt).toContain("worn by a man with a slim build and olive skin, sitting on a stool,");
    expect(jobsOf().find((j) => j.shotId === "studio")?.prompt).not.toContain("olive skin");
  });

  it("does not apply the mannequin when the toggle is off", async () => {
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, mannequin: { build: "L", pose: "arched", skinTone: "deep" } } });
    await useListingStore.getState().createListing();
    expect(jobsOf().find((j) => j.shotId === "worn")?.prompt).toContain("worn by a man, standing, cropped");
  });

  it("writes the text only when no image provider is usable", async () => {
    useComposerStore.getState().setProvider("cloudflare");
    const report = await useListingStore.getState().createListing();
    expect(report).toEqual({ photos: "skipped-provider", text: "done" });
    expect(jobsOf()).toHaveLength(0);
  });

  it("makes the photos only when the copy provider is not connected", async () => {
    useAuthStore.setState({ providerStatus: {} });
    const report = await useListingStore.getState().createListing();
    expect(report).toEqual({ photos: "done", text: "skipped-provider" });
    expect(copy.requests).toHaveLength(0);
    expect(jobsOf().length).toBeGreaterThanOrEqual(4);
  });

  it("a text failure does not cancel the photos", async () => {
    copy = fakeCopy(new AppError("INVALID_CREDENTIAL", "bad key"));
    __setServices({ ...getServices(), copyProviders: new Map([["gemini", copy.provider]]) });
    const report = await useListingStore.getState().createListing();
    expect(report?.photos).toBe("done");
    expect(report?.text).toMatchObject({ error: { code: "INVALID_CREDENTIAL" } });
    expect(jobsOf().length).toBeGreaterThanOrEqual(4);
  });

  it("refuses without a complete selection and caps the brand", async () => {
    useListingStore.getState().setListing(undefined);
    expect(await useListingStore.getState().createListing()).toBeNull();
    useListingStore.getState().setBrand("x".repeat(80));
    expect(useProjectsStore.getState().current?.project.brand).toHaveLength(60);
    useListingStore.getState().setBrand("   ");
    expect(useProjectsStore.getState().current?.project.brand).toBeUndefined();
  });
});

describe("listingReadiness", () => {
  it("names the first blocker and the skipped parts", () => {
    expect(listingReadiness({ hasImage: false, hasSelection: true, photosReady: true, textReady: true })).toEqual({
      canCreate: false,
      blocker: "composer.needImage",
      skipped: [],
    });
    expect(listingReadiness({ hasImage: true, hasSelection: false, photosReady: true, textReady: true }).blocker).toBe("listing.needCategory");
    expect(listingReadiness({ hasImage: true, hasSelection: true, photosReady: false, textReady: false })).toEqual({
      canCreate: false,
      blocker: "listing.needProviders",
      skipped: ["photos", "text"],
    });
    expect(listingReadiness({ hasImage: true, hasSelection: true, photosReady: true, textReady: false })).toEqual({
      canCreate: true,
      blocker: null,
      skipped: ["text"],
    });
    expect(listingReadiness({ hasImage: true, hasSelection: true, photosReady: true, textReady: true })).toEqual({
      canCreate: true,
      blocker: null,
      skipped: [],
    });
  });
});
```

- [ ] **Step 2: Run** `pnpm exec vitest run src/app/listing-flow.test.ts` → FAIL (missing module / members).

- [ ] **Step 3: Implement** `src/app/listing-readiness.ts`

```ts
/** Whether "Create the listing" can run, what it will skip, and the first reason it cannot. Pure. */
export interface ListingReadinessInput {
  hasImage: boolean;
  hasSelection: boolean;
  photosReady: boolean;
  textReady: boolean;
}
export type ListingBlocker = "composer.needImage" | "listing.needCategory" | "listing.needProviders";
export type ListingPart = "photos" | "text";
export interface ListingReadiness {
  canCreate: boolean;
  blocker: ListingBlocker | null;
  skipped: ListingPart[];
}

export function listingReadiness(input: ListingReadinessInput): ListingReadiness {
  if (!input.hasImage) return { canCreate: false, blocker: "composer.needImage", skipped: [] };
  if (!input.hasSelection) return { canCreate: false, blocker: "listing.needCategory", skipped: [] };
  const skipped: ListingPart[] = [...(input.photosReady ? [] : (["photos"] as const)), ...(input.textReady ? [] : (["text"] as const))];
  if (skipped.length === 2) return { canCreate: false, blocker: "listing.needProviders", skipped };
  return { canCreate: true, blocker: null, skipped };
}
```

Then rewrite `src/app/stores/listing-store.ts` (keep `generateCopy`'s existing body, adding the brand; keep `updateCopy`/`cancelCopy`):

```ts
import { create } from "zustand";
import { AppError, toGenerationError, type GenerationError, type ListingCopy, type ListingSelection, type ProjectDocument } from "@/domain/models";
import { buildListingShots, listingRecipeId } from "@/domain/services/listing-catalog";
import { normalizeMannequin } from "@/domain/services/mannequin";
import { prepareForProvider } from "@/infrastructure/image/image-processing";
import { MOCK_PROVIDER_ID } from "@/infrastructure/providers/mock/MockImageProvider";
import { nowIso } from "@/lib/ids";
import { createLogger } from "@/lib/logger";
import { listingReadiness } from "../listing-readiness";
import { getServices } from "../services";
import { useAuthStore } from "./auth-store";
import { useComposerStore } from "./composer-store";
import { useGenerationStore } from "./generation-store";
import { useProjectsStore } from "./projects-store";
import { useSettingsStore } from "./settings-store";

const log = createLogger("listing");

/** Vision models cap input resolution anyway; 1024 px keeps the request small and fast. */
const COPY_IMAGE_MAX_DIMENSION = 1024;
export const BRAND_MAX_LENGTH = 60;

export type ListingPartOutcome = "done" | "skipped-provider" | { error: GenerationError };
export interface ListingRunReport {
  photos: ListingPartOutcome;
  text: ListingPartOutcome;
}
export interface CreateListingOptions {
  /** Per-shot prompt overrides from "Edit prompts" (shot id → prompt). */
  promptOverrides?: Record<string, string>;
  /** A custom recipe (one prompt × 4) instead of the listing pack. */
  customRecipe?: { id: string; prompt: string };
}

interface ListingState {
  copyBusy: boolean;
  copyError: GenerationError | null;
  /** A "Create the listing" run is being planned/started. */
  creating: boolean;
  /** Outcome of the last run, per part (UI summary). */
  lastRun: ListingRunReport | null;
  setListing(selection: ListingSelection | undefined): void;
  /** Stores the brand as typed (max 60 chars); blank removes it. */
  setBrand(raw: string): void;
  setUseMannequin(on: boolean): void;
  /** Generates title/description from the original photo with the copy provider/model chosen in settings. */
  generateCopy(): Promise<ListingCopy | null>;
  /** The main button: photos and text in parallel, each part skipped when its provider is not usable. */
  createListing(options?: CreateListingOptions): Promise<ListingRunReport | null>;
  cancelListing(): void;
  updateCopy(patch: Partial<Pick<ListingCopy, "title" | "description" | "keywords" | "brand" | "color" | "condition">>): void;
  cancelCopy(): void;
}

let copyController: AbortController | null = null;

/** The composer's image provider can run: authenticated (or Mock) with an available model selected. */
export function photoPartReady(): boolean {
  const { providerId, modelId } = useComposerStore.getState();
  const authOk = providerId === MOCK_PROVIDER_ID || useAuthStore.getState().providerStatus[providerId]?.state === "authenticated";
  const model = useGenerationStore.getState().modelsByProvider[providerId]?.find((m) => m.id === modelId);
  return authOk && !!model?.available;
}

/** The copy provider chosen in settings exists and is authenticated. */
export function textPartReady(): boolean {
  const { copyProviderId } = useSettingsStore.getState().settings;
  return getServices().copyProviders.has(copyProviderId) && useAuthStore.getState().providerStatus[copyProviderId]?.state === "authenticated";
}

async function startPhotos(
  doc: ProjectDocument,
  selection: ListingSelection,
  sourceImageId: string,
  options: CreateListingOptions,
): Promise<ListingPartOutcome> {
  const composer = useComposerStore.getState();
  const settings = useSettingsStore.getState().settings;
  const modelId = composer.modelId;
  if (!modelId) return "skipped-provider";
  const mannequin = doc.project.useMannequin ? normalizeMannequin(settings.mannequin) : undefined;
  const providerOptions = composer.providerOptions[composer.providerId] ?? {};
  const common = {
    sourceImageId,
    providerId: composer.providerId,
    modelId,
    aspectRatio: composer.aspectRatio,
    ...(composer.imageSize ? { imageSize: composer.imageSize } : {}),
    ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
  };
  try {
    if (options.customRecipe) {
      await useGenerationStore.getState().start({ ...common, prompt: options.customRecipe.prompt, variationCount: 4, recipeId: options.customRecipe.id });
    } else {
      const shots = buildListingShots(selection, mannequin ? { mannequin } : {}).map((s) => ({
        ...s,
        prompt: options.promptOverrides?.[s.id]?.trim() || s.prompt,
      }));
      await useGenerationStore
        .getState()
        .start({ ...common, prompt: "", variationCount: shots.length, recipeId: listingRecipeId(selection), listing: selection, shots });
    }
    if (settings.lastModelByProvider[composer.providerId] !== modelId) {
      void useSettingsStore.getState().update({ lastModelByProvider: { ...settings.lastModelByProvider, [composer.providerId]: modelId } });
    }
    return "done";
  } catch (err) {
    const error = toGenerationError(err);
    log.warn("listing photos failed to start", error.code);
    return { error };
  }
}

export const useListingStore = create<ListingState>((set, get) => ({
  copyBusy: false,
  copyError: null,
  creating: false,
  lastRun: null,

  setListing(selection) {
    useProjectsStore.getState().commit((doc) => {
      if (selection) doc.project.listing = selection;
      else delete doc.project.listing;
    });
  },

  setBrand(raw) {
    const value = raw.slice(0, BRAND_MAX_LENGTH);
    useProjectsStore.getState().commit((doc) => {
      if (value.trim()) doc.project.brand = value;
      else delete doc.project.brand;
    });
  },

  setUseMannequin(on) {
    useProjectsStore.getState().commit((doc) => {
      if (on) doc.project.useMannequin = true;
      else delete doc.project.useMannequin;
    });
  },

  async generateCopy() {
    // …existing body, with two changes:
    // 1. the describeListing request gets `...(brand ? { brand } : {})` where `const brand = doc.project.brand?.trim();`
    // 2. the stored copy forces it: `const copy: ListingCopy = { ...result.copy, ...(brand ? { brand } : {}), language, generatedAt: nowIso(), provider: providerId, model: String(result.providerMeta?.model ?? "") };`
  },

  async createListing(options = {}) {
    const doc = useProjectsStore.getState().current;
    const selection = doc?.project.listing;
    const sourceImageId = useComposerStore.getState().sourceImageId ?? doc?.project.originalImageId;
    const readiness = listingReadiness({
      hasImage: !!doc?.project.originalImageId && !!sourceImageId,
      hasSelection: !!selection,
      photosReady: photoPartReady(),
      textReady: textPartReady(),
    });
    if (!doc || !selection || !sourceImageId || !readiness.canCreate || get().creating) return null;
    set({ creating: true, lastRun: null });
    const photos = readiness.skipped.includes("photos")
      ? Promise.resolve<ListingPartOutcome>("skipped-provider")
      : startPhotos(doc, selection, sourceImageId, options);
    const text = readiness.skipped.includes("text")
      ? Promise.resolve<ListingPartOutcome>("skipped-provider")
      : get()
          .generateCopy()
          .then<ListingPartOutcome>((result) =>
            result ? "done" : { error: get().copyError ?? { code: "CANCELLED", message: "Cancelled.", retryable: false } },
          );
    const [p, t] = await Promise.allSettled([photos, text]);
    const settled = (r: PromiseSettledResult<ListingPartOutcome>): ListingPartOutcome =>
      r.status === "fulfilled" ? r.value : { error: toGenerationError(r.reason) };
    const report: ListingRunReport = { photos: settled(p), text: settled(t) };
    set({ creating: false, lastRun: report });
    return report;
  },

  cancelListing() {
    useGenerationStore.getState().cancelAll();
    get().cancelCopy();
  },

  // updateCopy, cancelCopy: unchanged.
}));
```

(Replace the `generateCopy` comment block with the full existing body plus the two changes; `AppError` stays imported for it.)

Add the i18n key from the table (en after `"listing.needCategory"`, fr after its `"listing.needCategory"`).

- [ ] **Step 4: Run** the test file → PASS; then `pnpm check` → green (the old `ListingComposer` still compiles: it only uses `setListing`).
- [ ] **Step 5: Commit** — `git add src/app/listing-readiness.ts src/app/listing-flow.test.ts src/app/stores/listing-store.ts src/i18n/en.ts src/i18n/fr.ts && git commit -m "feat(listing): createListing runs photos and text in parallel, with brand and mannequin" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"`

---

### Task 5: Mannequin editor and Settings section

**Files:**

- Create: `src/features/mannequin/MannequinDialog.tsx`, `src/features/mannequin/MannequinDialog.test.tsx`, `src/features/settings/MannequinSection.tsx`
- Modify: `src/features/settings/SettingsView.tsx` (`SECTIONS` + render after `<PublishSection />`), `src/i18n/en.ts`, `src/i18n/fr.ts`

**Interfaces:**

- Consumes: Task 1 (`Mannequin`, lists, swatches, `normalizeMannequin`), `useSettingsStore.update`, `Dialog`, `Segmented`, `Section`.
- Produces: `MannequinDialog({ open, onClose, onSaved? }: { open: boolean; onClose(): void; onSaved?(m: Mannequin): void })`, `MannequinSummary({ mannequin })`, `MannequinSection()`.

i18n keys (en / fr):

| key                          | en                                                                                                                                             | fr                                                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settings.section.mannequin` | Mannequin                                                                                                                                      | Mannequin                                                                                                                                          |
| `mannequin.title`            | My mannequin                                                                                                                                   | Mon mannequin                                                                                                                                      |
| `mannequin.body`             | The person shown in the photos where the item is worn (worn, on the wrist, mirror selfie…). Saved on this device and reused for every listing. | La personne des photos où l'article est porté (portées, au poignet, selfie miroir…). Enregistré sur cet appareil et réutilisé pour chaque annonce. |
| `mannequin.toggle`           | My mannequin                                                                                                                                   | Mon mannequin                                                                                                                                      |
| `mannequin.toggleHint`       | Uses your mannequin in the photos with a person.                                                                                               | Utilise votre mannequin dans les photos avec une personne.                                                                                         |
| `mannequin.notForCategory`   | Not used for kids' and pets' items.                                                                                                            | Non utilisé pour les articles enfants et animaux.                                                                                                  |
| `mannequin.none`             | No mannequin yet.                                                                                                                              | Aucun mannequin pour l'instant.                                                                                                                    |
| `mannequin.create`           | Create my mannequin                                                                                                                            | Créer mon mannequin                                                                                                                                |
| `mannequin.edit`             | Edit                                                                                                                                           | Modifier                                                                                                                                           |
| `mannequin.delete`           | Delete                                                                                                                                         | Supprimer                                                                                                                                          |
| `mannequin.build`            | Body type                                                                                                                                      | Morphologie                                                                                                                                        |
| `mannequin.build.S`          | Slim (S)                                                                                                                                       | Mince (S)                                                                                                                                          |
| `mannequin.build.M`          | Average (M)                                                                                                                                    | Moyenne (M)                                                                                                                                        |
| `mannequin.build.L`          | Fuller (L)                                                                                                                                     | Forte (L)                                                                                                                                          |
| `mannequin.pose`             | Pose                                                                                                                                           | Posture                                                                                                                                            |
| `mannequin.pose.standing`    | Standing                                                                                                                                       | Debout                                                                                                                                             |
| `mannequin.pose.arched`      | Arched                                                                                                                                         | Cambré                                                                                                                                             |
| `mannequin.pose.crouching`   | Crouching                                                                                                                                      | Accroupi                                                                                                                                           |
| `mannequin.pose.sitting`     | Sitting                                                                                                                                        | Assis                                                                                                                                              |
| `mannequin.skin`             | Skin tone                                                                                                                                      | Carnation                                                                                                                                          |
| `mannequin.skin.very-fair`   | Very fair                                                                                                                                      | Très claire                                                                                                                                        |
| `mannequin.skin.fair`        | Fair                                                                                                                                           | Claire                                                                                                                                             |
| `mannequin.skin.medium`      | Medium                                                                                                                                         | Médiane                                                                                                                                            |
| `mannequin.skin.olive`       | Olive                                                                                                                                          | Mate                                                                                                                                               |
| `mannequin.skin.brown`       | Brown                                                                                                                                          | Brune                                                                                                                                              |
| `mannequin.skin.deep`        | Deep                                                                                                                                           | Foncée                                                                                                                                             |

- [ ] **Step 1: Write the failing test** — `src/features/mannequin/MannequinDialog.test.tsx`

```tsx
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { __setServices, createServices } from "@/app/services";
import { applyJobUpdate, buildRequestForJob, persistJobResult } from "@/app/stores/generation-store";
import { useSettingsStore } from "@/app/stores/settings-store";
import { IndexedDbStorage } from "@/infrastructure/storage/IndexedDbStorage";
import { MannequinDialog } from "./MannequinDialog";

describe("MannequinDialog", () => {
  const storage = new IndexedDbStorage("mannequin-dialog-test");
  beforeAll(async () => {
    __setServices(null);
    createServices({ buildRequest: buildRequestForJob, persistResult: persistJobResult, onJobUpdate: applyJobUpdate, storage });
    await storage.init();
  });
  beforeEach(() => useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, mannequin: undefined } }));
  afterEach(cleanup);

  it("starts from the default mannequin and saves the choices to the settings", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<MannequinDialog open onClose={onClose} onSaved={onSaved} />);
    expect(screen.getByRole("radio", { name: "M" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Standing" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Medium" })).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("radio", { name: "L" }));
    await user.click(screen.getByRole("radio", { name: "Sitting" }));
    await user.click(screen.getByRole("radio", { name: "Olive" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useSettingsStore.getState().settings.mannequin).toEqual({ build: "L", pose: "sitting", skinTone: "olive" });
    expect(onSaved).toHaveBeenCalledWith({ build: "L", pose: "sitting", skinTone: "olive" });
    expect(onClose).toHaveBeenCalled();
  });

  it("edits the stored mannequin and cancels without saving", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, mannequin: { build: "S", pose: "arched", skinTone: "deep" } } });
    render(<MannequinDialog open onClose={() => undefined} />);
    expect(screen.getByRole("radio", { name: "Arched" })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("radio", { name: "Crouching" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useSettingsStore.getState().settings.mannequin).toEqual({ build: "S", pose: "arched", skinTone: "deep" });
  });
});
```

- [ ] **Step 2: Run** → FAIL (module missing).

- [ ] **Step 3: Implement** `src/features/mannequin/MannequinDialog.tsx`

```tsx
import { useState } from "react";
import { useSettingsStore } from "@/app/stores/settings-store";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Label } from "@/components/ui/Input";
import { Segmented } from "@/components/ui/Misc";
import { DEFAULT_MANNEQUIN, MANNEQUIN_BUILDS, MANNEQUIN_POSES, SKIN_TONE_SWATCH, SKIN_TONES, type Mannequin } from "@/domain/models";
import { normalizeMannequin } from "@/domain/services/mannequin";
import { useT, type MessageKey } from "@/i18n";
import { cn } from "@/lib/cn";

/** Edits the seller's single mannequin (settings.mannequin). */
export function MannequinDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: (m: Mannequin) => void }) {
  const t = useT();
  const stored = useSettingsStore((s) => s.settings.mannequin);
  const update = useSettingsStore((s) => s.update);
  const initial = () => normalizeMannequin(stored) ?? DEFAULT_MANNEQUIN;
  const [draft, setDraft] = useState<Mannequin>(initial);
  // Re-sync each time the dialog opens (adjust state during render; no setState in effects).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDraft(initial());
  }

  const save = () => {
    void update({ mannequin: draft });
    onSaved?.(draft);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("mannequin.title")}
      description={t("mannequin.body")}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={save}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>{t("mannequin.build")}</Label>
          <Segmented
            ariaLabel={t("mannequin.build")}
            value={draft.build}
            onChange={(build) => setDraft({ ...draft, build })}
            options={MANNEQUIN_BUILDS.map((b) => ({ value: b, label: b, title: t(`mannequin.build.${b}` as MessageKey) }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t("mannequin.pose")}</Label>
          <Segmented
            ariaLabel={t("mannequin.pose")}
            value={draft.pose}
            onChange={(pose) => setDraft({ ...draft, pose })}
            options={MANNEQUIN_POSES.map((p) => ({ value: p, label: t(`mannequin.pose.${p}` as MessageKey) }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t("mannequin.skin")}</Label>
          <div role="radiogroup" aria-label={t("mannequin.skin")} className="flex flex-wrap gap-2">
            {SKIN_TONES.map((tone) => (
              <button
                key={tone}
                type="button"
                role="radio"
                aria-checked={draft.skinTone === tone}
                aria-label={t(`mannequin.skin.${tone}` as MessageKey)}
                title={t(`mannequin.skin.${tone}` as MessageKey)}
                onClick={() => setDraft({ ...draft, skinTone: tone })}
                className={cn(
                  "size-9 rounded-full border-2 transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  draft.skinTone === tone ? "border-accent ring-2 ring-accent/40" : "border-border",
                )}
                style={{ backgroundColor: SKIN_TONE_SWATCH[tone] }}
              />
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/** "M · Standing · ●" — compact summary for the listing card and the settings. */
export function MannequinSummary({ mannequin }: { mannequin: Mannequin }) {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
      <span>{mannequin.build}</span>
      <span aria-hidden>·</span>
      <span>{t(`mannequin.pose.${mannequin.pose}` as MessageKey)}</span>
      <span aria-hidden>·</span>
      <span
        role="img"
        aria-label={t(`mannequin.skin.${mannequin.skinTone}` as MessageKey)}
        className="inline-block size-3 rounded-full border border-border"
        style={{ backgroundColor: SKIN_TONE_SWATCH[mannequin.skinTone] }}
      />
    </span>
  );
}
```

`src/features/settings/MannequinSection.tsx`

```tsx
import { useState } from "react";
import { UserRound } from "lucide-react";
import { useSettingsStore } from "@/app/stores/settings-store";
import { Button } from "@/components/ui/Button";
import { normalizeMannequin } from "@/domain/services/mannequin";
import { useT } from "@/i18n";
import { MannequinDialog, MannequinSummary } from "../mannequin/MannequinDialog";
import { Section } from "./SettingsView";

/** Settings → Mannequin: summary, edit, delete. */
export function MannequinSection() {
  const t = useT();
  const stored = useSettingsStore((s) => s.settings.mannequin);
  const update = useSettingsStore((s) => s.update);
  const [open, setOpen] = useState(false);
  const mannequin = normalizeMannequin(stored);
  return (
    <Section id="mannequin" title={t("settings.section.mannequin")}>
      <div className="space-y-3 rounded-xl border border-border bg-bg-elevated p-4 text-sm">
        <p className="text-fg-muted">{t("mannequin.body")}</p>
        {mannequin ? <MannequinSummary mannequin={mannequin} /> : <p className="text-xs text-fg-subtle">{t("mannequin.none")}</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" leftIcon={<UserRound className="size-3.5" />} onClick={() => setOpen(true)}>
            {t(mannequin ? "mannequin.edit" : "mannequin.create")}
          </Button>
          {mannequin && (
            <Button size="sm" variant="ghost" onClick={() => void update({ mannequin: undefined })}>
              {t("mannequin.delete")}
            </Button>
          )}
        </div>
      </div>
      <MannequinDialog open={open} onClose={() => setOpen(false)} />
    </Section>
  );
}
```

`SettingsView.tsx`: import `MannequinSection`, add `{ id: "mannequin", key: "settings.section.mannequin" }` after the `publish` entry of `SECTIONS`, render `<MannequinSection />` after `<PublishSection />`. Add all keys of the table to `en.ts` and `fr.ts` (a `// Mannequin` block after the `listing.*` block).

- [ ] **Step 4: Run** the dialog test → PASS; `pnpm check` → green.
- [ ] **Step 5: Commit** — `git add src/features/mannequin src/features/settings/MannequinSection.tsx src/features/settings/SettingsView.tsx src/i18n/en.ts src/i18n/fr.ts && git commit -m "feat(listing): mannequin editor dialog and Settings → Mannequin" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"`

---

### Task 6: Listing card with the single button (replaces `ListingComposer`)

**Files:**

- Create: `src/features/workspace/useComposerDefaults.ts`, `src/features/workspace/AdvancedOptions.tsx`, `src/features/workspace/ListingSetupCard.tsx`, `src/features/workspace/ListingSetupCard.test.tsx`
- Modify: `src/features/workspace/WorkspaceView.tsx` (left column), `src/features/workspace/ListingCopyPanel.tsx` (button), `src/i18n/en.ts`, `src/i18n/fr.ts`
- Delete: `src/features/generation/ListingComposer.tsx`

**Interfaces:**

- Consumes: Task 4 (`createListing`, `cancelListing`, `setBrand`, `setUseMannequin`, `creating`, `lastRun`, `photoPartReady`, `textPartReady`, `BRAND_MAX_LENGTH`, `listingReadiness`), Task 5 (`MannequinDialog`, `MannequinSummary`), Task 2 (`buildListingShots(selection, { mannequin })`), Task 1 (`mannequinApplies`, `normalizeMannequin`).
- Produces: `useComposerModels()` → `{ composer, providers, models, model, aspectOptions, sizeOptions }`; `useComposerDefaults(): void`; `AdvancedOptions(props: { shots: ShotSpec[]; promptOverrides: Record<string, string>; onPromptOverridesChange(v: Record<string, string>): void; customRecipeId: string; onCustomRecipeChange(id: string): void })`; `ListingSetupCard()`.

i18n keys (en / fr):

| key                        | en                                                                               | fr                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `listing.title`            | Listing                                                                          | Annonce                                                                                    |
| `listing.brand`            | Brand                                                                            | Marque                                                                                     |
| `listing.brandHint`        | optional                                                                         | facultatif                                                                                 |
| `listing.brandPlaceholder` | e.g. Nike — leave empty if there is none                                         | ex. Nike — laissez vide s'il n'y en a pas                                                  |
| `listing.advanced`         | Advanced options                                                                 | Options avancées                                                                           |
| `listing.create`           | Create the listing · {count} photos + text                                       | Créer l'annonce · {count} photos + texte                                                   |
| `listing.recreate`         | Re-create the listing                                                            | Recréer l'annonce                                                                          |
| `listing.recreate.title`   | Re-create the listing?                                                           | Recréer l'annonce ?                                                                        |
| `listing.recreate.body`    | New photos are added to the history; the title and the description are replaced. | De nouvelles photos s'ajoutent à l'historique ; le titre et la description sont remplacés. |
| `listing.creating`         | Creating the listing…                                                            | Création de l'annonce…                                                                     |
| `listing.skipPhotos`       | Photos skipped: connect an image provider in Settings.                           | Photos ignorées : connectez un fournisseur d'images dans les Réglages.                     |
| `listing.skipText`         | Text skipped: connect {provider} in Settings.                                    | Texte ignoré : connectez {provider} dans les Réglages.                                     |
| `copy.regenerateText`      | Regenerate text                                                                  | Régénérer le texte                                                                         |

- [ ] **Step 1: Write the failing test** — `src/features/workspace/ListingSetupCard.test.tsx`

```tsx
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/infrastructure/image/image-processing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infrastructure/image/image-processing")>();
  const fakeBitmap = { width: 640, height: 480, close: () => undefined } as unknown as ImageBitmap;
  return {
    ...actual,
    decodeImage: async () => ({ bitmap: fakeBitmap, width: 640, height: 480 }),
    createThumbnail: async () => new Blob([Uint8Array.from([1, 2, 3])], { type: "image/webp" }),
  };
});

import { __setServices, createServices } from "@/app/services";
import { useAuthStore } from "@/app/stores/auth-store";
import { useComposerStore } from "@/app/stores/composer-store";
import { applyJobUpdate, buildRequestForJob, persistJobResult, useGenerationStore } from "@/app/stores/generation-store";
import { useListingStore } from "@/app/stores/listing-store";
import { useProjectsStore } from "@/app/stores/projects-store";
import { useSettingsStore } from "@/app/stores/settings-store";
import { IndexedDbStorage } from "@/infrastructure/storage/IndexedDbStorage";
import { ListingSetupCard } from "./ListingSetupCard";

const PNG = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])], { type: "image/png" });

describe("ListingSetupCard", () => {
  const storage = new IndexedDbStorage("listing-card-test");
  beforeAll(async () => {
    __setServices(null);
    createServices({ buildRequest: buildRequestForJob, persistResult: persistJobResult, onJobUpdate: applyJobUpdate, storage });
    await storage.init();
  });
  beforeEach(async () => {
    useAuthStore.setState({ providerStatus: {} });
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, mannequin: undefined, activeProviderId: "mock" } });
    await useProjectsStore.getState().createFromFile(PNG, "item.png");
    useComposerStore.getState().setProvider("mock");
    await useGenerationStore.getState().loadModels("mock", true);
    useComposerStore.getState().setModel("mock-fast");
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("is disabled until the category is chosen, then runs createListing once", async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(useListingStore.getState(), "createListing").mockResolvedValue(null);
    render(<ListingSetupCard />);
    expect(screen.getByRole("button", { name: /Create the listing/ })).toBeDisabled();
    expect(screen.getByText("Choose a category and a subcategory to generate")).toBeInTheDocument();
    act(() => useListingStore.getState().setListing({ categoryId: "men", subcategoryId: "shoes" }));
    const button = await screen.findByRole("button", { name: "Create the listing · 5 photos + text" });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("stores the brand as typed", async () => {
    const user = userEvent.setup();
    render(<ListingSetupCard />);
    await user.type(screen.getByLabelText(/Brand/), "Nike Air");
    expect(useProjectsStore.getState().current?.project.brand).toBe("Nike Air");
  });

  it("opens the editor when the mannequin toggle is turned on without a mannequin, then enables it", async () => {
    const user = userEvent.setup();
    act(() => useListingStore.getState().setListing({ categoryId: "women", subcategoryId: "clothing" }));
    render(<ListingSetupCard />);
    await user.click(screen.getByRole("switch", { name: "My mannequin" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("My mannequin");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(useProjectsStore.getState().current?.project.useMannequin).toBe(true);
    expect(useSettingsStore.getState().settings.mannequin).toBeDefined();
  });

  it("disables the mannequin for kids' items", () => {
    act(() => useListingStore.getState().setListing({ categoryId: "kids", subcategoryId: "clothing" }));
    render(<ListingSetupCard />);
    expect(screen.getByRole("switch", { name: "My mannequin" })).toBeDisabled();
    expect(screen.getByText("Not used for kids' and pets' items.")).toBeInTheDocument();
  });

  it("asks before re-creating a listing that already has text", async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(useListingStore.getState(), "createListing").mockResolvedValue(null);
    act(() => {
      useListingStore.getState().setListing({ categoryId: "men", subcategoryId: "shoes" });
      useProjectsStore.getState().commit((d) => {
        d.project.copy = { title: "T", description: "D", keywords: [], language: "en", generatedAt: "", provider: "gemini", model: "m" };
      });
    });
    render(<ListingSetupCard />);
    await user.click(screen.getByRole("button", { name: "Re-create the listing" }));
    expect(create).not.toHaveBeenCalled();
    await user.click(screen.getAllByRole("button", { name: "Re-create the listing" }).at(-1)!);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
```

(The "My mannequin" switch: check how `Switch` renders — if it is not `role="switch"` with the label as accessible name, adapt the query to what `src/components/ui/Input.tsx` renders, e.g. `getByLabelText("My mannequin")`.)

- [ ] **Step 2: Run** → FAIL (module missing).

- [ ] **Step 3: Implement.**

`src/features/workspace/useComposerDefaults.ts` — the provider/model/aspect effects move here verbatim from `ListingComposer.tsx` (lines 63–91 of the old file):

```ts
import { useEffect, useMemo } from "react";
import { getServices } from "@/app/services";
import { useAuthStore } from "@/app/stores/auth-store";
import { useComposerStore } from "@/app/stores/composer-store";
import { useGenerationStore } from "@/app/stores/generation-store";
import { useSettingsStore } from "@/app/stores/settings-store";
import { ALL_ASPECT_RATIOS, type AspectRatio } from "@/domain/models";

/** Derived model data of the composer's provider (no side effects). */
export function useComposerModels() {
  const composer = useComposerStore();
  const modelsByProvider = useGenerationStore((s) => s.modelsByProvider);
  const providers = [...getServices().providers.values()];
  const models = useMemo(() => modelsByProvider[composer.providerId] ?? [], [modelsByProvider, composer.providerId]);
  const model = models.find((m) => m.id === composer.modelId);
  const aspectOptions = useMemo<AspectRatio[]>(
    () => ALL_ASPECT_RATIOS.filter((r) => r === "original" || model?.capabilities.supportedAspectRatios.includes(r)),
    [model],
  );
  const sizeOptions = useMemo(() => model?.capabilities.supportedImageSizes ?? [], [model]);
  return { composer, providers, models, model, aspectOptions, sizeOptions };
}

/**
 * Keeps the composer on a usable provider/model/format. Mounted by the always-visible listing card, so it
 * runs even while "Advanced options" is collapsed.
 */
export function useComposerDefaults(): void {
  const { composer, models, model, aspectOptions, sizeOptions } = useComposerModels();
  const settings = useSettingsStore((s) => s.settings);
  const authStatus = useAuthStore((s) => s.providerStatus[composer.providerId]);
  const loadModels = useGenerationStore((s) => s.loadModels);
  const providerId = composer.providerId;

  useEffect(() => {
    void loadModels(providerId, true);
  }, [providerId, authStatus?.state, authStatus?.projectId, loadModels]);

  useEffect(() => {
    if (models.length === 0) return;
    const preferred = composer.modelId ?? settings.lastModelByProvider[providerId];
    const valid = models.find((m) => m.id === preferred && m.available) ?? models.find((m) => m.available) ?? models[0];
    if (valid && valid.id !== composer.modelId) composer.setModel(valid.id);
  }, [models, composer, providerId, settings.lastModelByProvider]);

  useEffect(() => {
    composer.setAspectRatio(settings.defaultAspectRatio);
    if (settings.defaultImageSize) composer.setImageSize(settings.defaultImageSize);
    if (getServices().providers.has(settings.activeProviderId)) composer.setProvider(settings.activeProviderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!model) return;
    if (!aspectOptions.includes(composer.aspectRatio)) composer.setAspectRatio("original");
    if (composer.imageSize && !sizeOptions.includes(composer.imageSize)) composer.setImageSize(undefined);
  }, [model, aspectOptions, sizeOptions, composer]);
}
```

(These effects only call store actions, as the old component did; copy the exact bodies from the old file if they differ.)

`src/features/workspace/AdvancedOptions.tsx` — the old composer's shot list, custom-recipe select, output settings grid, provider options and usage meter, now controlled by props:

```tsx
import { MOCK_ENABLED } from "@/app/services";
import { useRecipesStore } from "@/app/stores/recipes-store";
import { useSettingsStore } from "@/app/stores/settings-store";
import { Button } from "@/components/ui/Button";
import { Input, Label, Switch, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Segmented } from "@/components/ui/Misc";
import type { ImageSize, ModelInfo, ShotSpec } from "@/domain/models";
import { useLocale, useT, type MessageKey } from "@/i18n";
import { cn } from "@/lib/cn";
import { UsageMeter } from "../generation/UsageMeter";
import { useState } from "react";
import { useComposerModels } from "./useComposerDefaults";

function modelLabel(m: ModelInfo): string {
  return /^(Fast|Balanced|Professional|Legacy)$/.test(m.displayName) ? m.id : m.displayName;
}

/** Everything technical behind "Advanced options" of the listing card. */
export function AdvancedOptions({
  shots,
  promptOverrides,
  onPromptOverridesChange,
  customRecipeId,
  onCustomRecipeChange,
}: {
  shots: ShotSpec[];
  promptOverrides: Record<string, string>;
  onPromptOverridesChange: (v: Record<string, string>) => void;
  customRecipeId: string;
  onCustomRecipeChange: (id: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const { composer, providers, models, aspectOptions, sizeOptions, model } = useComposerModels();
  const updateSettings = useSettingsStore((s) => s.update);
  const customRecipes = useRecipesStore((s) => s.custom);
  const [editShots, setEditShots] = useState(false);
  const providerId = composer.providerId;
  const optionSpecs = model?.capabilities.options ?? [];
  const providerOptions = composer.providerOptions[providerId] ?? {};
  const customRecipe = customRecipes.find((r) => r.id === customRecipeId);

  const changeProvider = (id: string) => {
    composer.setProvider(id);
    void updateSettings({ activeProviderId: id });
  };

  return (
    <div className="space-y-4">
      {/* JSX copied from the old ListingComposer, in this order, with these substitutions:
          1. "Shot plan" block (old lines 208–234): `customPrompts` → `promptOverrides`,
             `setCustomPrompts({...})` → `onPromptOverridesChange({...})`; rendered when `shots.length > 0 && !customRecipe`.
          2. "Custom recipe override" block (old lines 237–247): `recipeId` → `customRecipeId`, `setRecipeId` → `onCustomRecipeChange`.
          3. "Output settings" grid (old lines 250–308) unchanged (uses changeProvider, models, aspectOptions, sizeOptions).
          4. Provider options (old lines 310–361) WITHOUT the inner collapse button: render the `optionSpecs.map(…)` list
             and the "reset" button directly when `optionSpecs.length > 0`.
          5. `<UsageMeter providerId={providerId} modelId={composer.modelId} />` last. */}
    </div>
  );
}
```

Executor note: the comment above is the only place this plan points at old code instead of repeating it — the old file is in git history (`git show HEAD:src/features/generation/ListingComposer.tsx`) and must be copied **before** deleting it; keep every `t(…)` key, class and aria attribute of the copied blocks.

`src/features/workspace/ListingSetupCard.tsx`

```tsx
import { useState, type ReactNode } from "react";
import { ChevronDown, Sparkles, Square, UserRound, WandSparkles } from "lucide-react";
import { listingReadiness, type ListingReadiness } from "@/app/listing-readiness";
import { navigate } from "@/app/router";
import { getServices } from "@/app/services";
import { useAuthStore } from "@/app/stores/auth-store";
import { useComposerStore } from "@/app/stores/composer-store";
import { useGenerationStore } from "@/app/stores/generation-store";
import { BRAND_MAX_LENGTH, photoPartReady, textPartReady, useListingStore, type ListingRunReport } from "@/app/stores/listing-store";
import { useProjectsStore } from "@/app/stores/projects-store";
import { useRecipesStore } from "@/app/stores/recipes-store";
import { useSettingsStore } from "@/app/stores/settings-store";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Input, Label, Switch } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { ListingCategoryId } from "@/domain/models";
import { buildListingShots, LISTING_CATEGORIES } from "@/domain/services/listing-catalog";
import { mannequinApplies, normalizeMannequin } from "@/domain/services/mannequin";
import { interpolate } from "@/domain/services/recipes";
import { useLocale, useT } from "@/i18n";
import { errorMessage } from "@/i18n/errors";
import { cn } from "@/lib/cn";
import { MannequinDialog, MannequinSummary } from "../mannequin/MannequinDialog";
import { AdvancedOptions } from "./AdvancedOptions";
import { useComposerDefaults } from "./useComposerDefaults";

/** The listing setup: brand, taxonomy, mannequin, advanced options and the single "Create the listing" button. */
export function ListingSetupCard() {
  const t = useT();
  const locale = useLocale();
  const doc = useProjectsStore((s) => s.current);
  const creating = useListingStore((s) => s.creating);
  const copyBusy = useListingStore((s) => s.copyBusy);
  const lastRun = useListingStore((s) => s.lastRun);
  const settings = useSettingsStore((s) => s.settings);
  const composerProviderId = useComposerStore((s) => s.providerId);
  // Subscriptions that change readiness (photoPartReady/textPartReady read these stores).
  useAuthStore((s) => s.providerStatus);
  useGenerationStore((s) => s.modelsByProvider);
  useComposerStore((s) => s.modelId);
  const customRecipes = useRecipesStore((s) => s.custom);
  useComposerDefaults();
  const [promptOverrides, setPromptOverrides] = useState<Record<string, string>>({});
  const [customRecipeId, setCustomRecipeId] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [mannequinOpen, setMannequinOpen] = useState(false);
  const [enableAfterSave, setEnableAfterSave] = useState(false);
  const [confirmRecreate, setConfirmRecreate] = useState(false);

  if (!doc?.project.originalImageId) return null;
  const { setListing, setBrand, setUseMannequin, createListing, cancelListing } = useListingStore.getState();
  const selection = doc.project.listing;
  const category = LISTING_CATEGORIES.find((c) => c.id === selection?.categoryId);
  const mannequin = normalizeMannequin(settings.mannequin);
  const applies = !selection || mannequinApplies(selection.categoryId);
  const mannequinOn = !!doc.project.useMannequin && applies && !!mannequin;
  const shots = selection ? buildListingShots(selection, mannequinOn && mannequin ? { mannequin } : {}) : [];
  const customRecipe = customRecipes.find((r) => r.id === customRecipeId);
  const readiness = listingReadiness({ hasImage: true, hasSelection: !!selection, photosReady: photoPartReady(), textReady: textPartReady() });
  const alreadyCreated = !!doc.project.copy || Object.keys(doc.generations).length > 0;
  const activeJobs = Object.values(doc.jobs).filter((j) => j.status === "queued" || j.status === "generating");
  const activeGeneration = activeJobs[0] ? doc.generations[activeJobs[0].generationId] : undefined;
  const activeDone = activeGeneration ? activeGeneration.jobIds.filter((id) => doc.jobs[id]?.status === "completed").length : 0;
  const running = creating || copyBusy || activeJobs.length > 0;
  const photoCount = customRecipe ? 4 : shots.length;

  const run = () =>
    void createListing({
      promptOverrides,
      ...(customRecipe ? { customRecipe: { id: customRecipe.id, prompt: interpolate(customRecipe.promptTemplate, {}) } } : {}),
    });

  const toggleMannequin = (on: boolean) => {
    if (on && !mannequin) {
      setEnableAfterSave(true);
      setMannequinOpen(true);
    } else setUseMannequin(on);
  };

  return (
    <section className="space-y-4" aria-label={t("listing.title")}>
      <div className="space-y-1.5">
        <Label htmlFor="listing-brand" hint={t("listing.brandHint")}>
          {t("listing.brand")}
        </Label>
        <Input
          id="listing-brand"
          value={doc.project.brand ?? ""}
          maxLength={BRAND_MAX_LENGTH}
          placeholder={t("listing.brandPlaceholder")}
          autoComplete="off"
          onChange={(e) => setBrand(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="category">{t("listing.category")}</Label>
        <Select<ListingCategoryId | "">
          id="category"
          value={selection?.categoryId ?? ""}
          placeholder={t("listing.chooseCategory")}
          options={LISTING_CATEGORIES.map((c) => ({
            value: c.id,
            label: c.label[locale],
            description: c.subcategories.map((s) => s.label[locale]).join(" · "),
          }))}
          onChange={(id) => {
            setPromptOverrides({});
            if (!id) return setListing(undefined);
            const first = LISTING_CATEGORIES.find((c) => c.id === id)?.subcategories[0];
            if (first) setListing({ categoryId: id, subcategoryId: first.id });
          }}
        />
      </div>
      {category && (
        <div className="space-y-1.5">
          <Label>{t("listing.subcategory")}</Label>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("listing.subcategory")}>
            {category.subcategories.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={selection?.subcategoryId === s.id}
                onClick={() => {
                  setPromptOverrides({});
                  setListing({ categoryId: category.id, subcategoryId: s.id });
                }}
                className={cn(
                  "inline-flex h-8 items-center rounded-md border px-2.5 text-xs font-medium transition-colors",
                  selection?.subcategoryId === s.id
                    ? "border-accent bg-accent-soft text-fg"
                    : "border-border text-fg-muted hover:border-border-strong hover:text-fg",
                )}
              >
                {s.label[locale]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <Switch checked={mannequinOn} disabled={!applies} onChange={toggleMannequin} label={t("mannequin.toggle")} />
          {mannequin && applies && (
            <Button variant="ghost" size="sm" leftIcon={<UserRound className="size-3.5" />} onClick={() => setMannequinOpen(true)}>
              {t("mannequin.edit")}
            </Button>
          )}
        </div>
        <div className="mt-1 text-[11px] text-fg-subtle">
          {!applies ? t("mannequin.notForCategory") : mannequin ? <MannequinSummary mannequin={mannequin} /> : t("mannequin.toggleHint")}
        </div>
      </div>
      <MannequinDialog
        open={mannequinOpen}
        onClose={() => {
          setMannequinOpen(false);
          setEnableAfterSave(false);
        }}
        onSaved={() => {
          if (enableAfterSave) setUseMannequin(true);
        }}
      />

      <div className="rounded-lg border border-border">
        <button
          type="button"
          className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-fg-muted hover:text-fg"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          {t("listing.advanced")}
          <ChevronDown className={cn("size-3.5 transition-transform", advancedOpen && "rotate-180")} />
        </button>
        {advancedOpen && (
          <div className="border-t border-border p-3">
            <AdvancedOptions
              shots={shots}
              promptOverrides={promptOverrides}
              onPromptOverridesChange={setPromptOverrides}
              customRecipeId={customRecipeId}
              onCustomRecipeChange={setCustomRecipeId}
            />
          </div>
        )}
      </div>

      <div className="space-y-2">
        {running ? (
          <div className="flex items-center gap-2">
            <div className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-border bg-bg-elevated px-3">
              <span className="size-2 shrink-0 animate-pulse rounded-full bg-accent" />
              <span className="truncate text-sm">
                {activeGeneration ? t("composer.generating", { done: activeDone, total: activeGeneration.jobIds.length }) : t("listing.creating")}
              </span>
            </div>
            <Button variant="danger" size="lg" leftIcon={<Square className="size-4" />} onClick={cancelListing} aria-label={t("generation.cancelAll")}>
              {t("common.cancel")}
            </Button>
          </div>
        ) : (
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={!readiness.canCreate}
            leftIcon={<WandSparkles className="size-4" />}
            onClick={() => (alreadyCreated ? setConfirmRecreate(true) : run())}
          >
            {alreadyCreated ? t("listing.recreate") : t("listing.create", { count: photoCount })}
          </Button>
        )}
        <ListingHints readiness={readiness} lastRun={lastRun} providerId={composerProviderId} copyProviderId={settings.copyProviderId} />
      </div>
      <ConfirmDialog
        open={confirmRecreate}
        onClose={() => setConfirmRecreate(false)}
        onConfirm={() => {
          setConfirmRecreate(false);
          run();
        }}
        title={t("listing.recreate.title")}
        body={t("listing.recreate.body")}
        confirmLabel={t("listing.recreate")}
      />
    </section>
  );
}

function ListingHints({
  readiness,
  lastRun,
  providerId,
  copyProviderId,
}: {
  readiness: ListingReadiness;
  lastRun: ListingRunReport | null;
  providerId: string;
  copyProviderId: string;
}) {
  const t = useT();
  const toSettings = () => navigate({ name: "settings", section: "providers" });
  const link = (text: string) => (
    <button type="button" className="inline-flex items-center gap-1 text-accent hover:underline" onClick={toSettings}>
      <Sparkles className="size-3" /> {text}
    </button>
  );
  const lines: ReactNode[] = [];
  if (readiness.blocker) lines.push(readiness.blocker === "listing.needProviders" ? link(t(readiness.blocker)) : t(readiness.blocker));
  else {
    if (readiness.skipped.includes("photos")) lines.push(link(t("listing.skipPhotos")));
    if (readiness.skipped.includes("text"))
      lines.push(link(t("listing.skipText", { provider: getServices().copyProviders.get(copyProviderId)?.displayName ?? copyProviderId })));
    if (lines.length === 0) lines.push(t("listing.packHint"));
  }
  if (lastRun && typeof lastRun.photos === "object") lines.push(<span className="text-danger">{errorMessage(lastRun.photos.error, providerId)}</span>);
  return (
    <div className="space-y-0.5 text-xs text-fg-subtle">
      {lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  );
}
```

`WorkspaceView.tsx`: replace the imports of `ListingComposer`/`ListingCopyPanel` usage so the left column renders, in order, `<SourcePanel />`, `<ListingSetupCard />`, `<ListingCopyPanel />`, `<PostButton />` (inside the existing `publishing ? … : <>…</>` branch). Remove the `ListingComposer` import.

`ListingCopyPanel.tsx`: in the header actions, show the generate/regenerate button **only when `copy` exists** and label it `t("copy.regenerateText")` (keep `variant="ghost" size="sm"`, `RefreshCw`, same `disabled`/`title`); the `busy` → Cancel branch is unchanged. Before any copy exists the panel shows only the model picker toggle, the busy shimmer and errors.

Delete `src/features/generation/ListingComposer.tsx` (after copying its blocks into `AdvancedOptions`); `grep -rn "ListingComposer" src` must return nothing. Add the i18n keys from the table.

- [ ] **Step 4: Run** `pnpm exec vitest run src/features/workspace/ListingSetupCard.test.tsx` → PASS; `pnpm check` → green (the old `generatePack`/`copy.generate` keys may become unused — leave them, they are harmless, or remove them from both locales if no reference remains).
- [ ] **Step 5: Verify in the browser** (web build, `preview_start` "web" or the running dev server on :1420): import an image → the card shows brand/category/subcategory/mannequin/advanced/button; the button is disabled with "Choose a category…"; picking a category enables it with the photo count; "My mannequin" opens the dialog; mobile width (375 px) still lays out in one column. Screenshot for the record.
- [ ] **Step 6: Commit** — `git add -A src/features src/i18n && git commit -m "feat(listing): listing card with brand, mannequin and a single Create button" -m "Replaces ListingComposer (split into ListingSetupCard, AdvancedOptions, useComposerDefaults); the copy panel keeps a small Regenerate text action." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"`

---

### Task 7: Docs, end-to-end verification, handoff

**Files:**

- Modify: `README.md` (Features table: "Listing packs" row mentions the listing card, brand and mannequin; "Copy" row mentions the seller's brand), `ARCHITECTURE.md` ("Listing catalogue and packs" section: mannequin, `{{pose}}`, `createListing`), `CHANGELOG.md` (`### Added`: one entry; `### Changed`: "one Create the listing button replaces the two generate buttons"), `.claude/skills/project-context/SKILL.md` (Map rows: mannequin, listing card; Decisions: one mannequin in settings, brand never in image prompts, one button with allSettled), this plan's Progress section.

- [ ] **Step 1:** Update the docs above (concise, English, same tone as the existing text).
- [ ] **Step 2:** `pnpm check` and `pnpm build` → green.
- [ ] **Step 3:** Android (if a phone is connected — `adb devices`): `NDK_HOME=… pnpm android:apk --target aarch64`, install only if the build succeeds, then check the card, the mannequin dialog and one "Create the listing" run on the device (see BUILDING.md §3.5).
- [ ] **Step 4: Commit** — `git add README.md ARCHITECTURE.md CHANGELOG.md .claude/skills/project-context/SKILL.md docs/superpowers/plans/2026-09-13-listing-setup-mannequin.md && git commit -m "docs(listing): listing card, brand and mannequin" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"`

---

## Self-review

- Spec coverage: §2 data → Task 1; §3.1–3.2 prompts → Tasks 1–2; §3.3 brand → Tasks 3–4 (`generateCopy` forces `copy.brand`); §4 orchestration + readiness → Task 4; §5 UI (card, advanced, dialog, settings, copy panel, layout) → Tasks 5–6; §6 errors → Task 4 (per-part outcomes) + Task 6 (hints); §7 tests → each task; manual checks → Tasks 6–7.
- Placeholders: one deliberate pointer — `AdvancedOptions` copies JSX blocks from the old `ListingComposer.tsx` by line range (the file exists in git at the commit before Task 6); everything else is spelled out.
- Types: `createListing(options?: CreateListingOptions)`, `ListingRunReport`, `listingReadiness` fields, `buildListingShots(selection, { mannequin })`, `MannequinDialog` props and i18n keys are identical across tasks.

## Progress

Update this section after each task (task, status, commit, deviations). A new agent resumes at the first task not marked done.

| Task                          | Status | Commit                                          | Notes                       |
| ----------------------------- | ------ | ----------------------------------------------- | --------------------------- |
| Spec                          | done   | `docs: design spec for the listing setup card…` | approved in chat 2026-09-13 |
| Plan                          | done   | (this commit)                                   |                             |
| 1 Mannequin model + helpers   | done   | `208df09`                                       | as planned                  |
| 2 Catalogue prompts           | done   | `aead02e`                                       | as planned                  |
| 3 Brand in copy prompt        | done   | (see git log: "seller's brand is imposed")      | as planned                  |
| 4 createListing orchestration | todo   |                                                 |                             |
| 5 Mannequin dialog + settings | todo   |                                                 |                             |
| 6 Listing card, single button | todo   |                                                 |                             |
| 7 Docs + verification         | todo   |                                                 |                             |
