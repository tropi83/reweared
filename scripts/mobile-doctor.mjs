// Pre-flight for `tauri android|ios dev|build`: reports in about a second what would otherwise fail after
// minutes of compiling (JDK/SDK/NDK variables, Rust targets, Windows symlink rights, Xcode, CocoaPods).
// Works on Windows, macOS and Linux. See BUILDING.md. Rules (`diagnose*`) are pure and unit-tested;
// `probe*` gather the facts. Usage: node scripts/mobile-doctor.mjs <android|ios>
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** `tauri android build` compiles every ABI unless `--target` narrows it. */
export const ANDROID_RUST_TARGETS = ["aarch64-linux-android", "armv7-linux-androideabi", "i686-linux-android", "x86_64-linux-android"];
/** Device, Intel simulator, Apple Silicon simulator (Tauri prerequisites). */
export const IOS_RUST_TARGETS = ["aarch64-apple-ios", "x86_64-apple-ios", "aarch64-apple-ios-sim"];

/**
 * @typedef {{ level: "ok" | "warn" | "error", label: string, detail?: string, fix?: string }} Finding
 * @typedef {{ platform: NodeJS.Platform, env: Record<string, string | undefined>, exists: (path: string) => boolean,
 *   ndkVersions: string[], installedTargets: string[] | null, canSymlink: boolean | null }} AndroidProbe
 * @typedef {{ platform: NodeJS.Platform, env: Record<string, string | undefined>, xcode: string | null,
 *   installedTargets: string[] | null, cocoapods: string | null, developmentTeam: string | null }} IosProbe
 */

/** Default locations from the Tauri prerequisites, per OS. */
const DEFAULTS = {
  win32: { JAVA_HOME: "C:\\Program Files\\Android\\Android Studio\\jbr", ANDROID_HOME: "$env:LocalAppData\\Android\\Sdk" },
  darwin: { JAVA_HOME: "/Applications/Android Studio.app/Contents/jbr/Contents/Home", ANDROID_HOME: "$HOME/Library/Android/sdk" },
  linux: { JAVA_HOME: "/opt/android-studio/jbr", ANDROID_HOME: "$HOME/Android/Sdk" },
};

const exe = (platform, name) => (platform === "win32" ? `${name}.exe` : name);
const defaults = (platform) => DEFAULTS[platform] ?? DEFAULTS.linux;
const setVar = (platform, name, value) =>
  platform === "win32"
    ? `[Environment]::SetEnvironmentVariable("${name}", "${value}", "User")  # then open a new terminal`
    : `export ${name}="${value}"  # add it to ~/.zshrc or ~/.bashrc`;

/** @param {string[] | null} installed @param {string[]} wanted @returns {Finding} */
function rustTargets(installed, wanted, label) {
  if (installed === null) return { level: "error", label, detail: "rustup not found", fix: "install Rust with rustup (https://rustup.rs)" };
  const missing = wanted.filter((t) => !installed.includes(t));
  return missing.length === 0
    ? { level: "ok", label }
    : { level: "error", label, detail: `missing ${missing.join(", ")}`, fix: `rustup target add ${missing.join(" ")}` };
}

/** @param {AndroidProbe} p @returns {Finding[]} */
export function diagnoseAndroid(p) {
  const d = defaults(p.platform);
  /** @type {Finding[]} */
  const out = [];

  const java = p.env.JAVA_HOME;
  if (java && p.exists(join(java, "bin", exe(p.platform, "java")))) out.push({ level: "ok", label: "JAVA_HOME", detail: java });
  else
    out.push({ level: "error", label: "JAVA_HOME", detail: java ? `no bin/java under ${java}` : "not set", fix: setVar(p.platform, "JAVA_HOME", d.JAVA_HOME) });

  const sdk = p.env.ANDROID_HOME || p.env.ANDROID_SDK_ROOT;
  const sdkOk = !!sdk && p.exists(sdk);
  if (sdkOk) out.push({ level: "ok", label: "ANDROID_HOME", detail: sdk });
  else
    out.push({
      level: "error",
      label: "ANDROID_HOME",
      detail: sdk ? `${sdk} does not exist` : "not set",
      fix: setVar(p.platform, "ANDROID_HOME", d.ANDROID_HOME),
    });

  if (sdkOk) {
    if (p.exists(join(sdk, "platform-tools", exe(p.platform, "adb")))) out.push({ level: "ok", label: "adb (Platform-Tools)" });
    else
      out.push({
        level: "warn",
        label: "adb (Platform-Tools)",
        detail: "missing: needed to install on a phone",
        fix: "Android Studio → SDK Manager → SDK Tools → Android SDK Platform-Tools",
      });
  }

  const ndk = p.env.NDK_HOME;
  const latestNdk = p.ndkVersions.toSorted().at(-1);
  if (ndk && p.exists(ndk)) out.push({ level: "ok", label: "NDK_HOME", detail: ndk });
  else if (sdkOk && latestNdk)
    out.push({
      level: "warn",
      label: "NDK_HOME",
      detail: ndk ? `${ndk} does not exist` : "not set (the CLI may still find the SDK's NDK)",
      fix: setVar(p.platform, "NDK_HOME", join(sdk, "ndk", latestNdk)),
    });
  else
    out.push({
      level: "error",
      label: "NDK",
      detail: "no NDK installed",
      fix: "Android Studio → SDK Manager → SDK Tools → NDK (Side by side), then set NDK_HOME",
    });

  out.push(rustTargets(p.installedTargets, ANDROID_RUST_TARGETS, "Rust Android targets"));

  // cargo-mobile2 symlinks the Rust library into gen/android/app/src/main/jniLibs and has no copy fallback.
  if (p.platform === "win32") {
    if (p.canSymlink === true) out.push({ level: "ok", label: "Windows symlinks" });
    else if (p.canSymlink === false)
      out.push({
        level: "error",
        label: "Windows symlinks",
        detail: "this account may not create symbolic links (Developer Mode is off)",
        fix: "turn on Developer Mode: `start ms-settings:developers` → Developer Mode (admin rights needed; leave Device Portal and Device discovery off). Do not build from an elevated terminal instead.",
      });
    else out.push({ level: "warn", label: "Windows symlinks", detail: "could not be tested" });
  }
  return out;
}

