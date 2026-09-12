// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ANDROID_RUST_TARGETS, diagnoseAndroid, diagnoseIos, IOS_RUST_TARGETS } from "./mobile-doctor.mjs";

const byLabel = (findings, label) => findings.find((f) => f.label === label);
const errors = (findings) => findings.filter((f) => f.level === "error");

/** A fully prepared Windows machine; each test breaks one thing. */
function android(over = {}) {
  return {
    platform: "win32",
    env: { JAVA_HOME: "C:/jdk", ANDROID_HOME: "C:/sdk", NDK_HOME: "C:/sdk/ndk/27.1.12297006" },
    exists: () => true,
    ndkVersions: ["26.3.11579264", "27.1.12297006"],
    installedTargets: [...ANDROID_RUST_TARGETS, "x86_64-pc-windows-msvc"],
    canSymlink: true,
    ...over,
  };
}

/** A fully prepared Mac. */
function ios(over = {}) {
  return {
    platform: "darwin",
    env: {},
    xcode: "Xcode 26.0 Build version 17A324",
    installedTargets: [...IOS_RUST_TARGETS, "aarch64-apple-darwin"],
    cocoapods: "1.16.2",
    developmentTeam: "ABCDE12345",
    ...over,
  };
}

describe("android doctor", () => {
  it("passes a prepared machine", () => {
    expect(diagnoseAndroid(android()).every((f) => f.level === "ok")).toBe(true);
  });

  it("blocks Windows without symlink rights and points to Developer Mode", () => {
    const f = byLabel(diagnoseAndroid(android({ canSymlink: false })), "Windows symlinks");
    expect(f).toMatchObject({ level: "error" });
    expect(f.fix).toMatch(/Developer Mode/);
    expect(f.fix).toMatch(/elevated/);
  });

  it("does not test symlinks on macOS or Linux", () => {
    for (const platform of ["darwin", "linux"]) expect(byLabel(diagnoseAndroid(android({ platform, canSymlink: null })), "Windows symlinks")).toBeUndefined();
  });

  it("lists only the missing Rust targets in the fix", () => {
    const f = byLabel(diagnoseAndroid(android({ installedTargets: ["aarch64-linux-android"] })), "Rust Android targets");
    expect(f).toMatchObject({ level: "error", fix: "rustup target add armv7-linux-androideabi i686-linux-android x86_64-linux-android" });
  });

  it("reports a missing rustup", () => {
    expect(byLabel(diagnoseAndroid(android({ installedTargets: null })), "Rust Android targets")).toMatchObject({ level: "error", detail: "rustup not found" });
  });

  it("only warns when NDK_HOME is unset but the SDK has an NDK, suggesting the newest one", () => {
    const f = byLabel(diagnoseAndroid(android({ env: { JAVA_HOME: "C:/jdk", ANDROID_HOME: "C:/sdk" } })), "NDK_HOME");
    expect(f.level).toBe("warn");
    expect(f.fix).toContain("27.1.12297006");
    expect(f.fix).toContain("SetEnvironmentVariable");
  });

  it("fails a bare machine with the OS-specific default locations", () => {
    const bare = { env: {}, exists: () => false, ndkVersions: [], canSymlink: null };
    const linux = diagnoseAndroid(android({ ...bare, platform: "linux" }));
    expect(errors(linux).map((f) => f.label)).toEqual(["JAVA_HOME", "ANDROID_HOME", "NDK"]);
    expect(byLabel(linux, "JAVA_HOME").fix).toBe('export JAVA_HOME="/opt/android-studio/jbr"  # add it to ~/.zshrc or ~/.bashrc');
    expect(byLabel(linux, "ANDROID_HOME").fix).toContain("$HOME/Android/Sdk");
    const mac = diagnoseAndroid(android({ ...bare, platform: "darwin" }));
    expect(byLabel(mac, "JAVA_HOME").fix).toContain("/Applications/Android Studio.app/Contents/jbr/Contents/Home");
    expect(byLabel(mac, "ANDROID_HOME").fix).toContain("$HOME/Library/Android/sdk");
  });

  it("requires the java binary, not just the variable", () => {
    const findings = diagnoseAndroid(android({ exists: (p) => !p.replaceAll("\\", "/").endsWith("bin/java.exe") }));
    expect(byLabel(findings, "JAVA_HOME")).toMatchObject({ level: "error", detail: "no bin/java under C:/jdk" });
  });
});

describe("ios doctor", () => {
  it("passes a prepared Mac", () => {
    expect(diagnoseIos(ios()).every((f) => f.level === "ok")).toBe(true);
  });

  it("refuses any other OS with a single clear finding", () => {
    for (const platform of ["win32", "linux"]) expect(diagnoseIos(ios({ platform }))).toEqual([expect.objectContaining({ level: "error", label: "macOS" })]);
  });

  it("requires full Xcode, CocoaPods and the iOS targets", () => {
    const findings = diagnoseIos(ios({ xcode: null, cocoapods: null, installedTargets: ["aarch64-apple-ios"] }));
    expect(errors(findings).map((f) => f.label)).toEqual(["Xcode", "Rust iOS targets", "CocoaPods"]);
    expect(byLabel(findings, "Rust iOS targets").fix).toBe("rustup target add x86_64-apple-ios aarch64-apple-ios-sim");
    expect(byLabel(findings, "CocoaPods").fix).toBe("brew install cocoapods");
  });

  it("warns without a development team and accepts APPLE_DEVELOPMENT_TEAM", () => {
    expect(byLabel(diagnoseIos(ios({ developmentTeam: null })), "Development team").level).toBe("warn");
    expect(byLabel(diagnoseIos(ios({ developmentTeam: null, env: { APPLE_DEVELOPMENT_TEAM: "TEAM1" } })), "Development team")).toMatchObject({
      level: "ok",
      detail: "TEAM1",
    });
  });
});
