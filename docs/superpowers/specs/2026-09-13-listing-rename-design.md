# Project → Listing rename, and an English-identifiers lint rule — design

Approved in chat on 2026-09-13 (full code rename chosen over labels-only).

## 1. Goal

The product sells one thing: a **listing** (an item photographed, described and posted). The code still calls it a
_project_ — a leftover of the generic image-variations workspace. Everything follows: labels, identifiers, routes,
storage, docs. At the same time a lint rule guarantees identifiers stay English (French is for prose and labels).

## 2. The naming collision, resolved

`listing` already names the _category / photo pack / copy_ machinery. Both cannot be "listing". Final vocabulary:

| Today                                                                            | After                                                                                            |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `Project`, `ProjectDocument`, `ProjectSummary`                                   | `Listing`, `ListingDocument`, `ListingSummary`                                                   |
| `ProjectDocument.project`                                                        | `ListingDocument.listing`                                                                        |
| `projectId` (generations, jobs, images, publish session, run report)             | `listingId`                                                                                      |
| `useProjectsStore` / `projects-store.ts`                                         | `useListingsStore` / `listings-store.ts`                                                         |
| `StorageProvider.listProjects/getProject/saveProject/deleteProject`              | `listListings/getListing/saveListing/deleteListing`                                              |
| `migrateProjectDocument`                                                         | `migrateListingDocument`                                                                         |
| `features/projects/` (`Sidebar`, `ProjectCard`)                                  | `features/listings/` (`Sidebar`, `ListingCard`); `ProjectTitle` → `ListingTitle`                 |
| route `#/project/:id`                                                            | `#/listing/:id` (old hash still parsed, so bookmarks keep working)                               |
| i18n `nav.projects`, `projects.*`, `nav.newProject`                              | `nav.listings`, `listings.*`, `nav.newListing` — EN "Listing(s)", FR "Annonce(s)"                |
| `Project.listing: ListingSelection`                                              | `Listing.category: CategorySelection`                                                            |
| `Generation.listing`                                                             | `Generation.category`                                                                            |
| `ListingSelection`, `ListingCategory`, `ListingSubcategory`, `ListingCategoryId` | `CategorySelection`, `Category`, `Subcategory`, `CategoryId`                                     |
| `LISTING_CATEGORIES`, `listing-catalog.ts`, `buildListingShots`                  | `CATEGORIES`, `catalog.ts`, `buildShots`                                                         |
| `listingRecipeId`, `listingSelectionFromRecipeId`                                | `catalogRecipeId`, `categorySelectionFromRecipeId`                                               |
| `useListingStore` / `listing-store.ts`                                           | `useListingSetupStore` / `listing-setup-store.ts` (the current listing's setup + generation run) |
| `setListing`, `createListing`, `cancelListing`, `CreateListingOptions`           | `setCategory`, `generateListing`, `cancelListingRun`, `GenerateListingOptions`                   |

Kept as they are (they read correctly next to `Listing`): `ListingCopy*`, `listing-copy.ts`, `ListingSetupCard`,
`ListingCopyPanel`, `listingReadiness`, `ListingRunReport`, i18n `listing.*` (the setup card), the Google Cloud
`GoogleCloudProject` / OAuth `projectId` (a different, real "project").

## 3. Storage

- **Document schema v3** (`CURRENT_SCHEMA_VERSION = 3`, `migrations.ts`): `{ project, … }` → `{ listing, … }`;
  `project.listing` → `listing.category`; every `projectId` → `listingId` (listing, images, generations, jobs);
  `generation.listing` → `generation.category`. Pure function, unit-tested on a v2 fixture.
- **IndexedDB** (`IndexedDbStorage`): `DB_VERSION` 1 → 2. The upgrade creates `listings` (keyPath `listing.id`),
  copies every record of `projects` through the document migration, deletes `projects`. The `images` store keeps
  its key layout (`<listingId>/<kind>/<assetId>`); only the index/field names change. Tested with fake-indexeddb
  by opening a v1 database, writing a v2 document, reopening with the new class.
- **Tauri fs** (`TauriFsStorage`): layout `listings/<id>/listing.json`. `init()` migrates once: if `projects/`
  exists and `listings/` does not, rename the directory, then rename each `project.json` to `listing.json`; the
  JSON content is migrated by `migrateListingDocument` on read (as today). `fs:allow-rename` is already granted —
  no new permission. Tested with the in-memory fs fake of the existing tests.
- `assertSafeId` keeps guarding every path segment.

## 4. Lint rule `no-french-identifiers`

`tools/eslint-rules/no-french-identifiers.js` (ESM, ESLint 9 flat config), ported from the sibling project and
rewritten with English identifiers. Detection is by whole word of the split identifier against a list of French
roots + common endings — never substring — so `iconPath` or `stepEnd` cannot trigger. Roots: the original list
plus this domain's temptations (`annonce`, `projet`, `categorie`, `marque`, `modele`, `texte`, `titre`,
`vendeur`, `publier`, `generer`, `utilisateur`, `photo` is English and stays out). Declarations only
(variables, functions, classes, interfaces, types, enums, class members). Registered in `eslint.config.js` as a
local plugin, `error` level, for `src/**` and `tools/**`. Unit-tested with `RuleTester` (vitest). Documented in
`.claude/skills/code-conventions` and DEVELOPMENT.md.

## 5. Out of scope

Rust (`src-tauri`) has no "project" identifier; the bundle id and app data directory name are unchanged. The
generic `GenerationQueue`, recipes and gallery vocabulary do not change.

## 6. Tests and verification

Every renamed test follows its module. New tests: v3 migration, IndexedDB v1→v2 upgrade, Tauri fs directory
migration, router backward compatibility, lint rule. `grep -rn "project" src` afterwards must only hit the Google
Cloud project and prose. `pnpm check` and `pnpm build` green; the web app opened on a database created before the
change shows the same listings.
