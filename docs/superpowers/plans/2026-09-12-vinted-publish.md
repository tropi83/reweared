# Vinted publishing flow ("Poster") — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Poster" button that opens Vinted in a dedicated desktop window and pre-fills the sell form with the photos marked "À publier", the title and the description — without ever publishing by itself.

**Architecture:** Pure domain helpers (`publish.ts`) decide what can be posted and how a Vinted URL maps to a flow stage; a `PublishBridge` interface abstracts the platform (Tauri desktop implementation calling six Rust commands, unsupported implementation elsewhere); a zustand `publish-store` drives a 4-step panel. The Rust side owns the Vinted `WebviewWindow` (isolated data directory, navigation allow-list) and injects a self-contained script bundled from `src/infrastructure/publish/vinted/` into the binary. vinted.com never gets Tauri IPC.

**Tech Stack:** React 19 / TypeScript 6 / Vite 8 (rolldown) / Tailwind 4 / zustand 5 / Vitest 4 + jsdom + @testing-library; Tauri 2.11 (Rust 1.93, `WebviewWindowBuilder`, `eval_with_callback`).

**Spec:** `docs/superpowers/specs/2026-09-12-vinted-publish-design.md`

## Global Constraints

- Desktop only in this iteration; web/mobile show the button disabled with `publish.reason.desktopOnly`.
- Fields pre-filled: photos, title, description. Nothing else. The script never clicks submit.
- `PUBLISH_LIMITS = { title: 100, description: 5000, photos: 20, photoBytes: 4 * 1024 * 1024 }`; photos sent as JPEG ≤ 2048 px, base64.
- No `remote` capability, no IPC for vinted.com. Commands only in the `default` capability (main window). Vinted window label: `vinted`, data directory `$APPDATA/vinted-webview`.
- Navigation allow-list: https + `www.vinted.<tld>` / `vinted.<tld>` (com, fr, de, es, it, nl, be, pl, pt, at, lt, cz, sk, lu, hu, ro, se, fi, dk, gr, hr, ie, co.uk, us) + `accounts.google.com`, `www.facebook.com`, `appleid.apple.com`. `vinted_navigate` accepts only `/items/new` and `/`.
- All user-facing text through `src/i18n` (`en.ts` source, `fr.ts` override). Errors are `AppError`; new code `PLATFORM_UNSUPPORTED` (not retryable).
- Persistence rename `favorites → toPost` with project schema v2 migration.
- Before "done": `pnpm check`, `pnpm rust:check`, app run in `pnpm tauri dev`. Conventional Commits with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Tooling note: the Bash tool corrupts long heredocs — write patch scripts / files with the Write tool, run `python <script>`.

---

### Task 1: Rename "favourites" to "À publier" (`toPost`) with schema v2 migration

**Files:**

- Modify: `src/domain/models/project.ts` (`CURRENT_SCHEMA_VERSION`, `favorites → toPost`)
- Modify: `src/infrastructure/storage/migrations.ts` (add migration 1 → 2)
- Modify: `src/app/stores/projects-store.ts` (`toggleFavorite → toggleToPost`, field uses at lines ~175, 260-262, 277)
- Modify: `src/app/stores/ui-store.ts` (`GalleryFilter = "all" | "toPost"`)
- Modify: `src/features/generation/VariationTile.tsx`, `src/features/gallery/Lightbox.tsx`, `src/features/generation/GenerationFeed.tsx`, `src/features/workspace/WorkspaceView.tsx`
- Modify: `src/i18n/en.ts`, `src/i18n/fr.ts`
- Test: `src/infrastructure/storage/IndexedDbStorage.test.ts` (migrations block)

**Interfaces:**

- Produces: `ProjectDocument.toPost: string[]`; `useProjectsStore.getState().toggleToPost(assetId: string): void`; `GalleryFilter = "all" | "toPost"`; i18n keys `gallery.toPost` ("To post" / "À publier"), `gallery.unToPost` ("Don't post" / "Ne pas publier"), `gallery.filter.toPost` ("To post" / "À publier").

- [ ] **Step 1: Write the failing migration test**

In `src/infrastructure/storage/IndexedDbStorage.test.ts`, inside `describe("migrations")`, replace the v0 test and add a v1 test:

```ts
it("upgrades a v0 document", () => {
  const migrated = migrateProjectDocument({ project: { id: "prj_1" }, images: {}, generations: {}, jobs: {} });
  expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  expect(migrated.toPost).toEqual([]);
});

it("renames v1 favourites to toPost and is idempotent", () => {
  const v1 = { schemaVersion: 1, project: { id: "prj_1" }, images: {}, generations: {}, jobs: {}, favorites: ["img_a", "img_b"] };
  const migrated = migrateProjectDocument(v1);
  expect(migrated.schemaVersion).toBe(2);
  expect(migrated.toPost).toEqual(["img_a", "img_b"]);
  expect("favorites" in migrated).toBe(false);
  expect(migrateProjectDocument(migrated)).toEqual(migrated);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/infrastructure/storage/IndexedDbStorage.test.ts`
Expected: FAIL — `toPost` undefined / schemaVersion 1.

- [ ] **Step 3: Implement the model + migration**

`src/domain/models/project.ts`: `export const CURRENT_SCHEMA_VERSION = 2;` and replace the `favorites` field:

```ts
  /** Asset ids the user marked "À publier" (photos to post on the marketplace). */
  toPost: string[];
```

`src/infrastructure/storage/migrations.ts`:

```ts
const PROJECT_MIGRATIONS: Record<number, ProjectMigration> = {
  0: (doc) => ({ ...doc, schemaVersion: 1, favorites: Array.isArray(doc.favorites) ? doc.favorites : [] }),
  // v1 -> v2: "favourites" became the "to post" marking used by the Vinted publishing flow.
  1: ({ favorites, ...doc }) => ({ ...doc, schemaVersion: 2, toPost: Array.isArray(favorites) ? favorites : [] }),
};
```

and at the end of `migrateProjectDocument`: `result.toPost ??= [];` (replace the `favorites` line).

- [ ] **Step 4: Rename the store action and every usage**

`projects-store.ts`: interface `toggleToPost(assetId: string): void;`, creation `toPost: [],`, implementation:

```ts
  toggleToPost(assetId) {
    get().commit((doc) => {
      const idx = doc.toPost.indexOf(assetId);
      if (idx >= 0) doc.toPost.splice(idx, 1);
      else doc.toPost.push(assetId);
    });
  },
```

and in `deleteImages`: `doc.toPost = doc.toPost.filter((f) => f !== id);`.

`ui-store.ts`: `export type GalleryFilter = "all" | "toPost";`.

`VariationTile.tsx` (lines ~34-35, 87-88): `toggleToPost`, `isToPost = !!asset && doc.toPost.includes(asset.id)`, icon `CheckCircle2` from lucide-react (replace `Star`), classes `cn("size-3.5", isToPost && "fill-accent text-white")`, labels `t(isToPost ? "gallery.unToPost" : "gallery.toPost")`.

`Lightbox.tsx` (lines ~25, 44, 75, 82, 129-131): same renames; keep the `f` keyboard shortcut and drop the `asset.kind === "generation"` guard so the original can be marked too.

`GenerationFeed.tsx` (lines 30, 36, 48-49): `toPostOnly={filter === "toPost"}`, `doc.toPost.includes(...)`.

`WorkspaceView.tsx` (lines ~66-70): filter option `value: "toPost"`, icon `CheckCircle2`, label `t("gallery.filter.toPost")`.

`en.ts`: replace `gallery.favorite` / `gallery.unfavorite` / `gallery.filter.favorites` with

```ts
  "gallery.toPost": "To post",
  "gallery.unToPost": "Don't post",
  "gallery.filter.toPost": "To post",
```

`fr.ts`: `"gallery.toPost": "À publier"`, `"gallery.unToPost": "Ne pas publier"`, `"gallery.filter.toPost": "À publier"`.

- [ ] **Step 5: Run the full check**

Run: `pnpm check`
Expected: typecheck finds no leftover `favorites`/`toggleFavorite`; all tests pass (the migration test included).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(gallery): rename favourites to 'À publier' (toPost) with project schema v2" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Error code, settings flag and i18n groundwork

**Files:**

- Modify: `src/domain/models/errors.ts` (add `"PLATFORM_UNSUPPORTED"`)
- Modify: `src/domain/models/settings.ts` (`vintedAutomationAcknowledged`)
- Modify: `src/i18n/en.ts`, `src/i18n/fr.ts`
- Test: `src/domain/models/models.test.ts`

**Interfaces:**

- Produces: `GenerationErrorCode` includes `"PLATFORM_UNSUPPORTED"` (not retryable); `AppSettings.vintedAutomationAcknowledged: boolean` (default `false`); i18n keys listed in Step 3.

- [ ] **Step 1: Write the failing test**

Append to `src/domain/models/models.test.ts`:

```ts
import { DEFAULT_SETTINGS, isRetryableCode } from "@/domain/models";

describe("publish groundwork", () => {
  it("PLATFORM_UNSUPPORTED is a known, non-retryable code", () => {
    expect(isRetryableCode("PLATFORM_UNSUPPORTED")).toBe(false);
  });
  it("Vinted automation warning is not acknowledged by default", () => {
    expect(DEFAULT_SETTINGS.vintedAutomationAcknowledged).toBe(false);
  });
});
```

- [ ] **Step 2: Run it** — `pnpm exec vitest run src/domain/models` → FAIL (type error / undefined).

- [ ] **Step 3: Implement**

`errors.ts`: add `| "PLATFORM_UNSUPPORTED"` before `| "UNKNOWN_ERROR"`.

`settings.ts`: in `AppSettings` add `/** The user read the Vinted terms warning before the first automated pre-fill. */ vintedAutomationAcknowledged: boolean;` and in `DEFAULT_SETTINGS` `vintedAutomationAcknowledged: false,`.

`en.ts` — add after `"error.STORAGE_ERROR"`:

```ts
  "error.PLATFORM_UNSUPPORTED": "This feature is only available in the desktop app.",
```

and a new block:

```ts
  // Publishing on Vinted
  "publish.button": "Post {count} photos on Vinted",
  "publish.button.none": "Post on Vinted",
  "publish.reason.noPhotos": "Mark at least one photo “To post”.",
  "publish.reason.noCopy": "Write the title and description first.",
  "publish.reason.desktopOnly": "Available in the desktop app.",
  "publish.terms.title": "Automatic pre-fill on Vinted",
  "publish.terms.body":
    "The app will fill Vinted's sell form for you (title, description, photos). Vinted's terms of use forbid automated tools; using this feature is at your own risk (your account could be restricted). Nothing is published until you click “Add” in Vinted.",
  "publish.terms.dontShow": "Don't show again",
  "publish.terms.continue": "Continue",
  "publish.panel.title": "Publishing on Vinted",
  "publish.step.login": "Log in to Vinted in the window that just opened.",
  "publish.step.browse": "Then open the sell form.",
  "publish.step.form": "You are on the sell form.",
  "publish.step.filled": "Check everything and click “Add” in Vinted. Nothing is published by the app.",
  "publish.action.focus": "Show the Vinted window",
  "publish.action.openForm": "Open the sell form",
  "publish.action.fill": "Fill: title, description, {count} photos",
  "publish.action.filling": "Filling…",
  "publish.action.finish": "Done",
  "publish.action.exportPhotos": "Export the photos",
  "publish.report.title": "Title",
  "publish.report.description": "Description",
  "publish.report.photos": "Photos",
  "publish.report.filled": "filled",
  "publish.report.not_found": "not found",
  "publish.report.failed": "failed",
  "publish.report.attached": "{attached} / {requested} attached",
  "publish.report.notForm": "This is not the sell form. Open it, then fill again.",
  "publish.report.hint": "Vinted changed its page? Copy the fields below and paste them yourself.",
  "publish.closed": "The Vinted window was closed.",
  "settings.section.publish": "Publishing",
  "publish.settings.body": "The Vinted session (cookies) lives in an isolated profile on this device. Log out here to erase it.",
  "publish.settings.showTerms": "Show the automation warning again",
  "publish.settings.logout": "Log out of Vinted",
  "publish.settings.loggedOut": "Vinted session erased.",
```

