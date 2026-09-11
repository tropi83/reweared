---
name: security-review
description: Use before and after touching credentials, storage, network, Tauri permissions, CSP, file import/export, or Rust commands — the threat-model checklist specific to this app (BYOK, local-first, Tauri) and the verification commands to run.
---

# Security review

## Golden rules

1. Credentials never appear in: logs, diagnostics, toasts, error `detail`, test fixtures, screenshots, commits, URLs.
2. Desktop secrets go through `secret_set/get/delete` (OS keychain). Web: memory by default; localStorage only after the disclaimer (`settings.webCredentialDisclaimerAccepted`).
3. Outbound hosts = `ALLOWED_HOSTS` (http-client.ts) ∩ Tauri `http` scope ∩ CSP `connect-src`. Adding one means updating all three **and** SECURITY.md.
4. The webview cannot name arbitrary files: ids pass `assertSafeId`, the fs scope is `$APPDATA/**`; dialog-picked paths are the only exception.
5. Imported files: size cap (`MAX_IMPORT_BYTES`), magic-byte sniffing (`sniffMimeType`), decoding via `createImageBitmap` only.
6. New Rust command ⇒ minimal surface, `Result<_, String>`, allowlisted inputs, registered in `generate_handler!`, documented in SECURITY.md.
7. No new Tauri plugin "just in case". Justify every permission line.

## Checklist for a change

- [ ] New network destination? (rule 3)
- [ ] Stores anything new? Where? Is it a secret? (rule 2)
- [ ] Can user input reach a path, a URL, a shell, or `innerHTML`? (`dangerouslySetInnerHTML` is banned in this repo)
- [ ] Errors mapped to `GenerationErrorCode` with a user-safe message?
- [ ] Cancelled/failed jobs guaranteed not to persist partial results?
- [ ] Temporary payloads (base64, prepared blobs) dropped after use?
- [ ] OAuth still PKCE S256 + `state` check + loopback on 127.0.0.1 only?

## Verify

```bash
pnpm test                                   # includes redaction, allowlist and id-safety tests
pnpm exec eslint src
cd src-tauri && cargo clippy -- -D warnings
# Must print nothing (real-looking secrets outside tests):
grep -rn "AIza[0-9A-Za-z_-]\{20,\}\|ya29\.\|1//0" src src-tauri --include=*.ts --include=*.tsx --include=*.rs | grep -v "\.test\."
```

Manual: Settings → Diagnostics → Copy → confirm no key/token in the output.
