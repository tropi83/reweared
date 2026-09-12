# Listing setup: brand, mannequin and one "Create the listing" button — design

Date: 2026-09-13 · Status: approved by the product owner in chat (approach A + "small actions"), ready for planning.
Branch: `feat/vinted-publish` (continues the same branch). Written so another agent can pick it up: read this file, then the plan `docs/superpowers/plans/2026-09-13-listing-setup-mannequin.md` and its progress ledger.

## 1. Goal

Make the main flow one gesture: the user imports the item photo and, on the same screen, gives the **brand** (optional), the **category** and the **subcategory**, optionally turns on **"My mannequin"**, then presses **one button, "Create the listing"**, which produces both the listing photos and the title/description.

Today the flow has two independent actions ("Write from the photo" in the copy panel, "Generate the N listing photos" in the composer), the brand only comes from what the vision model can read on the photo, and every "worn" shot uses a generic person derived from the category ("a woman", "a man"…).

Decisions taken with the product owner (2026-09-13):

| Question                         | Decision                                                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which shots use the mannequin    | Every shot with a person (worn, on the wrist, in hand, mirror selfie…), for a consistent person across the listing                                              |
| How many mannequins              | One, saved once in the settings and reused on every project; gender still comes from the category                                                               |
| One button, one provider missing | Do what is possible: photos and text run in parallel; a missing provider or a failure of one part never cancels the other                                       |
| Brand usage                      | Title and description only; never injected in image prompts (image models cannot draw logos reliably and would alter the item)                                  |
| Layout                           | Approach A: a "Listing" card at the top of the workspace right after import (not a modal wizard)                                                                |
| Partial re-runs after creation   | Kept as small secondary actions: "Regenerate text" in the copy panel, "Retry" per failed photo (already there); the main button becomes "Re-create the listing" |

Out of scope: several named mannequins, mannequin for kids/pets, brand in image prompts, face/hair/age settings, a mobile keystore.

## 2. Data model

### 2.1 Mannequin (`src/domain/models/mannequin.ts`, new)

```ts
export type MannequinBuild = "S" | "M" | "L";
export type MannequinPose = "standing" | "arched" | "crouching" | "sitting";
export type SkinTone = "very-fair" | "fair" | "medium" | "olive" | "brown" | "deep";
export interface Mannequin { build: MannequinBuild; pose: MannequinPose; skinTone: SkinTone }
export const MANNEQUIN_BUILDS / MANNEQUIN_POSES / SKIN_TONES   // ordered option lists for the UI
export const SKIN_TONE_SWATCH: Record<SkinTone, string>      // display colours (hex), UI only
export const DEFAULT_MANNEQUIN: Mannequin = { build: "M", pose: "standing", skinTone: "medium" };
```

Stored once in `AppSettings.mannequin?: Mannequin` (absent = never created). The settings store already merges `DEFAULT_SETTINGS` over stored settings; the field is optional, so no settings migration.

### 2.2 Project

`Project.brand?: string` — what the seller typed (trimmed, max 60 characters, empty/absent = no brand stated).
`Project.useMannequin?: boolean` — the "My mannequin" toggle for this project (absent = off).

Both optional: project schema stays v2, no migration.

## 3. Prompts

### 3.1 Mannequin in image prompts (pure, `src/domain/services/mannequin.ts`, new)

- `mannequinApplies(categoryId)`: false for `kids` (the wearer is "a child, face not visible") and `pets` (the wearer is "a pet"); true otherwise.
- `describeWearer(baseWearer, m)`: `"<base> with <build phrase> and <skin phrase>"`, e.g. `a woman with a slim build and fair skin`.
  - Build: `S` → "a slim build", `M` → "an average build", `L` → "a fuller, plus-size build".
  - Skin: very-fair → "very fair skin", fair → "fair skin", medium → "medium skin", olive → "olive skin", brown → "brown skin", deep → "deep dark skin".
- `posePhrase(pose)`: standing → "standing naturally", arched → "standing with a slightly arched back and one hip out, in a confident fashion pose", crouching → "crouching down", sitting → "sitting on a stool".

### 3.2 Catalogue changes (`listing-catalog.ts`)

- Templates gain an optional `{{pose|<default>}}` slot. The two human templates that hard-code a pose use it:
  - garment "worn": `The garment worn by {{wearer}}, {{pose|standing naturally}}, neutral studio background, …`
  - footwear "worn": `The shoes worn by {{wearer}}, {{pose|standing}}, cropped at the ankles or knees, on a neutral floor, natural light.`
    Without a mannequin the slot renders its default, so these prompts keep their meaning.
- `interpolateShot(template, { subject, wearer, pose? })`: replaces `{{pose|default}}` with `pose ?? default`; when `pose` is given and a template has `{{wearer}}` but no pose slot, it appends `The person is <pose>.` A prompt never contains two poses.
- `buildListingShots(selection, options?: { mannequin?: Mannequin })`: when `options.mannequin` is set and `mannequinApplies(category)`, every shot whose template contains `{{wearer}}` uses `describeWearer(category.wearer, m)` and `posePhrase(m.pose)`. Shots without a person (retouched, studio, detail…) are unchanged. The fidelity preamble is unchanged (the item stays identical).
- Recipes built from the catalogue (`listingRecipeId`) are unaffected; the mannequin is applied only when a listing is created, and the final prompts are stored on the jobs as today (so "Generate again" and "Retry" reuse them).

### 3.3 Brand in the copy prompt (`listing-copy.ts`)