`fr.ts`:

```ts
  "error.PLATFORM_UNSUPPORTED": "Cette fonction n'est disponible que dans l'application desktop.",
  "publish.button": "Poster {count} photos sur Vinted",
  "publish.button.none": "Poster sur Vinted",
  "publish.reason.noPhotos": "Marquez au moins une photo « À publier ».",
  "publish.reason.noCopy": "Rédigez d'abord le titre et la description.",
  "publish.reason.desktopOnly": "Disponible dans l'application desktop.",
  "publish.terms.title": "Pré-remplissage automatique sur Vinted",
  "publish.terms.body":
    "L'app va remplir le formulaire Vinted à votre place (titre, description, photos). Les conditions d'utilisation de Vinted interdisent les outils automatisés ; l'usage de cette fonction se fait à vos risques (restriction possible du compte). Rien n'est publié sans votre clic sur « Ajouter » dans Vinted.",
  "publish.terms.dontShow": "Ne plus afficher",
  "publish.terms.continue": "Continuer",
  "publish.panel.title": "Publication sur Vinted",
  "publish.step.login": "Connectez-vous à Vinted dans la fenêtre qui vient de s'ouvrir.",
  "publish.step.browse": "Ouvrez ensuite le formulaire de vente.",
  "publish.step.form": "Vous êtes sur le formulaire de vente.",
  "publish.step.filled": "Vérifiez et cliquez « Ajouter » dans Vinted. Rien n'est publié par l'app.",
  "publish.action.focus": "Afficher la fenêtre Vinted",
  "publish.action.openForm": "Ouvrir le formulaire Vends",
  "publish.action.fill": "Remplir : titre, description, {count} photos",
  "publish.action.filling": "Remplissage…",
  "publish.action.finish": "Terminer",
  "publish.action.exportPhotos": "Exporter les photos",
  "publish.report.title": "Titre",
  "publish.report.description": "Description",
  "publish.report.photos": "Photos",
  "publish.report.filled": "rempli",
  "publish.report.not_found": "introuvable",
  "publish.report.failed": "échec",
  "publish.report.attached": "{attached} / {requested} attachées",
  "publish.report.notForm": "Ce n'est pas le formulaire de vente. Ouvrez-le, puis remplissez à nouveau.",
  "publish.report.hint": "Vinted a changé sa page ? Copiez les champs ci-dessous et collez-les vous-même.",
  "publish.closed": "La fenêtre Vinted a été fermée.",
  "settings.section.publish": "Publication",
  "publish.settings.body": "La session Vinted (cookies) vit dans un profil isolé sur cet appareil. Déconnectez-vous ici pour l'effacer.",
  "publish.settings.showTerms": "Afficher à nouveau l'avertissement",
  "publish.settings.logout": "Se déconnecter de Vinted",
  "publish.settings.loggedOut": "Session Vinted effacée.",
```

- [ ] **Step 4: Run** `pnpm check` → all green (the settings-store already spreads `DEFAULT_SETTINGS` over stored settings, so old settings files gain the new flag).

- [ ] **Step 5: Commit** — `git commit -am "feat(publish): PLATFORM_UNSUPPORTED code, terms acknowledgement setting and i18n" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"`

---

### Task 3: Pure domain helpers (`publish.ts`)

**Files:**

- Create: `src/domain/services/publish.ts`
- Test: `src/domain/services/publish.test.ts`

**Interfaces:**

- Consumes: `ProjectDocument.toPost`, `Project.copy` (Task 1).
- Produces (exact):

```ts
export interface PublishPhoto {
  name: string;
  mimeType: "image/jpeg" | "image/png";
  data: string;
}
export interface PublishPayload {
  title: string;
  description: string;
  photos: PublishPhoto[];
}
export type FieldFillResult = "filled" | "not_found" | "failed";
export interface FillReport {
  pageOk: boolean;
  title: FieldFillResult;
  description: FieldFillResult;
  photos: { requested: number; attached: number };
}
export type PublishStage = "closed" | "login" | "browsing" | "form" | "filled";
export type PublishBlocker = "noPhotos" | "noCopy" | "desktopOnly";
export const PUBLISH_LIMITS: { title: 100; description: 5000; photos: 20; photoBytes: number };
export const VINTED_SELL_PATH = "/items/new";
export function canPost(doc: ProjectDocument | null | undefined, platform: { desktop: boolean }): { ok: boolean; reasons: PublishBlocker[] };
export function orderedPhotoIds(doc: ProjectDocument): string[];
export function isVintedHost(host: string): boolean;
export function isVintedLoginUrl(url: string): boolean;
export function isVintedSellFormUrl(url: string): boolean;
export function stageForUrl(url: string | undefined): Exclude<PublishStage, "filled">;
export function isFillReport(value: unknown): value is FillReport;
```

- [ ] **Step 1: Write the failing tests** — `src/domain/services/publish.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ProjectDocument } from "@/domain/models";
import { canPost, isFillReport, isVintedLoginUrl, isVintedSellFormUrl, orderedPhotoIds, PUBLISH_LIMITS, stageForUrl } from "./publish";

function doc(over: Partial<ProjectDocument> = {}): ProjectDocument {
  const img = (id: string, kind: "original" | "generation", createdAt: string, generationId?: string) => ({
    id,
    projectId: "prj_1",
    kind,
    mimeType: "image/png" as const,
    width: 10,
    height: 10,
    byteSize: 1,
    createdAt,
    ...(generationId ? { generationId } : {}),
  });
  return {
    schemaVersion: 2,
    appVersion: "0",
    project: {
      id: "prj_1",
      name: "p",
      originalImageId: "orig",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      copy: { title: "Chemise", description: "Blanche", keywords: [], language: "fr", generatedAt: "", provider: "gemini", model: "m" },
    },
    images: {
      orig: img("orig", "original", "2026-01-01T00:00:00Z"),
      g1: img("g1", "generation", "2026-01-02T00:00:00Z", "gen_a"),
      g2: img("g2", "generation", "2026-01-03T00:00:00Z", "gen_b"),
      g3: img("g3", "generation", "2026-01-02T00:00:01Z", "gen_a"),
    },
    generations: {},
    jobs: {},
    toPost: ["g2", "orig", "g1"],
    ...over,
  } as ProjectDocument;
}

describe("canPost", () => {
  it("is ok on desktop with photos and copy", () =>
    expect(canPost(doc(), { desktop: true })).toEqual({ ok: false, reasons: [] }.ok === false ? { ok: true, reasons: [] } : { ok: true, reasons: [] }));
  it("lists every blocker", () => {
    expect(canPost(doc({ toPost: [] }), { desktop: true }).reasons).toEqual(["noPhotos"]);
    const noCopy = doc();
    delete noCopy.project.copy;
    expect(canPost(noCopy, { desktop: true }).reasons).toEqual(["noCopy"]);
    expect(canPost(doc(), { desktop: false }).reasons).toEqual(["desktopOnly"]);
    expect(canPost(null, { desktop: true }).reasons).toEqual(["noPhotos", "noCopy"]);
  });
  it("ignores marked ids whose image no longer exists and empty copy", () => {
    expect(canPost(doc({ toPost: ["ghost"] }), { desktop: true }).reasons).toEqual(["noPhotos"]);
    const blank = doc();
    blank.project.copy!.title = "  ";
    expect(canPost(blank, { desktop: true }).reasons).toEqual(["noCopy"]);
  });
});

describe("orderedPhotoIds", () => {
  it("puts the original first, then generations by creation time, skipping unknown ids", () => {
    expect(orderedPhotoIds(doc({ toPost: ["g2", "ghost", "orig", "g3", "g1"] }))).toEqual(["orig", "g1", "g3", "g2"]);
  });
  it("caps at PUBLISH_LIMITS.photos", () => {
    const many: Record<string, ProjectDocument["images"][string]> = {};
    for (let i = 0; i < 25; i++)
      many[`g${i}`] = {
        id: `g${i}`,
        projectId: "prj_1",
        kind: "generation",
        mimeType: "image/png",
        width: 1,
        height: 1,
        byteSize: 1,
        createdAt: `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`,
      };
    expect(orderedPhotoIds(doc({ images: many, toPost: Object.keys(many) }))).toHaveLength(PUBLISH_LIMITS.photos);
  });
});

describe("Vinted URLs", () => {
  it("classifies hosts, login and sell-form pages", () => {
    expect(isVintedSellFormUrl("https://www.vinted.fr/items/new")).toBe(true);
    expect(isVintedSellFormUrl("https://www.vinted.co.uk/items/new?ref=x")).toBe(true);
    expect(isVintedSellFormUrl("https://www.vinted.fr/items/123-chemise")).toBe(false);
    expect(isVintedSellFormUrl("https://evil.com/items/new")).toBe(false);
    expect(isVintedLoginUrl("https://www.vinted.fr/member/signup/select_type?ref_url=%2Fitems%2Fnew")).toBe(true);
    expect(isVintedLoginUrl("https://www.vinted.fr/member/login")).toBe(true);
    expect(isVintedLoginUrl("https://accounts.google.com/o/oauth2/auth")).toBe(true);
    expect(isVintedLoginUrl("https://www.vinted.fr/")).toBe(false);
  });
  it("maps URLs to stages", () => {
    expect(stageForUrl(undefined)).toBe("closed");
    expect(stageForUrl("https://www.vinted.fr/member/login")).toBe("login");
    expect(stageForUrl("https://www.vinted.fr/")).toBe("browsing");
    expect(stageForUrl("https://www.vinted.fr/items/new")).toBe("form");
    expect(stageForUrl("not a url")).toBe("browsing");
  });
});

describe("isFillReport", () => {
  it("accepts the script's status shape only", () => {
    expect(isFillReport({ pageOk: true, title: "filled", description: "not_found", photos: { requested: 3, attached: 2 } })).toBe(true);
    expect(isFillReport({ pageOk: true, title: "yes", description: "filled", photos: { requested: 1, attached: 1 } })).toBe(false);
    expect(isFillReport(null)).toBe(false);
  });
});
```

(Replace the first `canPost` assertion with the plain form `expect(canPost(doc(), { desktop: true })).toEqual({ ok: true, reasons: [] });` — written plainly here to avoid confusion.)

- [ ] **Step 2: Run** `pnpm exec vitest run src/domain/services/publish.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `src/domain/services/publish.ts`:

```ts
import type { ProjectDocument } from "@/domain/models";

/** One photo sent to the injected script (base64 bytes, ≤ PUBLISH_LIMITS.photoBytes decoded). */
export interface PublishPhoto {
  name: string;
  mimeType: "image/jpeg" | "image/png";
  data: string;
}
export interface PublishPayload {
  title: string;
  description: string;
  photos: PublishPhoto[];
}
export type FieldFillResult = "filled" | "not_found" | "failed";
/** Written by the injected script to `window.__aivPrefill.status`, read back by Rust. */
export interface FillReport {
  pageOk: boolean;
  title: FieldFillResult;
  description: FieldFillResult;
  photos: { requested: number; attached: number };
}
export type PublishStage = "closed" | "login" | "browsing" | "form" | "filled";
export type PublishBlocker = "noPhotos" | "noCopy" | "desktopOnly";

