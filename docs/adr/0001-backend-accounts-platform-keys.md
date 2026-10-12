# ADR 0001 — Backend with user accounts, platform provider keys and a server-side job queue

- **Status:** Accepted — 2026-10-11
- **Deciders:** project owner
- **Design:** [`docs/superpowers/specs/2026-10-11-backend-queue-accounts-design.md`](../superpowers/specs/2026-10-11-backend-queue-accounts-design.md)
- **Plans:** [phase 0](../superpowers/plans/2026-10-11-backend-phase-0.md) (later phases get their own plan)

## Context

AI Image Variations shipped as a **local-first, bring-your-own-key** app: no account, no server, listings and
images on the device, provider credentials (Gemini API key / Google OAuth, Cloudflare token or the user's own
Worker) in the OS keychain, every request sent from the device straight to the provider.

That model has costs for a second-hand seller, who is not a developer:

- Setting up a Cloudflare account, a Worker or a Google Cloud project is the main reason people give up.
- Gemini image models have no free tier, so the best models are out of reach for most users.
- Generation runs on the device: closing the laptop or switching from phone to desktop loses the run; a listing
  created on the phone is not on the desktop.
- There is no way to share a provider budget fairly, to offer a free plan, or to sell usage.

## Decision

We build a backend and make it the source of truth (full decision table in the design, §0):

| Topic          | Decision                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider keys  | Owned by the platform, held by the server's worker only (Docker secrets). Users never enter a key.                                           |
| Data           | Postgres + S3-compatible object storage (SeaweedFS; MinIO until the 2026-10-11 amendment) are the source of truth; web and Tauri are clients |
| Language       | TypeScript / Node 22 in a pnpm workspace that shares the pure domain (`packages/domain`)                                                     |
| Accounts       | Built-in auth (Better Auth): email + password (Better Auth default hashing), email verification, Google Sign-In                              |
| Email          | Resend                                                                                                                                       |
| Consumption    | Credit ledger with a free monthly plan; credits reserved at enqueue, refunded on failure                                                     |
| Queue          | BullMQ + Redis for dispatch, Postgres for job state; per-user cap for fairness; reconciler                                                   |
| Progress       | Server-Sent Events                                                                                                                           |
| Hosting        | One VPS with `docker compose` behind Caddy                                                                                                   |
| Image provider | Open: Cloudflare Workers AI by default; the existing Gemini adapter can be re-enabled server-side                                            |

## Superseded rules

These rules stay in force **for the shipped client until phase 3** (the client switch); they are replaced by
the server rules of the design afterwards. Every document that states them now says so.

| Rule                                                                              | Where                                                         |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| "No proprietary backend"; "Requests go from the user's device straight to Google" | `CLAUDE.md`, `ARCHITECTURE.md` §Principles, `CONTRIBUTING.md` |
| "Images leave the device only on Generate, directly to the configured provider"   | `CLAUDE.md`, `PRIVACY.md`                                     |
| "No account, no backend, no cloud"; "Never add a proxy of ours"; BYOK             | `.claude/skills/project-context`, `README.md`                 |
| Out of scope: accounts, cloud sync, backend                                       | `.claude/skills/project-context`                              |
| Local-first query defaults (no refetch because a window was focused)              | `.claude/skills/tanstack-query` (revisited in phase 3)        |

Rules that do **not** change: credentials are never logged or displayed in clear text (now also server-side),
minimum Tauri permissions, the Vinted pre-fill never publishes and stays on the device, never send a parameter
a model does not support, verify Google / Cloudflare / Tauri docs before changing an integration, all
user-facing text through i18n, CI never needs a provider account.

## Consequences

Positive

- Sign up and generate: no provider setup for users.
- Runs survive closing the app; listings follow the account across devices.
- One place to enforce provider rate limits, fairness between users and a budget.
- A business model becomes possible (free plan, paid credits later through Stripe).

Negative / to manage

- Hosting, backups and on-call become ours; the app needs the network to generate.
- We become the **data controller** for accounts, photos and listings (GDPR: privacy policy, account deletion,
  export, retention, DPAs with sub-processors — Cloudflare, Google, Resend, the VPS host).
- Free credits attract abuse: email verification before the first generation, rate limits, budget guard.
- Provider costs are ours: credit pricing must be measured against real neuron / token costs (phase 2).
- Two architectures coexist during phases 0–3; documents mark which one they describe.

## Phases

| Phase | Content                                                                                        |
| ----- | ---------------------------------------------------------------------------------------------- |
| 0     | This ADR, documentation, pnpm workspace, extraction of `packages/domain` (no behaviour change) |
| 1     | Docker compose stack, API: auth, listings, uploads, object storage                             |
| 2     | Worker, queues, dispatcher, reconciler, credits, SSE, server-side providers                    |
| 3     | Web and Tauri clients switch to the API; import of local listings                              |
| 4     | Production VPS: secrets, backups, monitoring, release of server images                         |
