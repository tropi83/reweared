---
name: security-review
description: Use before and after touching credentials, storage, network, Tauri permissions, CSP, file import/export, Rust commands, or anything of the backend (accounts, sessions, provider keys on the server, uploads, credits, Docker) — the threat-model checklists for the client (API-only, Tauri) and for the server (ADR 0001), and the verification commands to run.
---

# Security review

Two threat models ([ADR 0001](../../../docs/adr/0001-backend-accounts-platform-keys.md)): the **client** rules below bind `src/` and `src-tauri/` (the app talks to our API only; the local BYOK mode lives on the `byok` branch); the **server** rules bind `apps/server`, `packages/*` and the Docker stack. `SECURITY.md` describes both.

## Client — golden rules

1. Credentials never appear in: logs, diagnostics, toasts, error `detail`, test fixtures, screenshots, commits, URLs. The client holds no provider key at all.
2. Desktop: the session token goes through `secret_set/get/delete` (OS keychain, closed key list = `session_token` only, in `secrets.rs` mirrored by `SecretStore.ts`). Web: httpOnly cookie, nothing in web storage (`SecretStore` purges legacy keys).
3. The only outbound host is the API origin (`ApiClient`, `/api/` paths) = Tauri `http` scope (generated patch) ∩ CSP `connect-src`. Adding another one means updating both **and** SECURITY.md.
4. The webview cannot name arbitrary files: ids pass `assertSafeId`, the fs scope is `$APPDATA/**`; dialog-picked paths are the only exception.
5. Imported files: size cap (`MAX_IMPORT_BYTES`), magic-byte sniffing (`sniffMimeType`), decoding via `createImageBitmap` only.
6. New Rust command ⇒ minimal surface, `Result<_, String>`, allowlisted inputs, registered in `generate_handler!`, documented in SECURITY.md.
7. No new Tauri plugin "just in case". Justify every permission line.

8. vinted.com never gets IPC, the injected script never clicks submit and never reads cookies or storage (SECURITY.md → Vinted window).

## Server — golden rules (from phase 1)

1. **Provider keys only in the worker**, as Docker secrets (`/run/secrets/*`); never in Postgres, `.env`, image layers, logs, error bodies, Bull Board or crash reports. The api holds no provider key.
2. **Authorization on every query**: repositories take the session user; another user's resource answers 404 (not 403). Tested per route.
3. **Sessions**: web = httpOnly + `Secure` + `SameSite=Lax` cookie and an Origin check on state-changing requests; Tauri = bearer token in the OS keychain. Passwords hashed by Better Auth (scrypt); rate limits on sign-in, sign-up, reset; email verification before the first generation.
4. **Uploads**: size cap, magic-byte sniffing, sharp re-encode that strips EXIF/GPS, private bucket, bytes streamed by the api (never a public or presigned storage URL), object keys from `assertSafeId`-checked ids only.
5. **Money-like state**: credits change only through the ledger with idempotency keys; `CHECK (balance >= 0)`; no endpoint lets a client set a balance.
6. **Egress**: the worker contacts allowlisted provider hosts only; the api contacts Resend only. A new host updates the allowlist, `SECURITY.md` and the `PRIVACY.md` sub-processor list.
7. **Containers**: only Caddy publishes ports; non-root users, read-only root fs, no Docker socket mounted, Postgres/Redis/SeaweedFS on the internal network with their own credentials (Docker secrets).
8. **Personal data**: account deletion removes DB rows and the user's S3 prefix; logs carry user ids, never emails in full, prompts, images, tokens or verification links.

## Checklist for a change

- [ ] New network destination? (client rule 3 / server rule 6)
- [ ] Stores anything new on the device? Where? Is it a secret? (rule 2)
- [ ] Can user input reach a path, a URL, a shell, or `innerHTML`? (`dangerouslySetInnerHTML` is banned in this repo)
- [ ] Errors mapped to `GenerationErrorCode` with a user-safe message?
- [ ] Cancelled/failed jobs guaranteed not to persist partial results?
- [ ] Temporary payloads (base64, prepared blobs) dropped after use?
- [ ] Server: route scoped by the session user? rate-limited? body validated with zod? credits through the ledger? secret reachable from the api container?

## Verify

```bash
pnpm test                                   # includes redaction, allowlist and id-safety tests
pnpm exec eslint src
cd src-tauri && cargo clippy -- -D warnings
# Must print nothing (real-looking secrets outside tests):
grep -rn "AIza[0-9A-Za-z_-]\{20,\}\|ya29\.\|1//0" src src-tauri --include=*.ts --include=*.tsx --include=*.rs | grep -v "\.test\."
```

Manual: Settings → Diagnostics → Copy → confirm no key/token in the output.

Server: `pnpm test:integration` (cross-user 404 on every route, origin check, rate limits, deletion by emailed link, EXIF stripping), `pnpm smoke:server` against `pnpm stack:up`, then `docker compose logs api` searched for emails, tokens and cookies (there must be none), `docker compose -f compose.yaml config --format json | node scripts/check-compose.mjs` (provider keys on the worker only), and `docker compose -f compose.yaml config` reviewed: only Caddy publishes ports, no secret value inlined, `BETTER_AUTH_TELEMETRY: "0"`.