/** Vinted's own form limits (title 100, description 5000, 20 photos) and our transfer cap per photo. */
export const PUBLISH_LIMITS = { title: 100, description: 5000, photos: 20, photoBytes: 4 * 1024 * 1024 } as const;
export const VINTED_SELL_PATH = "/items/new";

const VINTED_TLDS = [
  "com",
  "fr",
  "de",
  "es",
  "it",
  "nl",
  "be",
  "pl",
  "pt",
  "at",
  "lt",
  "cz",
  "sk",
  "lu",
  "hu",
  "ro",
  "se",
  "fi",
  "dk",
  "gr",
  "hr",
  "ie",
  "co.uk",
  "us",
];
const LOGIN_PROVIDER_HOSTS = new Set(["accounts.google.com", "www.facebook.com", "appleid.apple.com"]);

export function isVintedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return VINTED_TLDS.some((tld) => h === `vinted.${tld}`);
}

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function isVintedLoginUrl(url: string): boolean {
  const u = parse(url);
  if (!u || u.protocol !== "https:") return false;
  if (LOGIN_PROVIDER_HOSTS.has(u.host)) return true;
  return isVintedHost(u.host) && /^\/member\/(login|signup)(\/|$)/.test(u.pathname);
}

export function isVintedSellFormUrl(url: string): boolean {
  const u = parse(url);
  return !!u && u.protocol === "https:" && isVintedHost(u.host) && u.pathname.replace(/\/$/, "") === VINTED_SELL_PATH;
}

export function stageForUrl(url: string | undefined): Exclude<PublishStage, "filled"> {
  if (url === undefined) return "closed";
  if (isVintedSellFormUrl(url)) return "form";
  if (isVintedLoginUrl(url)) return "login";
  return "browsing";
}

const FIELD_RESULTS: ReadonlySet<string> = new Set(["filled", "not_found", "failed"]);

export function isFillReport(value: unknown): value is FillReport {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const photos = v.photos as Record<string, unknown> | undefined;
  return (
    typeof v.pageOk === "boolean" &&
    FIELD_RESULTS.has(String(v.title)) &&
    FIELD_RESULTS.has(String(v.description)) &&
    !!photos &&
    typeof photos.requested === "number" &&
    typeof photos.attached === "number"
  );
}

/** Marked photos in posting order: the original first, then generations by creation time; unknown ids dropped, capped. */
export function orderedPhotoIds(doc: ProjectDocument): string[] {
  const assets = doc.toPost.map((id) => doc.images[id]).filter((a): a is NonNullable<typeof a> => !!a);
  assets.sort((a, b) => (a.kind === b.kind ? a.createdAt.localeCompare(b.createdAt) : a.kind === "original" ? -1 : 1));
  return assets.slice(0, PUBLISH_LIMITS.photos).map((a) => a.id);
}

export function canPost(doc: ProjectDocument | null | undefined, platform: { desktop: boolean }): { ok: boolean; reasons: PublishBlocker[] } {
  const reasons: PublishBlocker[] = [];
  if (!doc || orderedPhotoIds(doc).length === 0) reasons.push("noPhotos");
  const copy = doc?.project.copy;
  if (!copy || !copy.title.trim() || !copy.description.trim()) reasons.push("noCopy");
  if (!platform.desktop) reasons.push("desktopOnly");
  return { ok: reasons.length === 0, reasons };
}
```

- [ ] **Step 4: Run** the test file → PASS. Then `pnpm exec prettier --write src/domain/services/publish*.ts`.

- [ ] **Step 5: Commit** — `git add src/domain/services/publish.ts src/domain/services/publish.test.ts && git commit -m "feat(publish): domain helpers (canPost, photo order, Vinted URL stages, report guard)" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"`

---

### Task 4: Injected pre-fill script, selectors, bundle and CI freshness

**Files:**

- Create: `src/infrastructure/publish/vinted/selectors.ts`
- Create: `src/infrastructure/publish/vinted/prefill.ts`
- Create: `src/infrastructure/publish/vinted/entry.ts`
- Create: `src/infrastructure/publish/vinted/prefill.test.ts`
- Create: `vite.prefill.config.ts`
- Create: `src-tauri/scripts/vinted-prefill.js` (generated, committed)
- Modify: `package.json` (`"build:prefill": "vite build --config vite.prefill.config.ts"`), `.github/workflows/ci.yml` (freshness step), `.prettierignore`/`eslint` ignore for the generated file

**Interfaces:**

- Consumes: `PublishPayload`, `FillReport` (Task 3) — **type-only** imports (the bundle must not pull app code).
- Produces: `createPrefill(win: Window, selectors: VintedSelectors): { run(payload: PublishPayload): void; readonly status: FillReport | null }`; global `window.__aivPrefill` with the same shape; `VINTED_SELECTORS`.

Rules for this directory: no imports outside `src/infrastructure/publish/vinted/` except `import type` from `@/domain/services/publish`. No `@/i18n`, no logger.

- [ ] **Step 1: Write the failing test** — `prefill.test.ts` (jsdom):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPrefill } from "./prefill";
import { VINTED_SELECTORS, type VintedSelectors } from "./selectors";

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** Minimal stand-in for Vinted's React-controlled sell form. */
function mountForm({ withDescription = true } = {}) {
  document.body.innerHTML = `
    <form data-testid="item-upload-form">
      <input type="file" accept="image/*" multiple data-testid="photo-input" />
      <div data-testid="photo-thumbnails"></div>
      <input name="title" data-testid="title--input" value="" />
      ${withDescription ? '<textarea name="description" data-testid="description--input"></textarea>' : ""}
      <button type="submit">Ajouter</button>
    </form>`;
  const seen: Record<string, string[]> = { title: [], description: [] };
  // React listens to native "input" events; record what a controlled component would see.
  document.querySelector('[name="title"]')!.addEventListener("input", (e) => seen.title.push((e.target as HTMLInputElement).value));
  document.querySelector('[name="description"]')?.addEventListener("input", (e) => seen.description.push((e.target as HTMLTextAreaElement).value));
  const photoInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  photoInput.addEventListener("change", () => {
    const box = document.querySelector('[data-testid="photo-thumbnails"]')!;
    for (const f of Array.from(photoInput.files ?? [])) box.insertAdjacentHTML("beforeend", `<img data-testid="photo-thumbnail" alt="${f.name}">`);
  });
  const submit = vi.fn();
  document.querySelector("form")!.addEventListener("submit", submit);
  return { seen, submit };
}

const payload = {
  title: "Chemise blanche",
  description: "Coton, très bon état.",
  photos: [
    { name: "a.png", mimeType: "image/png" as const, data: PNG_B64 },
    { name: "b.png", mimeType: "image/png" as const, data: PNG_B64 },
  ],
};

