# Privacy

> This page describes the account version of AI Image Variations. The hosting location, the retention periods and the privacy contact are completed before the public launch (backend phase 4). The earlier local-first release, where nothing left your device but provider calls, is kept on the `byok` branch with its own privacy page.

## What we store, and where

```
Our server (private to your account)
   ├── your account: email address, password (hashed, never in clear text), email verification and sessions
   ├── listings: name, category, brand, mannequin choice, title & description, "to post" marks
   ├── photos: your originals (location and camera metadata removed at upload), generated photos, thumbnails
   ├── photo packs and text runs: which shots, their status, errors (prompts stay on the server)
   ├── credits: balance and every movement (monthly grant, run, refund)
   ├── settings shared by your devices: language, theme, mannequin, Vinted warning acknowledged, default format
   └── server logs: requests (method, path, address), errors — never photos, prompts, passwords or tokens

Your device
   ├── your session: an httpOnly cookie (web) or a session token in the system keychain (desktop; in memory on phones)
   ├── the device's copy of its settings (theme, language)
   ├── the Vinted session (vinted.com cookies/storage in an isolated profile — desktop window or phone screen)
   └── listings of the local-first release, if you used it: read once to offer the import, never sent without you
```

Photos are stored in a private bucket and only ever served to your signed-in account — never through a public or shareable link.

## Who your data is sent to, and when

| Data                                                                                      | Sent to                                                                                    | When                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Your photo (to your account)                                                              | our server                                                                                 | When you create a listing from a photo                                                                                                                                 |
| A resized copy of the listing's photo and the shot prompts                                | the platform's image provider (Cloudflare Workers AI), by our server                       | Only when you press **Create the listing**, **Generate this photo again**, **Generate again** or Retry                                                                 |
| A resized copy of the original photo, the category and the brand you typed                | the platform's text provider (Google Gemini), by our server                                | Only when the title and description are written (**Create the listing**, **Regenerate text**)                                                                          |
| Your email address and the links we send (verification, password reset, account deletion) | our email service (Resend)                                                                 | When you sign up, ask for a new password or ask to delete the account                                                                                                  |
| The photos marked "To post" (JPEG ≤ 2048 px), the title and the description               | Vinted, inside the Vinted window (desktop) or the Vinted screen (phones), from your device | Only when you post on Vinted; the photos are attached by the pre-fill, the text only when you tap the paste icons. Nothing is published until you click Vinted's "Add" |
| Nothing else                                                                              | —                                                                                          | —                                                                                                                                                                      |

The providers process these requests under the platform's accounts and their terms (Cloudflare Workers AI, Google Gemini API; Gemini requests are sent with `store: false`). Generated photos come back to our server, are re-encoded without metadata and stored with your listing.

**Sub-processors**: the hosting provider (to be named before launch), Cloudflare (image generation), Google (text generation), Resend (email).

## Analytics, ads, tracking

- No analytics, no crash reporting, no third-party telemetry, in the apps or on the server. Server logs stay on our server.
- No ad SDK is integrated. If ads are introduced in a future free tier, they will be isolated behind an `AdProvider` abstraction that never receives images, prompts or generation data, and they will never be displayed over images or during generation.
- No fingerprinting.

## Your choices and rights

- **Delete a photo or a photo pack**: removed from the server at once (never from Vinted).
- **Delete a listing**: removes it, its photos and its packs from the server.
- **Sign out**: removes the session from the device; the app shows nothing of the account afterwards.
- **Delete your account** (Settings → Account, confirmed by a link sent to your email): removes your account, listings, photos, packs, credits history and settings from the server.
- **Import from this device**: optional and offered once; it copies each listing of the local-first release (original photo, name, category, brand, mannequin choice, texts) into your account. Generated photos are not copied; the device keeps its copy.
- **Settings → Publishing → Log out of Vinted**: erases the Vinted cookies and storage kept by the app on this device. Your Vinted login happens on Vinted's pages; the app never sees your Vinted credentials.
- **Credentials of the local-first release** (provider API keys, Google tokens) left on the device are deleted by the app at startup.
- **To come before launch**: export of a listing (ZIP with its photos and texts), the retention periods (for example, accounts never verified are deleted after 7 days) and the contact for privacy requests.
