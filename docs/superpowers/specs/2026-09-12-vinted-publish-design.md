# Vinted publishing flow ("Poster") — design

Date: 2026-09-12 · Status: approved by the product owner in chat, ready for planning.

## 1. Goal

From a project that has generated photos and a title/description, one click ("Poster") opens
Vinted in a dedicated window and pre-fills the "Sell an item" form with the chosen photos, the
title and the description. The user logs in, reviews, completes the remaining fields (category,
brand, size, condition, price…) and clicks Vinted's own "Add" button. **The app never publishes
anything by itself.**

Scope of this iteration:

- Desktop only (Windows/macOS/Linux, Tauri 2). Web and mobile show the button disabled with an
  explanation; a mobile plugin (native WebView, Kotlin + Swift) is a later phase and plugs into the
  same `PublishBridge` interface.
- Fields pre-filled: **photos, title, description** ("minimal" level). Other fields (condition,
  brand, colour, category, price) are later "fillers" added one by one without touching the rest.
- No intermediate selection screen: the images to post are the ones marked **"À publier"** (the
  existing "favourites" mechanism, renamed), the original photo included.

Non-goals: mobile/web pre-fill, automatic click on "Add", any Vinted API, scraping, price
suggestion.

## 2. User flow and UI

### 2.1 "À publier" marking

- The "Favorites" star becomes **"À publier" / "To post"** with a circled-check icon on
  `VariationTile`, in the `Lightbox`, in the gallery filter (`Toutes · À publier`) and on the
  original photo in `SourcePanel` (new toggle).
- Persistence: `ProjectDocument.favorites: string[]` is renamed `toPost: string[]`
  (project schema v1 → v2, migration `favorites → toPost`, tests). Store action
  `toggleFavorite` → `toggleToPost`.

### 2.2 "Poster" button

- Fixed bar at the bottom of the left column of `WorkspaceView` (below `ListingComposer`),
  label "Poster N photos sur Vinted" / "Post N photos on Vinted".
- Enabled iff `canPost(doc).ok`: at least one image marked to post **and** `project.copy` has a
  non-empty title and description. When disabled, the reasons are listed under the button
  (`publish.reason.noPhotos`, `publish.reason.noCopy`).
- On web/mobile (`getPlatform().isTauri && !isMobile` is false) the button is disabled with
  `publish.reason.desktopOnly`; the copy panel's copy buttons remain the fallback.

### 2.3 Terms warning dialog

First click on "Poster" (while `settings.vintedAutomationAcknowledged !== true`) opens a
`Dialog`:

> **Pré-remplissage automatique sur Vinted** — L'app va remplir le formulaire Vinted à votre
> place (titre, description, photos). Les conditions d'utilisation de Vinted interdisent les outils
> automatisés ; l'usage de cette fonction se fait à vos risques (restriction possible du compte).
> Rien n'est publié sans votre clic sur « Ajouter » dans Vinted.
> [ ] Ne plus afficher · [Annuler] [Continuer]

"Continuer" with the checkbox stores `vintedAutomationAcknowledged: true`. Settings → Publication
has "Afficher à nouveau l'avertissement" (resets the flag) and "Se déconnecter de Vinted" (clears
the Vinted webview session).

### 2.4 Publication panel

After "Continuer", the left column is replaced by the **Publication** panel (`PublishPanel`) for the
duration of the session, and the Vinted window opens. Steps, driven by `publish-store.session.stage`:

1. **Connexion** (`login`): "Connectez-vous dans la fenêtre Vinted." Detected from the URL reported
   by the bridge (login/auth paths). Button "Afficher la fenêtre Vinted" (focus).