describe("vinted prefill", () => {
  beforeEach(() => vi.useFakeTimers());

  it("fills title, description and photos through native setters + events, never submits", async () => {
    const { seen, submit } = mountForm();
    const prefill = createPrefill(window, VINTED_SELECTORS);
    prefill.run(payload);
    await vi.advanceTimersByTimeAsync(600);
    expect(seen.title.at(-1)).toBe("Chemise blanche");
    expect(seen.description.at(-1)).toBe("Coton, très bon état.");
    expect(prefill.status).toEqual({ pageOk: true, title: "filled", description: "filled", photos: { requested: 2, attached: 2 } });
    expect(submit).not.toHaveBeenCalled();
    expect(window.__aivPrefill).toBeUndefined(); // createPrefill does not touch globals; entry.ts does
  });

  it("uses fallback selectors and reports missing fields", async () => {
    mountForm({ withDescription: false });
    const selectors: VintedSelectors = { ...VINTED_SELECTORS, titleInput: ['input[name="nope"]', ...VINTED_SELECTORS.titleInput] };
    const prefill = createPrefill(window, selectors);
    prefill.run(payload);
    await vi.advanceTimersByTimeAsync(600);
    expect(prefill.status?.title).toBe("filled");
    expect(prefill.status?.description).toBe("not_found");
  });

  it("reports pageOk=false and does nothing outside the sell form", () => {
    document.body.innerHTML = "<main><h1>Vinted</h1></main>";
    const prefill = createPrefill(window, VINTED_SELECTORS);
    prefill.run(payload);
    expect(prefill.status).toEqual({ pageOk: false, title: "not_found", description: "not_found", photos: { requested: 2, attached: 0 } });
  });

  it("does not re-attach photos that are already there", async () => {
    mountForm();
    const prefill = createPrefill(window, VINTED_SELECTORS);
    prefill.run(payload);
    await vi.advanceTimersByTimeAsync(600);
    prefill.run(payload);
    await vi.advanceTimersByTimeAsync(600);
    expect(document.querySelectorAll('[data-testid="photo-thumbnail"]')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run** `pnpm exec vitest run src/infrastructure/publish` → FAIL (modules missing).

- [ ] **Step 3: Implement `selectors.ts`**

```ts
/**
 * DOM anchors on Vinted's sell form (https://www.vinted.<tld>/items/new). Ordered candidate lists:
 * the first match wins. When Vinted changes its markup, only this file changes.
 * Verified against the live form on YYYY-MM-DD (update when re-checked — see DEVELOPMENT.md).
 */
export interface VintedSelectors {
  sellFormRoot: string[];
  titleInput: string[];
  descriptionInput: string[];
  photoInput: string[];
  photoThumbnail: string[];
}

export const VINTED_SELECTORS: VintedSelectors = {
  sellFormRoot: ['[data-testid="item-upload-form"]', 'form[action*="/items"]', "form"],
  titleInput: ['[data-testid="title--input"]', 'input[name="title"]', "input#title"],
  descriptionInput: ['[data-testid="description--input"]', 'textarea[name="description"]', "textarea#description"],
  photoInput: ['[data-testid="photo-input"]', 'input[type="file"][accept*="image"]', 'input[type="file"]'],
  photoThumbnail: ['[data-testid="photo-thumbnail"]', '[data-testid*="media-thumbnail"]', 'img[src^="blob:"]'],
};
```

- [ ] **Step 4: Implement `prefill.ts`**

```ts
import type { FieldFillResult, FillReport, PublishPayload } from "@/domain/services/publish";
import type { VintedSelectors } from "./selectors";

export interface Prefill {
  run(payload: PublishPayload): void;
  readonly status: FillReport | null;
}

const THUMBNAIL_WAIT_MS = 10_000;
const THUMBNAIL_POLL_MS = 250;

/**
 * Fills Vinted's sell form. Self-contained on purpose: it is bundled into the Tauri binary and
 * evaluated inside vinted.com, where nothing from the app exists. Never clicks submit.
 */
export function createPrefill(win: Window, selectors: VintedSelectors): Prefill {
  const doc = win.document;
  let status: FillReport | null = null;

  const find = <T extends Element>(candidates: string[]): T | null => {
    for (const sel of candidates) {
      try {
        const el = doc.querySelector<T>(sel);
        if (el) return el;
      } catch {
        /* invalid selector in this engine: try the next one */
      }
    }
    return null;
  };

  // React-controlled inputs ignore `el.value = x`; go through the prototype setter, then notify.
  const setText = (el: HTMLInputElement | HTMLTextAreaElement, value: string): FieldFillResult => {
    try {
      const proto = el instanceof win.HTMLTextAreaElement ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new win.Event("input", { bubbles: true }));
      el.dispatchEvent(new win.Event("change", { bubbles: true }));
      return "filled";
    } catch {
      return "failed";
    }
  };

  const toFile = (photo: PublishPayload["photos"][number]): File => {
    const bin = win.atob(photo.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new win.File([bytes], photo.name, { type: photo.mimeType });
  };

  const countThumbnails = () => {
    for (const sel of selectors.photoThumbnail) {
      try {
        const n = doc.querySelectorAll(sel).length;
        if (n > 0) return n;
      } catch {
        /* next */
      }
    }
    return 0;
  };

  const attachPhotos = (photos: PublishPayload["photos"], onDone: (attached: number) => void) => {
    if (photos.length === 0 || countThumbnails() > 0) return onDone(countThumbnails());
    const input = find<HTMLInputElement>(selectors.photoInput);
    if (!input) return onDone(0);
    try {
      const dt = new win.DataTransfer();
      for (const p of photos) dt.items.add(toFile(p));
      input.files = dt.files;
      input.dispatchEvent(new win.Event("change", { bubbles: true }));
    } catch {
      return onDone(0);
    }
    const started = Date.now();
    const tick = () => {
      const n = countThumbnails();
      if (n >= photos.length || Date.now() - started > THUMBNAIL_WAIT_MS) onDone(n);
      else win.setTimeout(tick, THUMBNAIL_POLL_MS);
    };
    win.setTimeout(tick, THUMBNAIL_POLL_MS);
  };

  return {
    get status() {
      return status;
    },
    run(payload) {
      const pageOk = !!find(selectors.sellFormRoot) && !!find(selectors.titleInput);
      status = { pageOk, title: "not_found", description: "not_found", photos: { requested: payload.photos.length, attached: 0 } };
      if (!pageOk) return;
      const title = find<HTMLInputElement>(selectors.titleInput);
      const description = find<HTMLTextAreaElement>(selectors.descriptionInput);
      status = {
        ...status,
        title: title ? setText(title, payload.title) : "not_found",
        description: description ? setText(description, payload.description) : "not_found",
      };
      attachPhotos(payload.photos, (attached) => {
        status = status && { ...status, photos: { requested: payload.photos.length, attached } };
      });
    },
  };
}
```

Note: `status` stays a plain object so `JSON.stringify(window.__aivPrefill.status)` works from Rust. `input.files = dt.files` is supported by Chromium (WebView2) and WebKit ≥ 14.1.

- [ ] **Step 5: Implement `entry.ts`** (the bundle's entry; installs the global):

```ts
import { createPrefill } from "./prefill";
import { VINTED_SELECTORS } from "./selectors";

declare global {
  interface Window {
    __aivPrefill?: ReturnType<typeof createPrefill>;
  }
}

// Idempotent: Rust may evaluate the bundle before every `run`.
window.__aivPrefill ??= createPrefill(window, VINTED_SELECTORS);
```

- [ ] **Step 6: Run the tests** → PASS. If `DataTransfer` is missing in jsdom, add to `src/test/setup.ts` a minimal polyfill:

```ts
if (typeof DataTransfer === "undefined") {
  class FakeDataTransfer {
    private list: File[] = [];
    items = { add: (f: File) => void this.list.push(f) };
    get files() {
      const arr = this.list.slice() as File[] & { item(i: number): File | null };
      arr.item = (i) => arr[i] ?? null;
      return arr as unknown as FileList;
    }
  }
  Object.assign(globalThis, { DataTransfer: FakeDataTransfer });
}
```

and make `input.files = …` assignable in jsdom by defining the property in the test's `mountForm` (`Object.defineProperty(photoInput, "files", { writable: true, value: null })`) if the assignment throws.

- [ ] **Step 7: Bundle config** — `vite.prefill.config.ts`:

```ts
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

/** Builds the script injected into the Vinted window (see docs/superpowers/specs/2026-09-12-vinted-publish-design.md §5). */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    lib: { entry: "src/infrastructure/publish/vinted/entry.ts", formats: ["iife"], name: "__aivPrefillBundle", fileName: () => "vinted-prefill.js" },
    outDir: "src-tauri/scripts",
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    target: "es2020",
  },
});
```

`package.json` scripts: `"build:prefill": "vite build --config vite.prefill.config.ts",` and make `check` include a freshness guard: `"check": "pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm prefill:verify"`, `"prefill:verify": "pnpm build:prefill && git diff --quiet -- src-tauri/scripts/vinted-prefill.js || (echo 'vinted-prefill.js is stale: run pnpm build:prefill and commit' && exit 1)"`.

Add `src-tauri/scripts/` to `.prettierignore` and to the ESLint `ignores`. Run `pnpm build:prefill`; confirm `src-tauri/scripts/vinted-prefill.js` starts with `var __aivPrefillBundle=(function(){` (or similar IIFE) and contains `__aivPrefill`. Commit the generated file.

CI (`.github/workflows/ci.yml`, web job): after the test step add

```yaml
- name: Prefill bundle is up to date
  run: pnpm prefill:verify
```

- [ ] **Step 8: Run** `pnpm check` → green. **Commit**: `git add -A && git commit -m "feat(publish): Vinted pre-fill script, selectors, bundle and freshness guard" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"`

---

### Task 5: Rust commands for the Vinted window

**Files:**

- Create: `src-tauri/src/vinted.rs`
- Modify: `src-tauri/src/lib.rs` (mod + handlers)
- Modify: `src-tauri/capabilities/default.json` (no new permission is needed for app commands; add `core:window:allow-set-focus`? — no: focusing is done in Rust. Add nothing.)
- Modify: `SECURITY.md` (justification of the six commands)
- Test: `#[cfg(test)]` in `vinted.rs`

**Interfaces:**

- Consumes: `src-tauri/scripts/vinted-prefill.js` (Task 4) via `include_str!`.
- Produces commands (all `Result<_, String>`): `vinted_open()`, `vinted_navigate(path: String)`, `vinted_prefill(payload: PrefillPayload)`, `vinted_poll() -> Option<serde_json::Value>`, `vinted_close()`, `vinted_clear_session()`; events emitted to window `main`: `vinted:page` `{ url: String }`, `vinted:closed` `{}`.
- Payload shape (serde, camelCase): `{ title: String, description: String, photos: [{ name: String, mimeType: String, data: String }] }`.

- [ ] **Step 1: Write the failing unit tests** (bottom of the new `vinted.rs`; they compile only once the functions exist):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn navigation_allow_list() {
        assert!(is_allowed_navigation(&url::Url::parse("https://www.vinted.fr/items/new").unwrap()));
        assert!(is_allowed_navigation(&url::Url::parse("https://vinted.co.uk/").unwrap()));
        assert!(is_allowed_navigation(&url::Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap()));
        assert!(!is_allowed_navigation(&url::Url::parse("http://www.vinted.fr/").unwrap()));
        assert!(!is_allowed_navigation(&url::Url::parse("https://vinted.fr.evil.com/").unwrap()));
        assert!(!is_allowed_navigation(&url::Url::parse("https://example.com/").unwrap()));
    }

    #[test]
    fn navigate_paths_are_closed() {
        assert_eq!(target_url("/items/new").unwrap(), "https://www.vinted.com/items/new");
        assert_eq!(target_url("/").unwrap(), "https://www.vinted.com/");
        assert!(target_url("/items/new?x=1").is_err());
        assert!(target_url("https://evil.com").is_err());
    }

    fn photo(bytes: usize) -> PrefillPhoto {
        PrefillPhoto { name: "a.jpg".into(), mime_type: "image/jpeg".into(), data: base64_of(bytes) }
    }
    fn base64_of(n: usize) -> String {
        // 4 base64 chars per 3 bytes
        "A".repeat(n.div_ceil(3) * 4)
    }

    #[test]
    fn payload_limits() {
        let ok = PrefillPayload { title: "t".into(), description: "d".into(), photos: vec![photo(10)] };
        assert!(validate_payload(&ok).is_ok());
        let long_title = PrefillPayload { title: "x".repeat(101), ..ok.clone() };
        assert!(validate_payload(&long_title).is_err());
        let bad_mime = PrefillPayload { photos: vec![PrefillPhoto { mime_type: "image/gif".into(), ..photo(10) }], ..ok.clone() };
        assert!(validate_payload(&bad_mime).is_err());
        let big = PrefillPayload { photos: vec![photo(4 * 1024 * 1024 + 1)], ..ok.clone() };
        assert!(validate_payload(&big).is_err());
        let too_many = PrefillPayload { photos: (0..21).map(|_| photo(1)).collect(), ..ok.clone() };
        assert!(validate_payload(&too_many).is_err());
        let bad_name = PrefillPayload { photos: vec![PrefillPhoto { name: "../x.jpg".into(), ..photo(1) }], ..ok };
        assert!(validate_payload(&bad_name).is_err());
    }

    #[test]
    fn poll_result_unwraps_double_encoded_json() {
        assert_eq!(parse_poll_result("null"), None);
        assert_eq!(parse_poll_result("\"null\""), None);
        let v = parse_poll_result("\"{\\\"pageOk\\\":true}\"").unwrap();
        assert_eq!(v["pageOk"], serde_json::Value::Bool(true));
        let direct = parse_poll_result("{\"pageOk\":false}").unwrap();
        assert_eq!(direct["pageOk"], serde_json::Value::Bool(false));
    }
}
```

- [ ] **Step 2: Run** `cd src-tauri && cargo test vinted` → compile error (module missing).

- [ ] **Step 3: Implement `vinted.rs`**

Add to `src-tauri/Cargo.toml` `[dependencies]`: `url = "2"` (already a transitive dep of tauri; declare it explicitly) and `serde_json = "1"` if not present.

```rust
//! Vinted publishing window: a second `WebviewWindow` on vinted.com with an isolated data
//! directory, a navigation allow-list and one-way script injection. vinted.com never gets Tauri
//! IPC (no capability targets this window); the app reads results back through
//! `eval_with_callback`. See SECURITY.md ("Vinted window").

use serde::{Deserialize, Serialize};
use std::sync::{mpsc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindowBuilder, WindowEvent};

pub const LABEL: &str = "vinted";
const MAIN: &str = "main";
const HOME: &str = "https://www.vinted.com/";
const ALLOWED_PATHS: &[&str] = &["/items/new", "/"];
const VINTED_TLDS: &[&str] = &["com", "fr", "de", "es", "it", "nl", "be", "pl", "pt", "at", "lt", "cz", "sk", "lu", "hu", "ro", "se", "fi", "dk", "gr", "hr", "ie", "co.uk", "us"];
const LOGIN_HOSTS: &[&str] = &["accounts.google.com", "www.facebook.com", "appleid.apple.com"];
const MAX_TITLE: usize = 100;
const MAX_DESCRIPTION: usize = 5000;
const MAX_PHOTOS: usize = 20;
const MAX_PHOTO_BYTES: usize = 4 * 1024 * 1024;
/// Built by `pnpm build:prefill` from src/infrastructure/publish/vinted/.
const PREFILL_SCRIPT: &str = include_str!("../scripts/vinted-prefill.js");

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrefillPhoto {
    pub name: String,
    pub mime_type: String,
    pub data: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PrefillPayload {
    pub title: String,
    pub description: String,
    pub photos: Vec<PrefillPhoto>,
}

#[derive(Clone, Serialize)]
struct PageEvent {
    url: String,
}

pub fn is_vinted_host(host: &str) -> bool {
    let host = host.strip_prefix("www.").unwrap_or(host);
    VINTED_TLDS.iter().any(|tld| host == format!("vinted.{tld}"))
}

pub fn is_allowed_navigation(url: &url::Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    match url.host_str() {
        Some(host) => is_vinted_host(host) || LOGIN_HOSTS.contains(&host),
        None => false,
    }
}

fn target_url(path: &str) -> Result<String, String> {
    if ALLOWED_PATHS.contains(&path) {
        Ok(format!("https://www.vinted.com{path}"))
    } else {
        Err("path not allowed".to_string())
    }
}

fn validate_payload(p: &PrefillPayload) -> Result<(), String> {
    if p.title.chars().count() > MAX_TITLE {
        return Err("title too long".into());
    }
    if p.description.chars().count() > MAX_DESCRIPTION {
        return Err("description too long".into());
    }
    if p.photos.len() > MAX_PHOTOS {
        return Err("too many photos".into());
    }
    for photo in &p.photos {
        if !matches!(photo.mime_type.as_str(), "image/jpeg" | "image/png") {
            return Err("unsupported photo type".into());
        }
        if photo.name.is_empty() || photo.name.len() > 120 || photo.name.contains(['/', '\\', '\0']) || photo.name.contains("..") {
            return Err("invalid photo name".into());
        }
        // 4 base64 chars encode 3 bytes; reject before decoding anything.
        if photo.data.len() / 4 * 3 > MAX_PHOTO_BYTES {
            return Err("photo too large".into());
        }
    }
    Ok(())
}

/// `eval_with_callback` hands back the JSON serialisation of the expression's value; since the
/// expression is `JSON.stringify(...)`, the value is itself a JSON string (double-encoded).
fn parse_poll_result(raw: &str) -> Option<serde_json::Value> {
    let outer: serde_json::Value = serde_json::from_str(raw).ok()?;
    let inner = match outer {
        serde_json::Value::String(s) => serde_json::from_str::<serde_json::Value>(&s).ok()?,
        other => other,
    };
    if inner.is_null() { None } else { Some(inner) }
}

fn data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map(|d| d.join("vinted-webview")).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn vinted_open<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        return window.set_focus().map_err(|e| e.to_string());
    }
    let main = app.clone();
    let window = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(HOME.parse().map_err(|e: url::ParseError| e.to_string())?))
        .title("Vinted")
        .inner_size(1100.0, 860.0)
        .data_directory(data_dir(&app)?)
        .on_navigation(|url| is_allowed_navigation(url))
        .on_page_load(move |_, payload| {
            let _ = main.emit_to(MAIN, "vinted:page", PageEvent { url: payload.url().to_string() });
        })
        .build()
        .map_err(|e| e.to_string())?;
    let closed = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Destroyed = event {
            let _ = closed.emit_to(MAIN, "vinted:closed", ());
        }
    });
    Ok(())
}

#[tauri::command]
pub fn vinted_navigate<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    let window = app.get_webview_window(LABEL).ok_or("vinted window is not open")?;
    let url = target_url(&path)?.parse::<url::Url>().map_err(|e| e.to_string())?;
    window.navigate(url).map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn vinted_prefill<R: Runtime>(app: AppHandle<R>, payload: PrefillPayload) -> Result<(), String> {
    validate_payload(&payload)?;
    let window = app.get_webview_window(LABEL).ok_or("vinted window is not open")?;
    let json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    // The bundle is idempotent; `run` stores its report on window.__aivPrefill.status.
    window.eval(format!("{PREFILL_SCRIPT}\n;window.__aivPrefill.run({json});")).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vinted_poll<R: Runtime>(app: AppHandle<R>) -> Result<Option<serde_json::Value>, String> {
    let Some(window) = app.get_webview_window(LABEL) else { return Ok(None) };
    let (tx, rx) = mpsc::channel::<String>();
    let tx = Mutex::new(Some(tx));
    window
        .eval_with_callback("JSON.stringify((window.__aivPrefill && window.__aivPrefill.status) || null)", move |result| {
            if let Some(tx) = tx.lock().ok().and_then(|mut guard| guard.take()) {
                let _ = tx.send(result);
            }
        })
        .map_err(|e| e.to_string())?;
    let raw = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(5)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "poll timed out".to_string())?;
    Ok(parse_poll_result(&raw))
}

#[tauri::command]
pub fn vinted_close<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn vinted_clear_session<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let existed = app.get_webview_window(LABEL).is_some();
    if !existed {
        vinted_open(app.clone())?;
    }
    let window = app.get_webview_window(LABEL).ok_or("vinted window is not open")?;
    window.clear_all_browsing_data().map_err(|e| e.to_string())?;
    window.close().map_err(|e| e.to_string())
}
```

`lib.rs`: `mod vinted;` and add to `generate_handler![...]`: `vinted::vinted_open, vinted::vinted_navigate, vinted::vinted_prefill, vinted::vinted_poll, vinted::vinted_close, vinted::vinted_clear_session,`.

If `WebviewWindowBuilder::on_page_load`'s payload type differs (`PageLoadPayload::url()` returns `&Url`), adjust to `payload.url().as_str().to_string()`. If `on_window_event` is not available on `WebviewWindow`, use `window.as_ref().window().on_window_event(...)`. Check with `cargo doc`/the crate source under `~/.cargo/registry/src/*/tauri-2.11.5/src/webview/webview_window.rs` — never guess.

- [ ] **Step 4: Run** `pnpm rust:check` (fmt + clippy `-D warnings` + tests) → green. Fix clippy hints (e.g. `needless_pass_by_value`) without changing behaviour.

- [ ] **Step 5: SECURITY.md** — add a section:

```markdown
### Vinted window (`vinted_*` commands)

| Command                                | Why it exists                                                                      | Guard                                                                                                                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vinted_open`                          | Opens `https://www.vinted.com/` in a second window so the user can log in and post | Isolated `data_directory` (`vinted-webview/`), navigation allow-list (Vinted hosts + Google/Facebook/Apple login), no capability targets the window ⇒ no IPC from vinted.com |
| `vinted_navigate`                      | Jumps to the sell form                                                             | Only `/items/new` and `/`                                                                                                                                                    |
| `vinted_prefill`                       | Injects the pre-fill script with title/description/photos                          | Script compiled into the binary (`include_str!`); payload validated (100/5000 chars, ≤ 20 photos, ≤ 4 MiB each, JPEG/PNG, safe names); never logged                          |
| `vinted_poll`                          | Reads the script's status back                                                     | Read-only expression, 5 s timeout                                                                                                                                            |
| `vinted_close`, `vinted_clear_session` | Close / erase the Vinted session                                                   | —                                                                                                                                                                            |
```

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(publish): Rust commands for the isolated Vinted window (open, navigate, prefill, poll, close, clear)" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"`

---

### Task 6: `PublishBridge` and its implementations

**Files:**

- Create: `src/infrastructure/publish/PublishBridge.ts`
- Create: `src/infrastructure/publish/TauriVintedBridge.ts`
- Create: `src/infrastructure/publish/UnsupportedBridge.ts`
- Create: `src/infrastructure/publish/createPublishBridge.ts`
- Modify: `src/app/services.ts` (`publish: PublishBridge` in `AppServices` and `createServices`)
- Test: `src/infrastructure/publish/publish-bridge.test.ts`

**Interfaces:**

- Consumes: Rust commands (Task 5), `PublishPayload`/`FillReport`/`isFillReport` (Task 3), `getPlatform()`.
- Produces:

```ts
export interface PublishBridge {
  readonly supported: boolean;
  open(): Promise<void>;
  navigate(path: "/items/new" | "/"): Promise<void>;
  prefill(payload: PublishPayload): Promise<void>;
  poll(): Promise<FillReport | null>;
  close(): Promise<void>;
  clearSession(): Promise<void>;
  onPage(cb: (url: string) => void): () => void;
  onClosed(cb: () => void): () => void;
}
export function createPublishBridge(): PublishBridge; // Tauri desktop → TauriVintedBridge, else UnsupportedBridge
```

- [ ] **Step 1: Write the failing tests** — `publish-bridge.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/domain/models";
import { UnsupportedBridge } from "./UnsupportedBridge";
import { TauriVintedBridge } from "./TauriVintedBridge";

describe("UnsupportedBridge", () => {
  it("reports unsupported and throws PLATFORM_UNSUPPORTED on every action", async () => {
    const b = new UnsupportedBridge();
    expect(b.supported).toBe(false);
    await expect(b.open()).rejects.toMatchObject({ code: "PLATFORM_UNSUPPORTED" });
    await expect(b.prefill({ title: "", description: "", photos: [] })).rejects.toBeInstanceOf(AppError);
    expect(typeof b.onPage(() => undefined)).toBe("function");
  });
});

describe("TauriVintedBridge", () => {
  it("maps calls to commands, validates poll results and wires events", async () => {
    const invoke = vi.fn(async (cmd: string) =>
      cmd === "vinted_poll" ? { pageOk: true, title: "filled", description: "filled", photos: { requested: 1, attached: 1 } } : undefined,
    );
    const handlers: Record<string, (e: { payload: unknown }) => void> = {};
    const listen = vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => {
      handlers[name] = cb;
      return () => delete handlers[name];
    });
    const b = new TauriVintedBridge({ invoke, listen });
    await b.open();
    await b.navigate("/items/new");
    await b.prefill({ title: "t", description: "d", photos: [] });
    expect(invoke.mock.calls.map((c) => c[0])).toEqual(["vinted_open", "vinted_navigate", "vinted_prefill"]);
    expect(invoke.mock.calls[1]?.[1]).toEqual({ path: "/items/new" });
    expect(await b.poll()).toMatchObject({ pageOk: true });
    invoke.mockResolvedValueOnce({ junk: 1 });
    expect(await b.poll()).toBeNull();

    const seen: string[] = [];
    const off = b.onPage((url) => seen.push(url));
    await Promise.resolve();
    handlers["vinted:page"]!({ payload: { url: "https://www.vinted.fr/" } });
    expect(seen).toEqual(["https://www.vinted.fr/"]);
    off();
    expect(handlers["vinted:page"]).toBeUndefined();
  });

  it("wraps command failures in AppError", async () => {
    const b = new TauriVintedBridge({
      invoke: vi.fn(async () => {
        throw new Error("path not allowed");
      }),
      listen: vi.fn(async () => () => undefined),
    });
    await expect(b.navigate("/")).rejects.toMatchObject({ code: "INVALID_REQUEST", detail: "path not allowed" });
  });
});
```

- [ ] **Step 2: Run** → FAIL (modules missing).

- [ ] **Step 3: Implement**

`PublishBridge.ts`: the interface above, plus `export type VintedPath = "/items/new" | "/";`.

`UnsupportedBridge.ts`:

```ts
import { AppError } from "@/domain/models";
import type { PublishBridge } from "./PublishBridge";

const unsupported = () => Promise.reject(new AppError("PLATFORM_UNSUPPORTED", "Publishing on Vinted needs the desktop app.", { retryable: false }));

/** Web and mobile: the flow is not available yet (a native plugin will implement PublishBridge later). */
export class UnsupportedBridge implements PublishBridge {
  readonly supported = false;
  open = unsupported;
  navigate = unsupported;
  prefill = unsupported;
  poll = unsupported;
  close = () => Promise.resolve();
  clearSession = unsupported;
  onPage = () => () => undefined;
  onClosed = () => () => undefined;
}
```

`TauriVintedBridge.ts`:

```ts
import { AppError } from "@/domain/models";
import { isFillReport, type FillReport, type PublishPayload } from "@/domain/services/publish";
import { createLogger } from "@/lib/logger";
import type { PublishBridge, VintedPath } from "./PublishBridge";