- `ListingCopyRequest.brand?: string`.
- `buildListingCopyPrompt`: with a brand, the instruction becomes _"The seller states the brand is <JSON-quoted brand>. Use exactly this brand in the title and the description and return it in "brand"; never contradict it."_ Without a brand the current rule stays (brand only if clearly readable, else null). The brand is inserted with `JSON.stringify` so quotes in it cannot break the instruction.
- After a successful copy generation, `copy.brand` is set to `project.brand` when the seller gave one (the model's value is ignored).

## 4. Orchestration: "Create the listing"

`useListingStore.createListing()` (app layer) — the only entry point of the main button:

1. Preconditions (else no-op): a current project with an original image and a complete `listing` selection.
2. Plans two independent parts from the current state:
   - **photos**: when the composer's image provider is usable (authenticated, or the Mock provider) → `buildListingShots(listing, useMannequin && settings.mannequin ? { mannequin } : {})` → `useGenerationStore.start(...)` with the composer's model/aspect/size/options (same parameters as today's "Generate" in the composer, custom-prompt overrides from Advanced options applied);
   - **text**: when the copy provider is authenticated → `generateCopy()` with the brand.
3. Runs both with `Promise.allSettled`; each part reports `"done" | "skipped-provider" | { error }`. A failure of one part does not cancel or roll back the other.
4. `cancelListing()` cancels both (queue `cancelGeneration` for the started generation + `cancelCopy`).

Button rules (pure helper `listingReadiness(state)`, unit-tested): disabled when no original image, no complete category/subcategory, or neither provider usable; the first blocking reason is shown under the button (existing i18n keys `composer.needImage`, `listing.needCategory`, new `listing.needProviders`). When only one provider is usable the button stays enabled and a note says which part will be skipped and where to connect the other.

Labels: first run "Create the listing" (with the photo count); when the project already has generations or copy, "Re-create the listing" with a confirmation dialog ("new photos are added to the history; the title and description are replaced").

Small actions after creation: "Regenerate text" (secondary, in the copy panel, calls `generateCopy()` with the brand) and the existing per-photo "Retry" (new seed since `5473aa8`).

## 5. UI

- **`ListingSetupCard`** (`src/features/workspace/ListingSetupCard.tsx`, new) at the top of the left column, under the source image:
  brand `Input` (placeholder "No brand? Leave empty"), category `Select`, subcategory chips (as today), **"My mannequin"** `Switch` with a summary (`M · Standing · ●` with the skin swatch) and a "Edit" button, the collapsed **"Advanced options"** section, then the single primary button with progress/cancel while running.
  The toggle is disabled with a hint when `mannequinApplies` is false for the chosen category. Turning it on when no mannequin exists opens the editor first.
- **`AdvancedOptions`** (`src/features/workspace/AdvancedOptions.tsx`, extracted from today's `ListingComposer`): provider, model, aspect ratio, image size, provider options, shot list with "Edit prompts", custom recipe, usage meter. `ListingComposer.tsx` (410 lines) is removed once its parts live in these two components.
- **`MannequinDialog`** (`src/features/mannequin/MannequinDialog.tsx`, new): segmented S/M/L, four posture options, six skin swatches (buttons with `aria-label` and a visible selection ring), Save/Cancel; saves `settings.mannequin`. Also reachable from **Settings → Mannequin** (`MannequinSection`, summary + Edit + Delete).
- **`ListingCopyPanel`**: before the first creation it shows no generate button (the card's button does it); once copy exists it keeps the editable fields, copy buttons, the model picker, and a small "Regenerate text" action.
- After an import the project opens on this layout (the card is the first thing under the source); on desktop the brand field gets the focus.

All strings in `en.ts` + `fr.ts` (`listing.*`, `mannequin.*`, `copy.regenerateText`, `settings.section.mannequin`).

## 6. Error handling

- Each part surfaces its own error with `errorMessage(error, providerId)` (image part in the generation feed as today, text part in the copy panel as today); the card shows a one-line summary of skipped/failed parts.
- The brand is trimmed and capped (60); an empty brand is treated as "not stated".
- Mannequin values come from closed unions; unknown stored values (hand-edited settings) fall back to `DEFAULT_MANNEQUIN` field by field (`normalizeMannequin`).

## 7. Testing

- Domain: `mannequin.test.ts` (phrases for every option, `mannequinApplies`, `normalizeMannequin`); `listing-catalog` (mannequin changes only person shots, pose slot default vs mannequin pose, no double pose, kids/pets untouched, prompts without mannequin unchanged in meaning); `listing-copy` (brand instruction present/absent, JSON-quoted brand).
- App: `createListing` (both parts; text only; photos only; one failing does not cancel the other; mannequin applied only when toggled and applicable; brand forwarded and forced into `copy.brand`), `listingReadiness`.
- Components: `ListingSetupCard` (button enable rules and reasons, toggle opens the editor when no mannequin, re-create confirmation), `MannequinDialog` (saves settings).
- Manual: web build in the browser pane (layout desktop + mobile width); Android APK on the phone (card, mannequin dialog, one-button run).

## 8. Files

New: `src/domain/models/mannequin.ts`, `src/domain/services/mannequin.ts` (+ test), `src/features/workspace/ListingSetupCard.tsx` (+ test), `src/features/workspace/AdvancedOptions.tsx`, `src/features/mannequin/MannequinDialog.tsx` (+ test), `src/features/settings/MannequinSection.tsx`.
Changed: `src/domain/models/{settings,project,index}.ts`, `src/domain/services/{listing-catalog,listing-copy}.ts` (+ tests), `src/app/stores/listing-store.ts` (+ test), `src/features/workspace/{WorkspaceView,ListingCopyPanel}.tsx`, `src/features/settings/SettingsView.tsx`, `src/i18n/{en,fr}.ts`, docs (`README.md` features, `ARCHITECTURE.md` listing section, `CHANGELOG.md`, `.claude/skills/project-context/SKILL.md`).
Removed: `src/features/generation/ListingComposer.tsx`.
