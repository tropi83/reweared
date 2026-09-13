# Building

How to run and package AI Image Variations on every platform: desktop (Windows, macOS, Linux/Debian), Android and iOS.

Checked on 2026-09-12 against the Tauri 2 documentation (`v2.tauri.app`: prerequisites, develop, distribute, config reference) and the CLI help of `@tauri-apps/cli` 2.11.4. From this repository, on Windows 11: the desktop installers were built, and the Android Rust library was compiled for `aarch64` (the APK step then needs Developer Mode, §3.1). **The macOS and Linux bundles and iOS have not been built from this repository yet** — follow the steps and report anything that differs.

- [Quick reference](#quick-reference)
- [What runs where](#what-runs-where)
- [Versions](#versions)
- [1. Common setup](#1-common-setup)
- [2. Desktop](#2-desktop) — [Windows](#21-windows-exe--msi) · [macOS](#22-macos-app--dmg) · [Linux (Debian/Ubuntu)](#23-linux--debian--ubuntu-deb--appimage--rpm) · [CI releases](#24-release-builds-in-ci)
- [3. Android](#3-android-from-windows-macos-or-linux)
- [4. iOS](#4-ios-macos-only)
- [5. Signing material and secrets](#5-signing-material-and-secrets)
- [6. Known warning: identifier ends with `.app`](#6-known-warning-identifier-ends-with-app)

## Quick reference

| Goal                             | Command                                                  | Build host            |
| -------------------------------- | -------------------------------------------------------- | --------------------- |
| Check the desktop toolchain      | `pnpm tauri info`                                        | any                   |
| Desktop app with hot reload      | `pnpm tauri dev`                                         | Windows, macOS, Linux |
| Desktop installers for this OS   | `pnpm tauri build`                                       | Windows, macOS, Linux |
| Windows `.exe` only              | `pnpm tauri build --bundles nsis`                        | Windows               |
| macOS universal `.app` + `.dmg`  | `pnpm tauri build --target universal-apple-darwin`       | macOS                 |
| Check the Android toolchain      | `pnpm android:doctor`                                    | Windows, macOS, Linux |
| Android on a phone, hot reload   | `pnpm android:dev`                                       | Windows, macOS, Linux |
| Android debug APK                | `pnpm android:apk`                                       | Windows, macOS, Linux |
| Android release bundle (Play)    | `pnpm tauri android build --aab`                         | Windows, macOS, Linux |
| Check the iOS toolchain          | `pnpm ios:doctor`                                        | macOS                 |
| iOS simulator/device, hot reload | `pnpm ios:dev`                                           | macOS                 |
| iOS App Store build              | `pnpm tauri ios build --export-method app-store-connect` | macOS                 |

Always go through the project's pinned CLI (`pnpm tauri …`). A globally installed `cargo tauri` may be older — `pnpm tauri info` reports it as outdated; do not use it for this repository.

## What runs where

|                   | Windows               | macOS                             | Linux (Debian/Ubuntu)                   | Android                 | iOS                    |
| ----------------- | --------------------- | --------------------------------- | --------------------------------------- | ----------------------- | ---------------------- |
| Build on          | Windows               | macOS                             | Linux                                   | Windows, macOS or Linux | macOS only             |
| Package           | `.exe` (NSIS), `.msi` | `.app`, `.dmg`                    | `.deb`, `.rpm`, `.AppImage`             | `.apk`, `.aab`          | `.ipa`                 |
| Saved credentials | Credential Manager    | Keychain                          | Secret Service (GNOME Keyring, KWallet) | session only (planned)  | session only (planned) |
| Google sign-in    | yes                   | yes                               | yes                                     | no — API key            | no — API key           |
| Post on Vinted    | yes                   | yes (isolated profile: macOS 14+) | yes                                     | no (button disabled)    | no (button disabled)   |

Desktop bundles are built on their own OS: `.msi` needs WiX (Windows only) and macOS bundles need macOS. The release workflow builds each OS on its own runner (§2.4).

## Versions

| Tool            | Required                                                                                                   | Verified with (Windows 11 25H2)            |
| --------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Node.js         | ≥ 22 (`engines`)                                                                                           | 24.11.0                                    |
| pnpm            | 10 (`packageManager: pnpm@10.23.0`; `corepack enable` installs it)                                         | 10.23.0                                    |
| Rust            | ≥ 1.88 (`rust-version`), stable toolchain                                                                  | 1.93.0 (`stable-x86_64-pc-windows-msvc`)   |
| Tauri           | crate 2.11.5, CLI `@tauri-apps/cli` 2.11.4                                                                 | same                                       |
| Windows         | 10 (1803+) or 11 — WebView2 is preinstalled, the installer fetches it otherwise                            | WebView2 152, Visual Studio 2026 C++ tools |
| macOS           | 10.13+ to run (Tauri default `bundle > macOS > minimumSystemVersion`); 14+ for the isolated Vinted profile | not built yet                              |
| Linux           | WebKitGTK 4.1 — Ubuntu 22.04 / Debian 12 or newer                                                          | not built yet (CI: ubuntu-22.04)           |
| Android JDK     | 17                                                                                                         | Microsoft OpenJDK 17.0.17                  |
| Android SDK     | platform 36 (`compileSdk`/`targetSdk` 36), Build-Tools, Platform-Tools, Command-line Tools                 | platforms 31 + 36, Build-Tools 35 – 36.1   |
| Android NDK     | any current NDK (Side by side)                                                                             | 27.1.12297006                              |
| Android build   | Gradle 8.14.3 (wrapper), AGP 8.11.0, Kotlin 1.9.25 — from `src-tauri/gen/android`                          | same                                       |
| Android devices | API 24+ / Android 7.0+ (`bundle > android > minSdkVersion`, default 24)                                    | —                                          |
| iOS             | full Xcode; devices iOS 15.0+ (Tauri default `bundle > iOS > minimumSystemVersion`)                        | not built yet                              |

## 1. Common setup

```bash
git clone https://github.com/tropi83/reweared.git
cd reweared
pnpm install
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env — optional, see DEVELOPMENT.md → Environment
pnpm check                  # typecheck, lint, format, tests
pnpm tauri info             # Tauri's own report of the toolchain it can see
```

`.env` only holds public build configuration (the desktop Google OAuth client, the Mock provider switch). Never put credentials or signing material in it.

## 2. Desktop

### 2.1 Windows (`.exe` / `.msi`)

Prerequisites:

- **Microsoft C++ Build Tools** (or Visual Studio) with the **Desktop development with C++** workload.
- **WebView2**: preinstalled on Windows 10 1803+ and Windows 11.
- **Rust**: `winget install --id Rustlang.Rustup`, then `rustup default stable-msvc`.
- **`.msi` only**: the **VBSCRIPT** optional feature (Settings → System → Optional features → More Windows features). The `.exe` does not need it.

```powershell
pnpm tauri dev                       # run with hot reload
pnpm tauri build                     # .exe (NSIS) and .msi
pnpm tauri build --bundles nsis      # only the .exe
pnpm tauri build --bundles msi       # only the .msi
```

Output (version 0.1.0 as an example):

- `src-tauri\target\release\bundle\nsis\AI Image Variations_0.1.0_x64-setup.exe` — the setup `.exe` (≈ 3 MB)
- `src-tauri\target\release\bundle\msi\AI Image Variations_0.1.0_x64_en-US.msi` (≈ 4 MB)

The first build downloads WiX 3.14 and NSIS 3.11 from GitHub (the CLI checks their hashes) into its cache, so it needs internet access once. Release builds are slow on purpose (`lto = true`, `codegen-units = 1` in `src-tauri/Cargo.toml`); use `pnpm tauri dev` while iterating.

- **WebView2 on the user's machine**: the default install mode (`downloadBootstrapper`) downloads WebView2 during setup when it is missing. For offline installs set `bundle > windows > webviewInstallMode` to `{ "type": "offlineInstaller" }` (≈ 127 MB larger).
- **Signing**: unsigned installers run, but SmartScreen warns users who download them. To sign, set `bundle > windows > certificateThumbprint`, `digestAlgorithm: "sha256"` and `timestampUrl`, or a `signCommand` (for example Azure Artifact Signing) — see [Tauri: Windows code signing](https://v2.tauri.app/distribute/sign/windows/). Certificates stay out of the repository.
- **ARM64 PCs**: install the ARM64 C++ build tools in the Visual Studio Installer, `rustup target add aarch64-pc-windows-msvc`, then `pnpm tauri build --target aarch64-pc-windows-msvc`.

### 2.2 macOS (`.app` / `.dmg`)

Prerequisites:

- **Xcode** from the App Store (launch it once), or only the Command Line Tools for desktop builds: `xcode-select --install`.
- **Rust**: `curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh`
- **Node.js 22+** (installer from nodejs.org or a version manager), then `corepack enable` for pnpm.

```bash
pnpm tauri dev                                      # run with hot reload
pnpm tauri build                                    # .app + .dmg for this Mac's architecture
rustup target add aarch64-apple-darwin x86_64-apple-darwin
pnpm tauri build --target universal-apple-darwin    # one universal .app/.dmg (Apple Silicon + Intel)
```

Output: `src-tauri/target/release/bundle/macos/*.app` and `src-tauri/target/release/bundle/dmg/*.dmg` (with `--target`, under `src-tauri/target/<target>/release/bundle/`). `pnpm tauri build --help` lists the `--bundles` values accepted on your OS.

- **Signing and notarization** ([Tauri: macOS code signing](https://v2.tauri.app/distribute/sign/macos/)). For local testing, ad-hoc signing (`bundle > macOS > signingIdentity: "-"`) is enough, but other Macs must still allow the app in System Settings → Privacy & Security. To distribute, use a Developer ID certificate through environment variables — `APPLE_CERTIFICATE` (base64 `.p12`), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` — and notarize with either `APPLE_API_ISSUER` / `APPLE_API_KEY` / `APPLE_API_KEY_PATH` (App Store Connect API key) or `APPLE_ID` / `APPLE_PASSWORD` (app-specific password) / `APPLE_TEAM_ID`.
- **Post on Vinted** keeps its session in a dedicated WebKit data store only on macOS 14+ (see SECURITY.md → Vinted window).

### 2.3 Linux — Debian / Ubuntu (`.deb` / `.AppImage` / `.rpm`)

Prerequisites (Debian 12+, Ubuntu 22.04+):

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev pkg-config patchelf
curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh
```

plus Node.js 22+ and `corepack enable`. Other distributions: [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#linux).

```bash
pnpm tauri dev                          # run with hot reload
pnpm tauri build                        # .deb, .rpm and .AppImage
pnpm tauri build --bundles deb          # only the .deb (also: rpm, appimage)
sudo apt install ./src-tauri/target/release/bundle/deb/*.deb
```

Output: `src-tauri/target/release/bundle/{deb,rpm,appimage}/`.

- **Compatibility**: build on the oldest distribution you want to support (glibc). The release workflow uses Ubuntu 22.04; Debian 12 works as a baseline too.
- **Saved credentials** need a running Secret Service provider (GNOME Keyring or KWallet). Without one, saving a key with “remember” fails with an error; the key still works until the app closes.

### 2.4 Release builds in CI

Pushing a tag `vX.Y.Z` runs `.github/workflows/release.yml`: Windows, macOS (Apple Silicon and Intel) and Linux (Ubuntu 22.04) bundles are attached to a **draft** GitHub release. Versioning and the checklist are in the `release` skill (`.claude/skills/release/SKILL.md`). Mobile builds are not in CI yet.

## 3. Android (from Windows, macOS or Linux)

### 3.1 One-time setup

1. Install **Android Studio**. In **SDK Manager**: **SDK Platforms** → Android SDK Platform 36; **SDK Tools** → Android SDK Platform-Tools, **NDK (Side by side)**, Android SDK Build-Tools, **Android SDK Command-line Tools**.
2. Set the environment variables, then **open a new terminal** (and restart your IDE) so they are picked up:

   Windows (PowerShell):

   ```powershell
   [System.Environment]::SetEnvironmentVariable("JAVA_HOME", "C:\Program Files\Android\Android Studio\jbr", "User")
   [System.Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LocalAppData\Android\Sdk", "User")
   $VERSION = Get-ChildItem -Name "$env:LocalAppData\Android\Sdk\ndk" | Select-Object -Last 1
   [System.Environment]::SetEnvironmentVariable("NDK_HOME", "$env:LocalAppData\Android\Sdk\ndk\$VERSION", "User")
   ```

   macOS (`~/.zshrc`):

   ```bash
   export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
   export ANDROID_HOME="$HOME/Library/Android/sdk"
   export NDK_HOME="$ANDROID_HOME/ndk/$(ls -1 $ANDROID_HOME/ndk)"
   ```

   Linux (`~/.bashrc`):

   ```bash
   export JAVA_HOME=/opt/android-studio/jbr
   export ANDROID_HOME="$HOME/Android/Sdk"
   export NDK_HOME="$ANDROID_HOME/ndk/$(ls -1 $ANDROID_HOME/ndk)"
   ```

   Any JDK 17 works for `JAVA_HOME` (Android Studio's bundled `jbr` is the simplest). With several NDKs installed, point `NDK_HOME` at one version explicitly.

3. Add the Rust targets: `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`
4. **Windows only — turn on Developer Mode.** The Tauri CLI links the compiled Rust library into `src-tauri/gen/android/app/src/main/jniLibs` with a symbolic link (no copy fallback), and Windows refuses symbolic links to non-elevated accounts otherwise (`Failed to create a symbolic link … not allowed for this system`). Run `start ms-settings:developers` (Windows 11 25H2+: System → Advanced → For developers; earlier: System → For developers), turn on **Developer Mode** and confirm (admin rights required). Leave **Device Portal** and **Device discovery** off — they are what opens network services. Do **not** work around it by building from an elevated terminal: that gives administrator rights to every build script of every dependency.
5. Check everything: `pnpm android:doctor` (also run automatically by `pnpm android:dev` and `pnpm android:apk`). It prints one line per check and the exact fix for anything missing, for example:

   ```
   Android build pre-flight (see BUILDING.md)
     [ok]   JAVA_HOME — C:\Program Files\Microsoft\jdk-17.0.17.10-hotspot
     [ok]   ANDROID_HOME — C:\Users\me\AppData\Local\Android\Sdk
     [ok]   adb (Platform-Tools)
     [ok]   NDK_HOME — C:\Users\me\AppData\Local\Android\Sdk\ndk\27.1.12297006
     [ok]   Rust Android targets
     [fail] Windows symlinks — this account may not create symbolic links (Developer Mode is off)
            fix: turn on Developer Mode: `start ms-settings:developers` → Developer Mode …
   ```

### 3.2 The Android project

`src-tauri/gen/android` is generated by `pnpm tauri android init` and **committed** (Gradle project, `AndroidManifest.xml`, launcher icons), so manifest changes such as permissions are reviewed like code. Its own `.gitignore` excludes build outputs, the Rust `.so` files, `local.properties` and signing files. Re-run `init` only when needed (for example after changing the identifier) and review the diff.

### 3.3 Prepare the phone

1. Settings → About phone → tap **Build number** 7 times, then Developer options → **USB debugging**.
2. Plug it in with a data cable and accept the “Allow USB debugging?” prompt on the phone.
3. `adb devices` must list it as `device` (`unauthorized` = prompt not accepted; empty on Windows = try another cable/port or install the manufacturer's USB driver).

An emulator from Android Studio's Device Manager works too.

### 3.4 Develop with hot reload

```bash
pnpm android:dev                 # pre-flight, then tauri android dev (asks which device when several are connected)
pnpm android:dev --open          # open the project in Android Studio instead (keep the CLI running)
```

The phone loads the frontend from the Vite dev server on your computer: phone and computer must be on the same network, and the firewall must allow Node.js on ports 1420 and 1421 (private networks). On Windows the CLI uses the computer's network address by default; elsewhere add `--host` when the app cannot reach the dev server. The CLI then sets `TAURI_DEV_HOST`, which `vite.config.ts` already listens on. Inspect the WebView from Chrome on the computer: `chrome://inspect`.

### 3.5 Debug APK (no dev server)

```bash
pnpm android:apk                                           # pre-flight, then tauri android build --apk --debug
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

The universal APK contains all four ABIs. For a quicker build aimed at recent phones only: `pnpm tauri android build --apk --debug --target aarch64`. **On the Android Studio emulator (x86_64 system images) build with `--target x86_64`**: an arm64-only APK runs the Rust library through ARM→x86 translation (`libndk_translation`), which is slow and freezes the UI thread in native callbacks ("isn't responding" dialogs as soon as a listing opens).

### 3.6 Release build (Play Store or sideloading)

1. **Create an upload key** once ([Tauri: Android code signing](https://v2.tauri.app/distribute/sign/android/)), outside the repository:
   - macOS/Linux: `keytool -genkey -v -keystore ~/upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload`
   - Windows: `keytool -genkey -v -keystore $env:USERPROFILE\upload-keystore.jks -storetype JKS -keyalg RSA -keysize 2048 -validity 10000 -alias upload` (`keytool` ships with the JDK in `JAVA_HOME\bin`).
2. Create `src-tauri/gen/android/keystore.properties` (ignored by git) with `password=…`, `keyAlias=upload`, `storeFile=<absolute path to the .jks>`.
3. Add the `signingConfigs { create("release") { … } }` block from the Tauri guide to `src-tauri/gen/android/app/build.gradle.kts` and `signingConfig = signingConfigs.getByName("release")` to the `release` build type. It is not committed yet on purpose: as written in the guide it makes every release build require `keystore.properties`.
4. Build:

   ```bash
   pnpm tauri android build --aab    # Play Store: src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab
   pnpm tauri android build --apk    # sideloading: src-tauri/gen/android/app/build/outputs/apk/universal/release/
   ```

- **Version code** is derived from `version` in `tauri.conf.json` (major × 1,000,000 + minor × 1,000 + patch); override with `bundle > android > versionCode`. Google Play needs it to increase with every upload.
- **Minimum Android version**: `bundle > android > minSdkVersion` (default 24 = Android 7.0).
- Google Play prefers the universal AAB; `--split-per-abi` is for testing only.
- Keep the upload key and its password safe: losing it means you cannot update the app on Google Play without Google's key reset procedure.

### 3.7 Troubleshooting

| Symptom                                                                                       | Cause                                                     | Fix                                                                                   |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `Failed to create a symbolic link … not allowed for this system` (Windows)                    | Developer Mode is off                                     | §3.1 step 4                                                                           |
| `keyring … At least one of the features 'v1' or 'cli' must be enabled`                        | an old checkout declared `keyring` for mobile             | update the branch (keyring is desktop-only in `src-tauri/Cargo.toml`)                 |
| NDK / linker / `JAVA_HOME` errors                                                             | environment variables missing or not reloaded             | `pnpm android:doctor`, then open a new terminal                                       |
| `adb devices` is empty or `unauthorized`                                                      | USB debugging off, prompt not accepted, cable, driver     | §3.3                                                                                  |
| White screen or “connection refused” with `android:dev`                                       | the phone cannot reach the dev server                     | same Wi-Fi, firewall ports 1420/1421, `--host`, or install a debug APK (§3.5) instead |
| `Warn The bundle identifier … ends with .app`                                                 | known, harmless                                           | §6                                                                                    |
| “AI Image Variations isn't responding” on the emulator, `libndk_translation` in the ANR trace | an arm64-only APK on an x86_64 emulator (translated code) | rebuild with `--target x86_64` (§3.5)                                                 |

### 3.8 What differs on phones

- **Post on Vinted** opens a native Vinted screen (plugin `src-tauri/plugins/vinted-webview`: Kotlin `VintedActivity`, Swift `VintedViewController`). The app hands the listing over once; the screen fills the sell form when it appears and returns a report on Close. Session isolation uses the WebView Profile API on Android (WebView 116+) and a dedicated `WKWebsiteDataStore` on iOS 17+ (SECURITY.md). **The iOS half has not been built yet** (no Mac was available when it was written): on macOS run `pnpm ios:dev`, fix any compiler complaint in `ios/Sources/VintedWebviewPlugin.swift`, then check that the screen opens on vinted.com, blocks a link to another site, fills the form once logged in and that Settings → Publishing → erase session works.
- **Google sign-in** is not wired on mobile: use an API key. Keys are kept for the session only until the mobile keystore lands.
- **Take a photo** opens the phone's camera app. On Android this relies on the `<queries>` entry for `android.media.action.IMAGE_CAPTURE` in `src-tauri/gen/android/app/src/main/AndroidManifest.xml` (Android 11+ hides other apps otherwise and the gallery opens instead); no `CAMERA` permission is needed (DEVELOPMENT.md → Mobile image import).
- **Screen edges**: Android reserves the status bar, navigation bar and keyboard areas natively (`MainActivity.kt`, window background = the app background); iOS relies on `viewport-fit=cover` + `env(safe-area-inset-*)` padding in the web UI (`App.tsx`, toasts, lightbox).

## 4. iOS (macOS only)

### 4.1 One-time setup

1. **Xcode** from the App Store — the full IDE, not only the Command Line Tools. Launch it once, then make sure it is selected: `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.
2. **Rust targets**: `rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim`
3. **Homebrew** (`/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`) and **CocoaPods**: `brew install cocoapods`
4. **Development team**: iOS enforces code signing, so Tauri needs a team ID (Xcode → Settings → Accounts). Export it per developer rather than committing it: `export APPLE_DEVELOPMENT_TEAM="<Team ID>"` in `~/.zshrc` (or set `bundle > iOS > developmentTeam`). Distribution through the App Store requires the Apple Developer Program (99 USD/year).
5. Check everything: `pnpm ios:doctor` (also run by `pnpm ios:dev`).

### 4.2 Generate the Xcode project

```bash
pnpm tauri ios init
```

It creates `src-tauri/gen/apple`. Commit it, like the Android project, after checking that no signing file or personal team setting ended up in it. (Not generated yet in this repository.)

### 4.3 Develop with hot reload

```bash
pnpm ios:dev                          # pre-flight, then tauri ios dev (simulator or connected device)
pnpm ios:dev "iPhone 16"              # a specific simulator
pnpm ios:dev --force-ip-prompt        # physical iPhone: pick your Mac's Wi-Fi address for the dev server
pnpm ios:dev --open                   # open Xcode instead (keep the CLI running; with a device: --open --host)
```

A physical iPhone must first be connected and trusted in Xcode (Window → Devices and Simulators) and be on the same network as the Mac. `vite.config.ts` already listens on `TAURI_DEV_HOST`. Inspect the WebView with Safari: Settings → Advanced → “Show features for web developers”, then the **Develop** menu.

### 4.4 App Store build

```bash
pnpm tauri ios build --export-method app-store-connect
xcrun altool --upload-app --type ios --file "src-tauri/gen/apple/build/arm64/<app name>.ipa" --apiKey $APPLE_API_KEY_ID --apiIssuer $APPLE_API_ISSUER
```

- The `.ipa` is written to `src-tauri/gen/apple/build/arm64/`. The upload uses an App Store Connect API key (`AuthKey_<key id>.p8`, placed as described in [Tauri: App Store](https://v2.tauri.app/distribute/app-store/); never in the repository).
- **Signing** ([Tauri: iOS code signing](https://v2.tauri.app/distribute/sign/ios/)): automatic with `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`, or manual with `IOS_CERTIFICATE` (base64), `IOS_CERTIFICATE_PASSWORD`, `IOS_MOBILE_PROVISION` (base64).
- **Build number**: `CFBundleVersion` comes from `version` in `tauri.conf.json`; override with `bundle > iOS > bundleVersion`. **Minimum iOS**: `bundle > iOS > minimumSystemVersion` (default 15.0).
- The same phone limitations as Android apply (§3.8).

## 5. Signing material and secrets

- Never commit keystores, certificates, provisioning profiles, API keys or their passwords. The root `.gitignore` excludes `*.jks`, `*.keystore`, `keystore.properties`, `*.p12`, `*.p8`, `*.pem` and `*.mobileprovision`; `src-tauri/gen/android/.gitignore` also excludes `key.properties`.
- In CI, pass signing material as GitHub **secrets** mapped to the environment variables listed above; public values (such as the desktop OAuth client ID) as **variables**.
- Release builds must not enable the Mock provider (`VITE_ENABLE_MOCK_PROVIDER` unset) — see the `release` skill.

## 6. Known warning: identifier ends with `.app`

Every build prints `Warn The bundle identifier "com.aiimagevariations.app" … ends with .app`, because `.app` is also the macOS bundle extension. It is harmless for building and running. It is **kept on purpose** for now: the identifier names the app-data folder that holds every local project (and the Vinted session), and it becomes the Android `applicationId` and the iOS bundle ID. Changing it creates a different app on every platform — existing projects would no longer be found. Change it only together with a data-migration step, and before the first store release (store identifiers cannot change afterwards).