const log = createLogger("vinted-bridge");

/** Injected so tests need no Tauri runtime; production passes @tauri-apps/api's invoke/listen. */
export interface TauriIpc {
  invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  listen(event: string, cb: (e: { payload: unknown }) => void): Promise<() => void>;
}

export class TauriVintedBridge implements PublishBridge {
  readonly supported = true;
  constructor(private readonly ipc: TauriIpc) {}

  private async call<T = void>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    try {
      return await this.ipc.invoke<T>(cmd, args);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      log.warn(cmd, "failed:", detail);
      const code = /not allowed|too long|too many|too large|unsupported|invalid/.test(detail)
        ? "INVALID_REQUEST"
        : /timed out/.test(detail)
          ? "TIMEOUT"
          : "UNKNOWN_ERROR";
      throw new AppError(code, "The Vinted window could not complete the action.", { detail, retryable: false });
    }
  }

  open() {
    return this.call("vinted_open");
  }
  navigate(path: VintedPath) {
    return this.call("vinted_navigate", { path });
  }
  prefill(payload: PublishPayload) {
    return this.call("vinted_prefill", { payload });
  }
  async poll(): Promise<FillReport | null> {
    const value = await this.call<unknown>("vinted_poll");
    return isFillReport(value) ? value : null;
  }
  close() {
    return this.call("vinted_close");
  }
  clearSession() {
    return this.call("vinted_clear_session");
  }

  private subscribe(event: string, cb: (payload: unknown) => void): () => void {
    let off: (() => void) | undefined;
    let cancelled = false;
    void this.ipc
      .listen(event, (e) => cb(e.payload))
      .then((unlisten) => {
        if (cancelled) unlisten();
        else off = unlisten;
      });
    return () => {
      cancelled = true;
      off?.();
    };
  }
  onPage(cb: (url: string) => void) {
    return this.subscribe("vinted:page", (p) => {
      const url = (p as { url?: unknown } | null)?.url;
      if (typeof url === "string") cb(url);
    });
  }
  onClosed(cb: () => void) {
    return this.subscribe("vinted:closed", () => cb());
  }
}
```

`createPublishBridge.ts`:

```ts
import { getPlatform } from "@/infrastructure/platform/capabilities";
import type { PublishBridge } from "./PublishBridge";
import { TauriVintedBridge } from "./TauriVintedBridge";
import { UnsupportedBridge } from "./UnsupportedBridge";

