import { describe, expect, it } from "vitest";
import { apiOrigin, capability, configPatch } from "./tauri-api-config.mjs";

describe("tauri-api-config", () => {
  it("accepts https origins, and http for localhost only", () => {
    expect(apiOrigin(undefined)).toBeNull();
    expect(apiOrigin(" ")).toBeNull();
    expect(apiOrigin("https://app.example.com/")).toBe("https://app.example.com");
    expect(apiOrigin("http://localhost:8080")).toBe("http://localhost:8080");
    expect(() => apiOrigin("http://app.example.com")).toThrow(/https/);
    expect(() => apiOrigin("/")).toThrow(/absolute/);
    expect(() => apiOrigin("https://app.example.com/api")).toThrow(/origin only/);
  });

  it("scopes HTTP to the API paths and adds the origin to connect-src", () => {
    expect(capability("https://app.example.com").permissions).toEqual([{ identifier: "http:default", allow: [{ url: "https://app.example.com/api/*" }] }]);
    const patch = configPatch({ app: { security: { csp: { "default-src": "'self'", "connect-src": "'self' ipc:" } } } }, "https://app.example.com");
    expect(patch.app.security.csp).toEqual({ "default-src": "'self'", "connect-src": "'self' ipc: https://app.example.com" });
  });
});