2. **Formulaire** (`browsing`): button "Ouvrir le formulaire Vends" → `bridge.navigate("/items/new")`.
3. **Remplissage** (`form`): button "Remplir : titre, description, N photos" → `fill()`. Progress
   ("Remplissage…"), then a per-field report: ✓ rempli / ✗ introuvable (with the hint "Vinted a
   changé sa page ; copiez les champs ci-dessous") / photos `attached / requested`. Fallback actions
   always visible: "Copier le titre", "Copier la description", "Exporter les photos dans un dossier"
   (reuses `exportMany`).
4. **Publication** (`filled`): "Vérifiez et cliquez « Ajouter » dans Vinted. Rien n'est publié par
   l'app." Button "Terminer" → closes the Vinted window and restores the workspace column.

"Annuler" / closing the Vinted window at any point returns to the workspace (`stage: closed`).
Errors (`PLATFORM_UNSUPPORTED`, bridge failures, poll timeout) are `AppError`s rendered with
`errorMessage()`.

## 3. State and domain

### 3.1 Domain (`src/domain/services/publish.ts`, pure)

```ts
export interface PublishPhoto {
  name: string;
  mimeType: "image/jpeg" | "image/png";
  data: string; /* base64 */
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
export const PUBLISH_LIMITS = { title: 100, description: 5000, photos: 20, photoBytes: 4 * 1024 * 1024 } as const;

export function canPost(doc: ProjectDocument, platform: { desktop: boolean }): { ok: boolean; reasons: PublishBlocker[] };
export function orderedPhotoIds(doc: ProjectDocument): string[]; // original first if marked, then generations in creation order
export function isVintedLoginUrl(url: string): boolean;
export function isVintedSellFormUrl(url: string): boolean;
export function stageForUrl(url: string | undefined): PublishStage; // closed | login | browsing | form
```

`buildPublishPayload(doc, readImage)` lives in the app layer (needs storage + `prepareForProvider`
at ≤ 2048 px JPEG) and enforces `PUBLISH_LIMITS` (title/description trimmed and truncated, photos
capped at 20).

### 3.2 Bridge interface (`src/infrastructure/publish/PublishBridge.ts`)

```ts
export interface PublishBridge {
  readonly supported: boolean;
  open(): Promise<void>; // create or focus the Vinted window
  navigate(path: "/items/new"): Promise<void>; // relative, allow-listed paths only
  prefill(payload: PublishPayload): Promise<void>;
  poll(): Promise<FillReport | null>; // status written by the injected script
  close(): Promise<void>;
  clearSession(): Promise<void>;
  onPage(cb: (url: string) => void): () => void; // Tauri event "vinted:page"
  onClosed(cb: () => void): () => void; // Tauri event "vinted:closed"
}
```

Implementations: `TauriVintedBridge` (desktop, `invoke("vinted_*")` + `listen`), `UnsupportedBridge`
(web/mobile: `supported = false`, every call throws `AppError("PLATFORM_UNSUPPORTED")`). Registered
in `services.ts` as `services.publish`.

### 3.3 Store (`src/app/stores/publish-store.ts`)

```ts
interface PublishState {
  session: { stage: PublishStage; url?: string; busy: boolean; report?: FillReport; error?: GenerationError };
  start(): Promise<void>; // guard canPost + acknowledgement, bridge.open(), subscribe events, stage = login|browsing from first page event
  openForm(): Promise<void>;
  fill(): Promise<void>; // buildPublishPayload → bridge.prefill → poll every 300 ms, 20 s timeout → report, stage = filled when pageOk
  finish(): Promise<void>; // bridge.close(), stage = closed
  cancel(): Promise<void>;
}
```

`stage` transitions: `closed → login | browsing` (first page event) → `form` (sell-form URL) →
`filled` (report with `pageOk`) → `closed` (finish/cancel/window closed). A navigation away from the
form after `filled` goes back to `browsing`.

## 4. Rust bridge (`src-tauri/src/vinted.rs`)

All commands are registered in the `default` capability (main window only). The Vinted window
gets **no capability at all**: no Tauri IPC is reachable from vinted.com.

| Command                      | Behaviour                                                                                                                                                                                                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vinted_open`                | If a window labelled `vinted` exists → `set_focus`. Otherwise `WebviewWindowBuilder::new(app, "vinted", WebviewUrl::External("https://www.vinted.com/"))` with `data_directory($APPDATA/vinted-webview)`, `title("Vinted")`, `on_navigation(allowed_navigation)`, `on_page_load(       | w, p | emit_to main "vinted:page" { url })`, `on_window_event(Destroyed → emit "vinted:closed")`. |
| `vinted_navigate { path }`   | `path` must be in `ALLOWED_PATHS = ["/items/new", "/"]`; navigates to `https://www.vinted.com{path}`.                                                                                                                                                                                  |
| `vinted_prefill { payload }` | Validates (`title ≤ 100`, `description ≤ 5000`, `photos ≤ 20`, each `data` ≤ 4 MiB base64-decoded, `mimeType ∈ {image/jpeg, image/png}`, `name` safe), then `eval(format!("{SCRIPT};window.__aivPrefill.run({json})"))` where `SCRIPT = include_str!("../scripts/vinted-prefill.js")`. |
| `vinted_poll`                | `eval_with_callback("JSON.stringify(window.__aivPrefill && window.__aivPrefill.status                                                                                                                                                                                                  |      | null)")`, resolved through a oneshot channel; returns the parsed `FillReport`or`null`.     |
| `vinted_close`               | Closes the window if present.                                                                                                                                                                                                                                                          |
| `vinted_clear_session`       | `clear_all_browsing_data()` on the window (opening it hidden if needed), then closes it.                                                                                                                                                                                               |

`allowed_navigation(url)`: scheme `https`, host in `vinted.{com,fr,de,es,it,nl,be,pl,pt,at,lt,cz,sk,lu,hu,ro,se,fi,dk,gr,hr,ie,gb,co.uk,us}` (with `www.` prefix) or the login providers `accounts.google.com`, `www.facebook.com`, `appleid.apple.com` (+ `*.googleusercontent.com`, `*.fbcdn.net` assets are not navigations). Anything else is refused (returns `false`). Unit-tested.

Rust never logs the payload contents; errors are mapped to `AppError` codes on the JS side
(`PLATFORM_UNSUPPORTED`, `INVALID_REQUEST`, `TIMEOUT`, `UNKNOWN_ERROR`).

## 5. Injected script

- Source: `src/infrastructure/publish/vinted/prefill.ts` exporting a **self-contained** function
  `vintedPrefill(window, payload, selectors): void` (no imports, no closures over app code) plus
  `selectors.ts` (`VINTED_SELECTORS`: ordered candidate lists per field — `titleInput`,
  `descriptionInput`, `photoInput`, `photoThumbnail`, `sellFormRoot`).
- `pnpm build:prefill` (`scripts/build-prefill.mjs`) serialises `vintedPrefill.toString()` + the
  selectors into `src-tauri/scripts/vinted-prefill.js` defining `window.__aivPrefill = { run, status }`.
  The generated file is committed; a Vitest test rebuilds it in memory and fails if the committed
  copy is stale (CI guard).
- Behaviour of `run(payload)`: `status = { pageOk: !!sellFormRoot, … }`; for title/description: find
  the first matching element, set the value through the native setter
  (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype | HTMLTextAreaElement.prototype, "value").set`)
  then dispatch `input` and `change` (bubbling) — required by React-controlled inputs; for photos:
  build `File`s from base64, put them in a `DataTransfer`, assign `input.files`, dispatch `change`,
  then poll up to 10 s for `photoThumbnail` count → `attached`. Never clicks submit. Every step is
  wrapped in try/catch → `failed`; a selector miss → `not_found`. The script is idempotent
  (re-running replaces values, re-attaching photos only if none attached).
- Selector discovery is an implementation step performed with the user logged in on the real
  form; the panel's diagnostic line shows which anchors were found.

## 6. Security and privacy

- No Vinted credential ever transits through the app; login happens inside Vinted's own pages.
- Vinted session lives in `$APPDATA/vinted-webview/` (isolated from the app's own webview data),
  persists between launches, and is erasable from Settings → Publication.
- No `remote` capability: vinted.com cannot invoke any Tauri command or event. Communication is
  one-way Rust → page (`eval`), read-back only via `eval_with_callback`.
- Navigation allow-list; `vinted_navigate` accepts only `ALLOWED_PATHS`; payload validated in Rust.
- The prefill script is compiled into the binary; the frontend cannot inject arbitrary code.
- Documentation: SECURITY.md (new commands + justification), PRIVACY.md (local Vinted session),
  README (feature + Vinted terms notice), DEVELOPMENT.md (selector maintenance, manual checklist).

## 7. Files

New: `src/domain/services/publish.ts` (+ test), `src/infrastructure/publish/{PublishBridge.ts,
TauriVintedBridge.ts, UnsupportedBridge.ts}`, `src/infrastructure/publish/vinted/{prefill.ts,
selectors.ts, prefill.test.ts}`, `scripts/build-prefill.mjs`, `src-tauri/scripts/vinted-prefill.js`,
`src-tauri/src/vinted.rs`, `src/app/stores/publish-store.ts` (+ test), `src/features/publish/
{PostButton.tsx, PublishPanel.tsx, TermsDialog.tsx}`, `src/features/settings/PublishSection.tsx`.

Changed: `project.ts`/`migrations.ts` (`favorites → toPost`, schema v2), `projects-store.ts`,
`ui-store.ts` (filter), `VariationTile.tsx`, `Lightbox.tsx`, `GenerationFeed.tsx`, `SourcePanel.tsx`,
`WorkspaceView.tsx`, `settings.ts` (`vintedAutomationAcknowledged`), `errors.ts` (new code
`PLATFORM_UNSUPPORTED`, not retryable), `services.ts`, `i18n/en.ts`,
`i18n/fr.ts`, `src-tauri/src/lib.rs` (commands), `capabilities/default.json`, `package.json`
(`build:prefill`), CI (prefill freshness via tests), docs listed in §6, CHANGELOG.

## 8. Tests

- Domain: `canPost` reasons, `orderedPhotoIds`, URL classifiers, migration v1→v2 (favourites kept
  as `toPost`, idempotent).
- Script (jsdom fixture reproducing a React-style controlled form with an `<input type=file>` and
  thumbnail container): fills title/description, fallback selector used when the first is missing,
  `not_found` on missing field, photos attached count, no submit clicked, bundle freshness.
- Store: stage machine from page events, `fill()` polling and 20 s timeout, unsupported bridge →
  `PLATFORM_UNSUPPORTED`, acknowledgement gate.
- Rust (`#[cfg(test)]`): `allowed_navigation`, `ALLOWED_PATHS`, payload validation limits.
- Manual (DEVELOPMENT.md checklist): real login, form pre-fill, window close mid-flow, session
  clearing, second launch keeps the session.

## 9. Open points for later phases

- Extended fillers (condition, brand, colour), category mapping to Vinted's taxonomy, price entry.
- Mobile plugin (native WebView with script injection) implementing `PublishBridge`.
- Detecting a successful publication (URL of the new item) to mark the project as posted.