export function createPublishBridge(): PublishBridge {
  const platform = getPlatform();
  if (!platform.isTauri || platform.isMobile) return new UnsupportedBridge();
  return new TauriVintedBridge({
    invoke: async (cmd, args) => (await import("@tauri-apps/api/core")).invoke(cmd, args),
    listen: async (event, cb) => (await import("@tauri-apps/api/event")).listen(event, cb),
  });
}
```

`services.ts`: add `publish: PublishBridge;` to `AppServices`, `const publish = createPublishBridge();` in `createServices`, include it in the `services = { … }` literal. The workflow test's `createServices` call needs nothing extra (web platform → `UnsupportedBridge`).

- [ ] **Step 4: Run** `pnpm check` → green. **Commit**: `git add -A && git commit -m "feat(publish): PublishBridge with Tauri and unsupported implementations" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"`

---

### Task 7: Payload builder and `publish-store`

**Files:**

- Create: `src/app/publish-payload.ts`
- Create: `src/app/stores/publish-store.ts`
- Test: `src/app/publish-store.test.ts`

**Interfaces:**

- Consumes: `services.publish` (Task 6), `services.storage.readImage`, `prepareForProvider` (existing), `orderedPhotoIds`/`PUBLISH_LIMITS`/`stageForUrl` (Task 3), `useSettingsStore` (`vintedAutomationAcknowledged`, Task 2), `useProjectsStore.current`.
- Produces:

```ts
// publish-payload.ts
export async function buildPublishPayload(doc: ProjectDocument, readImage: (asset: ImageAsset) => Promise<Blob | null>): Promise<PublishPayload>;
export async function blobToBase64(blob: Blob): Promise<string>; // re-export of the Gemini mapper helper is fine if identical — else implement here
// publish-store.ts
export type PublishSession = { stage: PublishStage; url?: string; busy: boolean; report?: FillReport; error?: GenerationError };
export const useConstants = { POLL_INTERVAL_MS: 300, POLL_TIMEOUT_MS: 20_000 };
interface PublishState {
  session: PublishSession;
  start(): Promise<void>;
  focus(): Promise<void>;
  openForm(): Promise<void>;
  fill(): Promise<void>;
  finish(): Promise<void>;
}
export const useListingStore … (no) — export const usePublishStore = create<PublishState>(…);
```

- [ ] **Step 1: Write the failing tests** — `src/app/publish-store.test.ts` (same harness as `workflow.test.tsx`: `__setServices` with a fake bridge and in-memory storage; the image-processing mock returns the blob unchanged):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/image/image-processing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infrastructure/image/image-processing")>();
  return { ...actual, prepareForProvider: async (blob: Blob) => ({ blob, mimeType: "image/jpeg" as const, width: 10, height: 10 }) };
});
vi.mock("@/infrastructure/platform/capabilities", () => ({ getPlatform: () => ({ isTauri: true, isMobile: false }) }));

import type { PublishBridge } from "@/infrastructure/publish/PublishBridge";
import type { FillReport } from "@/domain/services/publish";
import { __setServices, getServices } from "./services";
import { useProjectsStore } from "./stores/projects-store";
import { useSettingsStore } from "./stores/settings-store";
import { usePublishStore } from "./stores/publish-store";

function fakeBridge(): PublishBridge & { emitPage(url: string): void; emitClosed(): void; report: FillReport | null; calls: string[] } {
  let page: ((u: string) => void) | undefined;
  let closed: (() => void) | undefined;
  const b = {
    supported: true,
    calls: [] as string[],
    report: null as FillReport | null,
    open: async () => void b.calls.push("open"),
    navigate: async (p: string) => void b.calls.push(`navigate:${p}`),
    prefill: async () => void b.calls.push("prefill"),
    poll: async () => b.report,
    close: async () => void b.calls.push("close"),
    clearSession: async () => void b.calls.push("clear"),
    onPage: (cb: (u: string) => void) => {
      page = cb;
      return () => (page = undefined);
    },
    onClosed: (cb: () => void) => {
      closed = cb;
      return () => (closed = undefined);
    },
    emitPage: (u: string) => page?.(u),
    emitClosed: () => closed?.(),
  };
  return b;
}

const PNG = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });

describe("publish-store", () => {
  let bridge: ReturnType<typeof fakeBridge>;
  beforeEach(() => {
    bridge = fakeBridge();
    const services = getServices(); // set up by a beforeAll identical to workflow.test.tsx (createServices with IndexedDbStorage("publish-test"))
    __setServices({ ...services, publish: bridge });
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, vintedAutomationAcknowledged: true } });
  });

  it("opens the window, follows page events and fills the form", async () => {
    const doc = await useProjectsStore.getState().createFromFile(PNG, "chemise.png");
    useProjectsStore.getState().toggleToPost(doc.project.originalImageId!);
    useProjectsStore.getState().commit((d) => {
      d.project.copy = { title: "Chemise", description: "Blanche", keywords: [], language: "fr", generatedAt: "", provider: "gemini", model: "m" };
    });

    await usePublishStore.getState().start();
    expect(bridge.calls).toEqual(["open"]);
    bridge.emitPage("https://www.vinted.fr/member/login");
    expect(usePublishStore.getState().session.stage).toBe("login");
    bridge.emitPage("https://www.vinted.fr/");
    expect(usePublishStore.getState().session.stage).toBe("browsing");

    await usePublishStore.getState().openForm();
    expect(bridge.calls).toContain("navigate:/items/new");
    bridge.emitPage("https://www.vinted.fr/items/new");
    expect(usePublishStore.getState().session.stage).toBe("form");

    bridge.report = { pageOk: true, title: "filled", description: "filled", photos: { requested: 1, attached: 1 } };
    await usePublishStore.getState().fill();
    expect(bridge.calls).toContain("prefill");
    expect(usePublishStore.getState().session).toMatchObject({ stage: "filled", report: bridge.report, busy: false });

    await usePublishStore.getState().finish();
    expect(bridge.calls).toContain("close");
    expect(usePublishStore.getState().session.stage).toBe("closed");
  });

  it("times out when the script never reports", async () => {
    vi.useFakeTimers();
    // (project prepared as above)
    await usePublishStore.getState().start();
    bridge.emitPage("https://www.vinted.fr/items/new");
    const filling = usePublishStore.getState().fill();
    await vi.advanceTimersByTimeAsync(21_000);
    await filling;
    expect(usePublishStore.getState().session.error?.code).toBe("TIMEOUT");
    expect(usePublishStore.getState().session.stage).toBe("form");
    vi.useRealTimers();
  });

  it("returns to closed when the Vinted window is closed", async () => {
    await usePublishStore.getState().start();
    bridge.emitClosed();
    expect(usePublishStore.getState().session).toMatchObject({ stage: "closed", error: { code: "CANCELLED" } });
  });

  it("refuses to start without acknowledgement or when nothing can be posted", async () => {
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, vintedAutomationAcknowledged: false } });
    await usePublishStore.getState().start();
    expect(bridge.calls).toEqual([]);
    expect(usePublishStore.getState().session.stage).toBe("closed");
  });
});
```

Write the `beforeAll` exactly like `workflow.test.tsx` (create services with `IndexedDbStorage("publish-test")`, `useProjectsStore.getState().init()` if such a method exists — check `workflow.test.tsx` lines 40-60 and copy its setup).

- [ ] **Step 2: Run** → FAIL (modules missing).

- [ ] **Step 3: Implement `src/app/publish-payload.ts`**

```ts
import type { ImageAsset, ProjectDocument } from "@/domain/models";
import { orderedPhotoIds, PUBLISH_LIMITS, type PublishPayload, type PublishPhoto } from "@/domain/services/publish";
import { prepareForProvider } from "@/infrastructure/image/image-processing";
import { blobToBase64 } from "@/infrastructure/providers/gemini/GeminiMapper";

/** Vinted re-encodes uploads anyway; 2048 px JPEG keeps each photo well under the 4 MiB transfer cap. */
const PHOTO_MAX_DIMENSION = 2048;

export async function buildPublishPayload(doc: ProjectDocument, readImage: (asset: ImageAsset) => Promise<Blob | null>): Promise<PublishPayload> {
  const copy = doc.project.copy;
  const photos: PublishPhoto[] = [];
  for (const [index, id] of orderedPhotoIds(doc).entries()) {
    const asset = doc.images[id];
    if (!asset) continue;
    const blob = await readImage(asset);
    if (!blob) continue;
    const prepared = await prepareForProvider(blob, asset.mimeType, { maxDimension: PHOTO_MAX_DIMENSION, format: "image/jpeg" });
    if (prepared.blob.size > PUBLISH_LIMITS.photoBytes) continue;
    photos.push({
      name: `photo-${index + 1}.jpg`,
      mimeType: prepared.mimeType === "image/png" ? "image/png" : "image/jpeg",
      data: await blobToBase64(prepared.blob),
    });
  }
  return {
    title: (copy?.title ?? "").trim().slice(0, PUBLISH_LIMITS.title),
    description: (copy?.description ?? "").trim().slice(0, PUBLISH_LIMITS.description),
    photos,
  };
}
```

(Check `blobToBase64`'s export in `GeminiMapper.ts`; if it is not exported, move it to `src/lib/base64.ts` and import it in both places.)

- [ ] **Step 4: Implement `src/app/stores/publish-store.ts`**

```ts
import { create } from "zustand";
import { AppError, toGenerationError, type GenerationError } from "@/domain/models";
import { canPost, stageForUrl, type FillReport, type PublishStage } from "@/domain/services/publish";
import { getPlatform } from "@/infrastructure/platform/capabilities";
import { createLogger } from "@/lib/logger";
import { buildPublishPayload } from "../publish-payload";
import { getServices } from "../services";
import { useProjectsStore } from "./projects-store";
import { useSettingsStore } from "./settings-store";

