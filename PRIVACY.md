# Privacy

> **Planned change ([ADR 0001](docs/adr/0001-backend-accounts-platform-keys.md)):** the app is moving to user accounts and a server that stores listings and runs generations. This page describes the **current, local-first release**; what will change is summarized in [Planned: accounts and server](#planned-accounts-and-server-adr-0001), and this page will be rewritten before that release ships.

## Where your data lives

```
Your device
   ├── listings (names, category, brand, timestamps, title & description)
   ├── images (originals, generated results, thumbnails)
   ├── prompts, recipes and your mannequin settings
   ├── history (generations, jobs, parameters, errors)
   ├── local usage counters (requests per provider and model)
   ├── Vinted session (vinted.com cookies/storage in an isolated profile — desktop window or phone screen)
   └── settings
```

Desktop and mobile: the application data directory of your OS (shown in Settings → Storage). Web: the browser's IndexedDB for this site's origin. There is no AI Image Variations account and no AI Image Variations server in this release.

## What leaves your device, and when

| Data                                                                                      | Sent to                                                                                                | When                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The source photo (resized copy, original untouched) and the shot prompts                  | The image provider you configured: Cloudflare Workers AI (`api.cloudflare.com` or **your own** Worker) | Only when you press **Create the listing**, **Generate this photo again** or Retry                                                                                     |
| The original photo (resized copy), the category and the brand you typed                   | The text provider you configured: Google Gemini (`generativelanguage.googleapis.com`) or Cloudflare    | Only when the listing's title and description are generated (**Create the listing**, **Regenerate text**)                                                              |
| Your credential (Gemini API key or OAuth bearer token, Cloudflare token or Worker secret) | The provider it belongs to                                                                             | With every request to that provider, and for "Test connection"                                                                                                         |
| OAuth authorization code / refresh token                                                  | Google's OAuth endpoints                                                                               | During sign-in, token refresh and disconnect (desktop)                                                                                                                 |
| The photos marked “To post” (JPEG ≤ 2048 px), the title and the description               | Vinted, inside the Vinted window (desktop) or the Vinted screen (phones)                               | Only when you post on Vinted; the photos are attached by the pre-fill, the text only when you tap the paste icons. Nothing is published until you click Vinted's “Add” |
| Nothing else                                                                              | —                                                                                                      | —                                                                                                                                                                      |

Nothing is uploaded automatically. Opening a listing, browsing the gallery, exporting, or editing prompts never sends your images anywhere. The model lists and the connection status of a provider are read from that provider with your credential.

## Providers' role

Generations and listing copy are processed by the provider you chose, under its terms and with your own account: Cloudflare (Workers AI) and/or Google (Gemini API). Gemini requests are sent with `store: false` (the Interactions API option not to retain the interaction for later multi-turn use); each provider's own data-handling policies still apply and depend on your account or plan. Check their documentation.

## Analytics, ads, tracking

- No analytics, no crash reporting, no telemetry in this version.
- No ad SDK is integrated. If ads are introduced in a future free tier, they will be isolated behind an `AdProvider` abstraction that never receives images, prompts or generation data, and they will never be displayed over images or during generation.
- No fingerprinting, no identifiers beyond what your browser/OS already provides to the sites you use.

## Deleting data

- Delete a listing: removes its `listing.json` and all of its image files, on this device only (never on Vinted).
- Settings → Storage → _Delete all local data_: removes every listing, image, recipe, setting and stored credential on this device.
- Disconnect Google: the token is revoked at Google and removed from the credential store.
- Settings → Publishing → _Log out of Vinted_: erases the Vinted cookies and storage kept by the app (`vinted-webview/` in the app data folder, a dedicated WebKit data store on macOS 14+ / iOS 17+, the dedicated WebView profile on Android). Your Vinted login itself happens on Vinted's pages; the app never sees your Vinted credentials.

Your data belongs to you. Files are stored in standard formats (JSON, PNG/JPEG/WebP) so they remain usable without this application.

## Planned: accounts and server (ADR 0001)

Not implemented yet. When it ships, this page will say, in plain language:

- **What we store** on our server (hosted in the EU — to be confirmed): your account (email, hashed password or Google identity), your listings, photos and generated images, your credit balance and its history, and server logs (without photos, prompts or passwords).
- **Who processes it for us** (sub-processors): the image and text providers (Cloudflare, Google), the email service (Resend) and the hosting provider. Photos are sent to a provider only for a generation you start.
- **What changes for you**: no API key to set up; listings follow your account across devices; generation needs the network.
- **Your rights**: export of your listings, deletion of your account (database records and stored images), retention periods, and the contact for privacy requests.
- **What the server already does with photos** (phase 1, not yet used by the apps): location (GPS) and camera metadata are removed from every uploaded photo before it is stored; photos are private to their account and never published through a public link; deleting the account requires confirming a link sent by email and removes the photos.
- **What does not change**: no third-party analytics or ad tracking; the Vinted pre-fill still runs on your device and never publishes for you.
