# Privacy

## Where your data lives

```
Your device
   ├── projects (names, timestamps)
   ├── images (originals, generated results, thumbnails)
   ├── prompts and recipes
   ├── history (generations, jobs, parameters, errors)
   ├── Vinted session (desktop: vinted.com cookies/storage in an isolated profile)
   └── settings
```

Desktop and mobile: the application data directory of your OS (shown in Settings → Storage). Web: the browser's IndexedDB for this site's origin. There is no AI Image Variations account and no AI Image Variations server.

## What leaves your device, and when

| Data                                                                        | Sent to                                             | When                                                                                                                                                           |
| --------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The source image (downscaled copy, original untouched) and your prompt      | Google Gemini (`generativelanguage.googleapis.com`) | Only when you press **Generate** (or Retry / Generate again)                                                                                                   |
| Your credential (API key header or OAuth bearer token)                      | Google                                              | With every Gemini request, and for "Test connection"                                                                                                           |
| OAuth authorization code / refresh token                                    | Google's OAuth endpoints                            | During sign-in, token refresh and disconnect                                                                                                                   |
| The photos marked “To post” (JPEG ≤ 2048 px), the title and the description | Vinted, inside the Vinted window (desktop)          | Only when you press **Fill** in the publication panel; Vinted's own page then uploads the attached photos. Nothing is published until you click Vinted's “Add” |
| Nothing else                                                                | —                                                   | —                                                                                                                                                              |

Nothing is uploaded automatically. Opening a project, browsing the gallery, exporting, or editing prompts never triggers a network request.

## Google's role

Generations are processed by Google under Google's terms. This app sends requests with `store: false` (Google's Interactions API option not to retain the interaction for later multi-turn use); Google's own data-handling policies for the Gemini API still apply and depend on your account/project type. Check Google's documentation for your plan.

## Analytics, ads, tracking

- No analytics, no crash reporting, no telemetry in this version.
- No ad SDK is integrated. If ads are introduced in a future free tier, they will be isolated behind an `AdProvider` abstraction that never receives images, prompts or generation data, and they will never be displayed over images or during generation.
- No fingerprinting, no identifiers beyond what your browser/OS already provides to the sites you use.

## Deleting data

- Delete a project: removes its `project.json` and all of its image files.
- Settings → Storage → _Delete all local data_: removes every project, image, recipe, setting and stored credential on this device.
- Disconnect Google: the token is revoked at Google and removed from the credential store.
- Settings → Publishing → _Log out of Vinted_: erases the Vinted cookies and storage kept in `vinted-webview/` inside the app data folder (a dedicated WebKit data store on macOS 14+). Your Vinted login itself happens on Vinted's pages; the app never sees your Vinted credentials.

Your data belongs to you. Files are stored in standard formats (JSON, PNG/JPEG/WebP) so they remain usable without this application.