const log = createLogger("publish");
export const POLL_INTERVAL_MS = 300;
export const POLL_TIMEOUT_MS = 20_000;

export interface PublishSession {
  stage: PublishStage;
  url?: string;
  busy: boolean;
  report?: FillReport;
  error?: GenerationError;
}

interface PublishState {
  session: PublishSession;
  /** Opens the Vinted window; requires canPost() and the acknowledged terms warning. */
  start(): Promise<void>;
  focus(): Promise<void>;
  openForm(): Promise<void>;
  fill(): Promise<void>;
  finish(): Promise<void>;
}

const CLOSED: PublishSession = { stage: "closed", busy: false };
let unsubscribe: (() => void) | null = null;

function desktop() {
  const p = getPlatform();
  return p.isTauri && !p.isMobile;
}

export const usePublishStore = create<PublishState>((set, get) => ({
  session: CLOSED,

  async start() {
    const doc = useProjectsStore.getState().current;
    if (!canPost(doc, { desktop: desktop() }).ok || !useSettingsStore.getState().settings.vintedAutomationAcknowledged) return;
    const bridge = getServices().publish;
    unsubscribe?.();
    const offPage = bridge.onPage((url) => {
      const stage = stageForUrl(url);
      set((s) => ({ session: { ...s.session, url, stage: s.session.stage === "filled" && stage === "form" ? "filled" : stage, error: undefined } }));
    });
    const offClosed = bridge.onClosed(() => {
      unsubscribe?.();
      unsubscribe = null;
      set({ session: { ...CLOSED, error: { code: "CANCELLED", message: "Vinted window closed.", retryable: false } } });
    });
    unsubscribe = () => {
      offPage();
      offClosed();
    };
    set({ session: { stage: "browsing", busy: false } });
    try {
      await bridge.open();
    } catch (err) {
      log.warn("open failed", toGenerationError(err).code);
      unsubscribe();
      unsubscribe = null;
      set({ session: { ...CLOSED, error: toGenerationError(err) } });
    }
  },

  async focus() {
    await getServices()
      .publish.open()
      .catch((err) => set((s) => ({ session: { ...s.session, error: toGenerationError(err) } })));
  },

  async openForm() {
    await getServices()
      .publish.navigate("/items/new")
      .catch((err) => set((s) => ({ session: { ...s.session, error: toGenerationError(err) } })));
  },

  async fill() {
    const doc = useProjectsStore.getState().current;
    if (!doc || get().session.busy) return;
    const { publish, storage } = getServices();
    set((s) => ({ session: { ...s.session, busy: true, error: undefined, report: undefined } }));
    try {
      const payload = await buildPublishPayload(doc, (asset) => storage.readImage(doc.project.id, asset.kind, asset.id));
      await publish.prefill(payload);
      const started = Date.now();
      let report: FillReport | null = null;
      while (!report || report.photos.attached < report.photos.requested) {
        if (Date.now() - started > POLL_TIMEOUT_MS) {
          if (report) break; // text filled, photos still loading: keep what we have
          throw new AppError("TIMEOUT", "The Vinted page did not answer.", { retryable: false });
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        report = await publish.poll();
        if (report && !report.pageOk) break;
      }
      set((s) => ({ session: { ...s.session, busy: false, report, stage: report?.pageOk ? "filled" : s.session.stage } }));
    } catch (err) {
      log.warn("fill failed", toGenerationError(err).code);
      set((s) => ({ session: { ...s.session, busy: false, error: toGenerationError(err) } }));
    }
  },

  async finish() {
    unsubscribe?.();
    unsubscribe = null;
    await getServices()
      .publish.close()
      .catch(() => undefined);
    set({ session: CLOSED });
  },
}));
```

- [ ] **Step 5: Run** the test file, then `pnpm check` → green. Adjust the timeout test if the loop's first `poll()` returns `null` forever (it should raise `TIMEOUT` after 20 s — the loop above does).

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(publish): payload builder and publish-store state machine" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"`

---

### Task 8: UI — "À publier" on the original, Poster button, terms dialog, Publication panel

**Files:**

- Create: `src/features/publish/PostButton.tsx`, `src/features/publish/TermsDialog.tsx`, `src/features/publish/PublishPanel.tsx`
- Modify: `src/features/workspace/SourcePanel.tsx` (toggle on the original), `src/features/workspace/WorkspaceView.tsx` (bottom bar + panel swap)
- Test: `src/features/publish/PostButton.test.tsx`

**Interfaces:**

- Consumes: `usePublishStore` (Task 7), `canPost` (Task 3), `useSettingsStore.update({ vintedAutomationAcknowledged })`, `errorMessage()` (`@/i18n/errors`), `exportMany` (`@/infrastructure/image/export`), `Dialog`, `Button`, `Select`-free.
- Produces: `<PostButton />`, `<PublishPanel />` (rendered instead of the left column when `session.stage !== "closed"`).

- [ ] **Step 1: Write the failing component test** — `PostButton.test.tsx` (@testing-library, same store setup as Task 7's test; mock `@/infrastructure/platform/capabilities` to desktop):

```ts
it("is disabled with reasons until photos are marked and copy exists, then opens the terms dialog once", async () => {
  render(<PostButton />);
  const btn = screen.getByRole("button", { name: /Post on Vinted|Poster sur Vinted/ });
  expect(btn).toBeDisabled();
  expect(screen.getByText(/Mark at least one photo/)).toBeInTheDocument();
  // mark + copy (via stores, as in Task 7)
  …
  expect(await screen.findByRole("button", { name: /Post 1 photos on Vinted/ })).toBeEnabled();
  await user.click(btn);
  expect(screen.getByRole("dialog")).toHaveTextContent(/Automatic pre-fill/);
  await user.click(screen.getByLabelText(/Don't show again/));
  await user.click(screen.getByRole("button", { name: /Continue/ }));
  expect(useSettingsStore.getState().settings.vintedAutomationAcknowledged).toBe(true);
  expect(bridge.calls).toEqual(["open"]);
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement `TermsDialog.tsx`**

```tsx
import { useState } from "react";
import { useSettingsStore } from "@/app/stores/settings-store";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useT } from "@/i18n";

export function TermsDialog({ open, onClose, onContinue }: { open: boolean; onClose: () => void; onContinue: () => void }) {
  const t = useT();
  const update = useSettingsStore((s) => s.update);
  const [dontShow, setDontShow] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("publish.terms.title")}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (dontShow) void update({ vintedAutomationAcknowledged: true });
              onContinue();
            }}
          >
            {t("publish.terms.continue")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-fg-muted">{t("publish.terms.body")}</p>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} className="size-4 accent-accent" />
        {t("publish.terms.dontShow")}
      </label>
    </Dialog>
  );
}
```

- [ ] **Step 4: Implement `PostButton.tsx`**

```tsx
import { useState } from "react";
import { Send } from "lucide-react";
import { usePublishStore } from "@/app/stores/publish-store";
import { useProjectsStore } from "@/app/stores/projects-store";
import { useSettingsStore } from "@/app/stores/settings-store";
import { Button } from "@/components/ui/Button";
import { canPost, orderedPhotoIds } from "@/domain/services/publish";
import { getPlatform } from "@/infrastructure/platform/capabilities";
import { useT, type MessageKey } from "@/i18n";
import { TermsDialog } from "./TermsDialog";

/** Bottom bar of the workspace column: the entry point of the Vinted publishing flow. */
export function PostButton() {
  const t = useT();
  const doc = useProjectsStore((s) => s.current);
  const acknowledged = useSettingsStore((s) => s.settings.vintedAutomationAcknowledged);
  const start = usePublishStore((s) => s.start);
  const [terms, setTerms] = useState(false);
  const platform = getPlatform();
  const { ok, reasons } = canPost(doc, { desktop: platform.isTauri && !platform.isMobile });
  const count = doc ? orderedPhotoIds(doc).length : 0;

  const go = () => {
    if (acknowledged) void start();
    else setTerms(true);
  };

  return (
    <div className="sticky bottom-0 border-t border-border bg-bg/95 p-3 backdrop-blur">
      <Button variant="primary" size="lg" className="w-full" disabled={!ok} leftIcon={<Send className="size-4" />} onClick={go}>
        {count > 0 ? t("publish.button", { count }) : t("publish.button.none")}
      </Button>
      {!ok && (
        <ul className="mt-1.5 space-y-0.5 text-xs text-fg-subtle">
          {reasons.map((r) => (
            <li key={r}>{t(`publish.reason.${r}` as MessageKey)}</li>
          ))}
        </ul>
      )}
      <TermsDialog
        open={terms}
        onClose={() => setTerms(false)}
        onContinue={() => {
          setTerms(false);
          // `start` re-reads the setting; when "don't show" is unchecked the user still continues this once.
          void usePublishStore.getState().start();
        }}
      />
    </div>
  );
}
```

`publish-store.start()` currently refuses when `vintedAutomationAcknowledged` is false; to support "continue this once", change its guard to accept an explicit `start({ acknowledgedOnce: true })` option: `start(options?: { acknowledgedOnce?: boolean })` and `if (!options?.acknowledgedOnce && !settings.vintedAutomationAcknowledged) return;`. Update Task 7's test and `PostButton` (`start({ acknowledgedOnce: true })` in `onContinue`).

- [ ] **Step 5: Implement `PublishPanel.tsx`**

```tsx
import { Check, Copy, ExternalLink, FolderDown, Send, X } from "lucide-react";
import { usePublishStore } from "@/app/stores/publish-store";
import { useProjectsStore } from "@/app/stores/projects-store";
import { toast } from "@/app/stores/toast-store";
import { getServices } from "@/app/services";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Misc";
import { orderedPhotoIds, type FieldFillResult } from "@/domain/services/publish";
import { exportMany } from "@/infrastructure/image/export";
import { useT, type MessageKey } from "@/i18n";
import { errorMessage } from "@/i18n/errors";

const STEP_KEY: Record<string, MessageKey> = {
  login: "publish.step.login",
  browsing: "publish.step.browse",
  form: "publish.step.form",
  filled: "publish.step.filled",
};

function Result({ label, value }: { label: string; value: FieldFillResult }) {
  const t = useT();
  const tone = value === "filled" ? "success" : value === "not_found" ? "warning" : "danger";
  return (
    <li className="flex items-center justify-between text-sm">
      <span>{label}</span>
      <Badge tone={tone}>{t(`publish.report.${value}` as MessageKey)}</Badge>
    </li>
  );
}

