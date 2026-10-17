# Privacy

> This page describes the account version of AI Image Variations. The hosting provider and location and the privacy contact are filled in by the owner before the public launch (marked **[to complete]**). The earlier local-first release, where nothing left your device but provider calls, is kept on the `byok` branch with its own privacy page.

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

**Sub-processors**: the hosting provider and the backup storage provider (**[to complete]**, both receive only encrypted backups beyond the running service), Cloudflare (image generation), Google (text generation), Resend (email).

## Analytics, ads, tracking

- No analytics, no crash reporting, no third-party telemetry, in the apps or on the server. Server logs stay on our server.
- No ad SDK is integrated. If ads are introduced in a future free tier, they will be isolated behind an `AdProvider` abstraction that never receives images, prompts or generation data, and they will never be displayed over images or during generation.
- No fingerprinting.

## Your choices and rights

- **Delete a photo or a photo pack**: removed from the server at once (never from Vinted).
- **Export a listing** (the ⋯ menu → Export): a ZIP with the listing's data (`listing.json`), its title and description (`listing.txt`), your original photo and the generated photos. The archive is built on request and not kept.
- **Delete a listing**: removes it, its photos and its packs from the server.
- **Sign out**: removes the session from the device; the app shows nothing of the account afterwards.
- **Delete your account** (Settings → Account, confirmed by a link sent to your email): removes your account, listings, photos, packs, credits history and settings from the server.
- **Import from this device**: optional and offered once; it copies each listing of the local-first release (original photo, name, category, brand, mannequin choice, texts) into your account. Generated photos are not copied; the device keeps its copy.
- **Settings → Publishing → Log out of Vinted**: erases the Vinted cookies and storage kept by the app on this device. Your Vinted login happens on Vinted's pages; the app never sees your Vinted credentials.
- **Credentials of the local-first release** (provider API keys, Google tokens) left on the device are deleted by the app at startup.

## How long we keep things

| What                                                                    | How long                                                                                                                                                                                                                |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Listings, photos, packs, credit history, settings                       | Until you delete them or delete your account                                                                                                                                                                            |
| An account whose email was never verified                               | Deleted automatically after 7 days, with anything it uploaded                                                                                                                                                           |
| Server logs (requests, errors; no photos, prompts, passwords or tokens) | Rotated by size (the last ~50 MB per service, a few days of activity)                                                                                                                                                   |
| Encrypted backups (database and photos) at a second provider            | Daily backups for 7 days, one a week for 4 weeks, one a month for 6 months. Deleted data therefore leaves the backups within about 6 months; backups are encrypted and used only to restore the service after a failure |

## Hosting and contact

- **Host and region**: **[to complete]** (a server in the EU). **Backup storage**: **[to complete]**, another provider, EU.
- **Privacy contact**: **[to complete]**. Requests for access, correction or deletion that you cannot make yourself in the app are answered through this address.