/** @param {IosProbe} p @returns {Finding[]} */
export function diagnoseIos(p) {
  if (p.platform !== "darwin")
    return [{ level: "error", label: "macOS", detail: `iOS builds need macOS with Xcode (this is ${p.platform})`, fix: "build iOS on a Mac" }];
  /** @type {Finding[]} */
  const out = [];
  if (p.xcode) out.push({ level: "ok", label: "Xcode", detail: p.xcode });
  else
    out.push({
      level: "error",
      label: "Xcode",
      detail: "full Xcode not found (Command Line Tools alone cannot build iOS)",
      fix: "install Xcode from the App Store, launch it once, then `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`",
    });
  out.push(rustTargets(p.installedTargets, IOS_RUST_TARGETS, "Rust iOS targets"));
  if (p.cocoapods) out.push({ level: "ok", label: "CocoaPods", detail: p.cocoapods });
  else out.push({ level: "error", label: "CocoaPods", detail: "`pod` not found", fix: "brew install cocoapods" });
  const team = p.env.APPLE_DEVELOPMENT_TEAM || p.developmentTeam;
  if (team) out.push({ level: "ok", label: "Development team", detail: team });
  else
    out.push({
      level: "warn",
      label: "Development team",
      detail: "not set: iOS enforces code signing (devices, archives)",
      fix: 'export APPLE_DEVELOPMENT_TEAM="<Team ID from Xcode → Settings → Accounts>" (or bundle > iOS > developmentTeam in a local tauri config)',
    });
  return out;
}

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function installedRustTargets() {
  const out = run("rustup", ["target", "list", "--installed"]);
  return out === null
    ? null
    : out
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
}

/** Same call the toolchain makes (libuv asks for unprivileged creation, which Developer Mode allows). */
function probeSymlink() {
  const dir = mkdtempSync(join(tmpdir(), "aiv-symlink-"));
  try {
    writeFileSync(join(dir, "target"), "");
    symlinkSync(join(dir, "target"), join(dir, "link"), "file");
    return true;
  } catch (err) {
    return /** @type {NodeJS.ErrnoException} */ (err).code === "EPERM" ? false : null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** @returns {AndroidProbe} */
export function probeAndroid() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  let ndkVersions = [];
  try {
    if (sdk) ndkVersions = readdirSync(join(sdk, "ndk"));
  } catch {
    /* no ndk folder */
  }
  return {
    platform: process.platform,
    env: process.env,
    exists: existsSync,
    ndkVersions,
    installedTargets: installedRustTargets(),
    canSymlink: process.platform === "win32" ? probeSymlink() : null,
  };
}

/** @returns {IosProbe} */
export function probeIos() {
  const darwin = process.platform === "darwin";
  let developmentTeam = null;
  try {
    developmentTeam = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"))?.bundle?.iOS?.developmentTeam ?? null;
  } catch {
    /* unreadable config: the doctor still reports the rest */
  }
  return {
    platform: process.platform,
    env: process.env,
    // `xcodebuild -version` fails when only the Command Line Tools are selected.
    xcode: darwin ? (run("xcodebuild", ["-version"])?.split(/\r?\n/).join(" ") ?? null) : null,
    installedTargets: darwin ? installedRustTargets() : null,
    cocoapods: darwin ? run("pod", ["--version"]) : null,
    developmentTeam,
  };
}

const TAG = { ok: "[ok]  ", warn: "[warn]", error: "[fail]" };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = process.argv[2];
  if (target !== "android" && target !== "ios") {
    console.error("usage: node scripts/mobile-doctor.mjs <android|ios>");
    process.exit(2);
  }
  const findings = target === "android" ? diagnoseAndroid(probeAndroid()) : diagnoseIos(probeIos());
  console.log(`${target === "android" ? "Android" : "iOS"} build pre-flight (see BUILDING.md)`);
  for (const f of findings) {
    console.log(`  ${TAG[f.level]} ${f.label}${f.detail ? ` — ${f.detail}` : ""}`);
    if (f.fix && f.level !== "ok") console.log(`         fix: ${f.fix}`);
  }
  const failed = findings.filter((f) => f.level === "error").length;
  if (failed > 0) {
    console.error(`\n${failed} blocking problem(s): fix them before running tauri ${target}.`);
    process.exit(1);
  }
}