/** Replaces the workspace column while the Vinted window is open. */
export function PublishPanel() {
  const t = useT();
  const doc = useProjectsStore((s) => s.current);
  const session = usePublishStore((s) => s.session);
  const { focus, openForm, fill, finish } = usePublishStore.getState();
  if (!doc || session.stage === "closed") return null;
  const count = orderedPhotoIds(doc).length;
  const copy = doc.project.copy;

  const copyText = async (text: string) => {
    await navigator.clipboard?.writeText(text);
    toast.info(t("common.copied"));
  };
  const exportPhotos = async () => {
    const { storage } = getServices();
    const items = [];
    for (const id of orderedPhotoIds(doc)) {
      const asset = doc.images[id];
      const blob = asset && (await storage.readImage(doc.project.id, asset.kind, asset.id));
      if (asset && blob) items.push({ blob, name: `${doc.project.name}-${items.length + 1}` });
    }
    await exportMany(items, { type: "image/jpeg", quality: 0.92 }, `${doc.project.name}-vinted`);
  };

  return (
    <section className="flex h-full flex-col gap-4 p-4" aria-label={t("publish.panel.title")}>
      <div className="flex items-center justify-between">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
          <Send className="size-4" /> {t("publish.panel.title")}
        </h2>
        <Button variant="ghost" size="icon-sm" onClick={() => void finish()} aria-label={t("common.cancel")}>
          <X className="size-4" />
        </Button>
      </div>

      <p className="text-sm text-fg-muted">{t(STEP_KEY[session.stage] ?? "publish.step.browse")}</p>

      <div className="flex flex-col gap-2">
        <Button variant="secondary" leftIcon={<ExternalLink className="size-4" />} onClick={() => void focus()}>
          {t("publish.action.focus")}
        </Button>
        {session.stage !== "form" && session.stage !== "filled" && (
          <Button variant="primary" onClick={() => void openForm()}>
            {t("publish.action.openForm")}
          </Button>
        )}
        {(session.stage === "form" || session.stage === "filled") && (
          <Button variant="primary" disabled={session.busy} onClick={() => void fill()}>
            {session.busy ? t("publish.action.filling") : t("publish.action.fill", { count })}
          </Button>
        )}
      </div>

      {session.error && (
        <p className="text-xs text-danger" role="alert">
          {session.error.code === "CANCELLED" ? t("publish.closed") : errorMessage(session.error)}
        </p>
      )}

      {session.report && (
        <div className="space-y-2 rounded-lg border border-border bg-bg-elevated/60 p-3">
          {!session.report.pageOk && <p className="text-xs text-warning">{t("publish.report.notForm")}</p>}
          <ul className="space-y-1">
            <Result label={t("publish.report.title")} value={session.report.title} />
            <Result label={t("publish.report.description")} value={session.report.description} />
            <li className="flex items-center justify-between text-sm">
              <span>{t("publish.report.photos")}</span>
              <Badge tone={session.report.photos.attached >= session.report.photos.requested ? "success" : "warning"}>
                {t("publish.report.attached", session.report.photos)}
              </Badge>
            </li>
          </ul>
          {(session.report.title !== "filled" ||
            session.report.description !== "filled" ||
            session.report.photos.attached < session.report.photos.requested) && <p className="text-xs text-fg-subtle">{t("publish.report.hint")}</p>}
        </div>
      )}

      {copy && (
        <div className="mt-auto space-y-2 border-t border-border pt-3">
          <Button variant="ghost" size="sm" leftIcon={<Copy className="size-3.5" />} onClick={() => void copyText(copy.title)}>
            {t("copy.field.title")}
          </Button>
          <Button variant="ghost" size="sm" leftIcon={<Copy className="size-3.5" />} onClick={() => void copyText(copy.description)}>
            {t("copy.field.description")}
          </Button>
          <Button variant="ghost" size="sm" leftIcon={<FolderDown className="size-3.5" />} onClick={() => void exportPhotos()}>
            {t("publish.action.exportPhotos")}
          </Button>
          {session.stage === "filled" && (
            <Button variant="primary" className="w-full" leftIcon={<Check className="size-4" />} onClick={() => void finish()}>
              {t("publish.action.finish")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
```

(`Badge` tones: check `src/components/ui/Misc.tsx` for the accepted `tone` values — `success | neutral | warning | danger | accent` — and use only those.)

- [ ] **Step 6: Wire into `WorkspaceView.tsx` and `SourcePanel.tsx`**

`WorkspaceView.tsx`: read `const publishing = usePublishStore((s) => s.session.stage !== "closed");` and render the left `<section>` content as

```tsx
{
  publishing ? (
    <PublishPanel />
  ) : (
    <>
      <SourcePanel />
      <ListingCopyPanel />
      <ListingComposer />
      <PostButton />
    </>
  );
}
```

Keep the section `flex flex-col`; `PostButton` is `sticky bottom-0` so it stays visible while the column scrolls (the section already has `lg:overflow-y-auto`).

`SourcePanel.tsx`: in the hover toolbar next to the fullscreen button, add

```tsx
<Button
  variant="secondary"
  size="icon-sm"
  onClick={() => toggleToPost(asset.id)}
  aria-label={t(isToPost ? "gallery.unToPost" : "gallery.toPost")}
  title={t(isToPost ? "gallery.unToPost" : "gallery.toPost")}
>
  <CheckCircle2 className={cn("size-3.5", isToPost && "fill-accent text-white")} />
</Button>
```

with `const toggleToPost = useProjectsStore((s) => s.toggleToPost); const isToPost = !!asset && doc.toPost.includes(asset.id);` and, when `isToPost`, a `Badge tone="accent">{t("gallery.toPost")}</Badge>` next to the "Original" badge so the marking is visible without hovering.

- [ ] **Step 7: Run** `pnpm check`, then `pnpm tauri dev` and click through: mark photos → button enables → dialog → Vinted window opens → panel shows stages → "Open the sell form" navigates → close window → panel disappears with "window closed".

- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat(publish): Poster button, terms dialog and publication panel" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"`

---

### Task 9: Settings → Publication section

**Files:**

- Create: `src/features/settings/PublishSection.tsx`
- Modify: `src/features/settings/SettingsView.tsx` (`SECTIONS` list + render after `PrivacySection`)

**Interfaces:**

- Consumes: `useSettingsStore.update`, `getServices().publish.clearSession()`, `toast`.

- [ ] **Step 1: Implement**

```tsx
import { useState } from "react";
import { LogOut, RotateCcw } from "lucide-react";
import { getServices } from "@/app/services";
import { useSettingsStore } from "@/app/stores/settings-store";
import { toast } from "@/app/stores/toast-store";
import { Button } from "@/components/ui/Button";
import { toGenerationError } from "@/domain/models";
import { useT } from "@/i18n";
import { errorMessage } from "@/i18n/errors";
import { Section } from "./SettingsView";

export function PublishSection() {
  const t = useT();
  const acknowledged = useSettingsStore((s) => s.settings.vintedAutomationAcknowledged);
  const update = useSettingsStore((s) => s.update);
  const [busy, setBusy] = useState(false);
  const supported = getServices().publish.supported;
  return (
    <Section id="publish" title={t("settings.section.publish")}>
      <p className="text-sm text-fg-muted">{t("publish.settings.body")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<RotateCcw className="size-3.5" />}
          disabled={!acknowledged}
          onClick={() => void update({ vintedAutomationAcknowledged: false })}
        >
          {t("publish.settings.showTerms")}
        </Button>
        <Button
          variant="danger"
          size="sm"
          leftIcon={<LogOut className="size-3.5" />}
          disabled={!supported || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await getServices().publish.clearSession();
              toast.info(t("publish.settings.loggedOut"));
            } catch (err) {
              toast.error(errorMessage(toGenerationError(err)));
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("publish.settings.logout")}
        </Button>
      </div>
    </Section>
  );
}
```

`SettingsView.tsx`: add `{ id: "publish", key: "settings.section.publish" }` to `SECTIONS` after `privacy`, and `<PublishSection />` after `<PrivacySection />`.

- [ ] **Step 2: Run** `pnpm check`; in `pnpm tauri dev`, "Log out of Vinted" opens/clears/closes the window without error; on the web build the button is disabled.

- [ ] **Step 3: Commit** — `git add -A && git commit -m "feat(publish): settings section (reset warning, log out of Vinted)" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"`

---

### Task 10: Selector discovery on the real form, docs, changelog

**Files:**

- Modify: `src/infrastructure/publish/vinted/selectors.ts` (real anchors + verification date), regenerate `src-tauri/scripts/vinted-prefill.js`
- Modify: `README.md`, `SECURITY.md` (already), `PRIVACY.md`, `DEVELOPMENT.md`, `CHANGELOG.md`, `.claude/skills/project-context/SKILL.md`, `ARCHITECTURE.md`

- [ ] **Step 1: Discover the real selectors** (needs the user logged in to Vinted in the app's Vinted window)

1. Run `pnpm tauri dev`, click Poster, log in, open the sell form.
2. From the app's main window devtools, run `await (await import("@tauri-apps/api/core")).invoke("vinted_prefill", { payload: { title: "test", description: "test", photos: [] } })` then `invoke("vinted_poll")` and read which fields are `not_found`.
3. To inspect the form's DOM, temporarily evaluate a diagnostic from Rust — simplest: add a **dev-only** command `vinted_dump_selectors()` behind `#[cfg(debug_assertions)]` that evals `JSON.stringify([...document.querySelectorAll("input,textarea")].map(e => ({ tag: e.tagName, name: e.name, id: e.id, type: e.type, testid: e.dataset.testid, accept: e.accept })))` with `eval_with_callback` and returns it. Keep it debug-only; it never ships in release builds (document in SECURITY.md).
4. Update `VINTED_SELECTORS` with the observed `data-testid`s / names as **first** candidates, keep the generic fallbacks, set the "verified on" date in the file comment, `pnpm build:prefill`, re-run the fill and confirm `filled` ×2 and `attached === requested`.

- [ ] **Step 2: Docs**

- `README.md`: feature row "**Post on Vinted** — marks photos “To post”, opens Vinted in an isolated window and pre-fills the sell form (title, description, photos). Desktop only. Vinted's terms forbid automated tools; the app warns once and never publishes by itself."; Platform table Import column unchanged; add "Vinted pre-fill: desktop only".
- `PRIVACY.md`: "Vinted session — cookies/local storage of vinted.com live in `vinted-webview/` inside the app data folder, never leave the device, erasable in Settings → Publishing."
- `DEVELOPMENT.md`: section "Vinted pre-fill" — how the bundle is built (`pnpm build:prefill`, freshness guard), how to update `selectors.ts`, the debug-only dump command, and the manual checklist: real login persists after restart; fill reports 2× filled + photos attached; closing the window mid-flow resets the panel; log out clears the session; web build shows the disabled button.
- `ARCHITECTURE.md`: "Publishing" paragraph (domain → bridge → store → panel; Rust window; script bundle).
- `.claude/skills/project-context/SKILL.md`: map rows for `publish.ts`, `infrastructure/publish/*`, `src-tauri/src/vinted.rs`; decision "vinted.com never gets IPC; selectors live in one file".
- `CHANGELOG.md` `### Added`: "**Post on Vinted (desktop)** — …" and `### Changed`: "Favourites are now “To post” (project schema v2)."

- [ ] **Step 3: Final verification** — `pnpm check`, `pnpm rust:check`, `pnpm build` (web) and `pnpm tauri dev` smoke; then commit and push:

```bash
git add -A && git commit -m "feat(publish): live Vinted selectors, docs and changelog" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" && git push origin main
```

Watch the CI run (`curl -s https://api.github.com/repos/tropi83/reweared/actions/runs?per_page=1`).

---

## Self-review

- **Spec coverage:** §2.1 → Task 1 + Task 8 (SourcePanel toggle); §2.2 → Task 8; §2.3 → Tasks 2, 8, 9; §2.4 → Tasks 7, 8; §3.1 → Task 3 (+ payload builder Task 7); §3.2 → Task 6; §3.3 → Task 7; §4 → Task 5; §5 → Task 4 (+ discovery Task 10); §6 → Tasks 5, 10 docs; §8 tests → each task. Manual checklist → Task 10.
- **Placeholders:** none; the Task 8 component test has an elided store-setup line (“…”) that must be copied from Task 7's test.
- **Type consistency:** `toggleToPost`, `toPost`, `canPost(doc, { desktop })`, `orderedPhotoIds`, `stageForUrl`, `FillReport`, `PublishPayload`, `PublishBridge` method names, Rust command names and event names (`vinted:page`, `vinted:closed`) are used identically across Tasks 3–9; `start(options?: { acknowledgedOnce?: boolean })` is the final signature (Task 7 test must pass `{ acknowledgedOnce: true }` only in the terms-dialog path).
