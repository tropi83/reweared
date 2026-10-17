// Checks the resolved production compose file (stdin: `docker compose -f compose.yaml config --format json`, with
// AIV_VERSION set): provider keys reach the worker only, only Caddy publishes ports, every image is pinned to a
// version, every service rotates its logs and has a memory limit, and the Mock provider is off. Exits non-zero on
// the first problem.
import { pathToFileURL } from "node:url";

const PROVIDER_SECRETS = ["cloudflare_api_token", "gemini_api_key"];

export function checkCompose(config) {
  const problems = [];
  for (const [name, service] of Object.entries(config.services ?? {})) {
    const secrets = (service.secrets ?? []).map((s) => s.source);
    const env = service.environment ?? {};
    if (name !== "worker") {
      for (const secret of PROVIDER_SECRETS) if (secrets.includes(secret)) problems.push(`${name} receives the provider secret ${secret}`);
      for (const key of Object.keys(env)) if (/^(CLOUDFLARE_API_TOKEN|GEMINI_API_KEY)/.test(key)) problems.push(`${name} has the provider variable ${key}`);
    }
    if (name !== "caddy" && (service.ports ?? []).length > 0) problems.push(`${name} publishes ports`);

    const image = service.image ?? "";
    const tag = image.includes("@sha256:") ? "pinned" : image.slice(image.lastIndexOf(":") + 1);
    if (!image.includes(":") && !image.includes("@")) problems.push(`${name} image "${image}" has no tag`);
    else if (tag === "latest" || tag === "local") problems.push(`${name} image "${image}" is not pinned to a version`);

    if (service.logging?.driver !== "json-file" || !service.logging?.options?.["max-size"] || !service.logging?.options?.["max-file"]) {
      problems.push(`${name} has no log rotation (json-file with max-size and max-file)`);
    }
    if (!service.mem_limit) problems.push(`${name} has no memory limit`);
    if (String(env.ENABLE_MOCK_PROVIDER ?? "false").toLowerCase() === "true") problems.push(`${name} enables the Mock provider`);
  }
  for (const secret of PROVIDER_SECRETS) {
    if (!(config.services?.worker?.secrets ?? []).some((s) => s.source === secret)) problems.push(`the worker lacks ${secret}`);
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = "";
  process.stdin.on("data", (chunk) => (input += chunk));
  process.stdin.on("end", () => {
    const problems = checkCompose(JSON.parse(input));
    if (problems.length > 0) {
      for (const p of problems) console.error(`✗ ${p}`);
      process.exit(1);
    }
    console.log("compose: provider keys on the worker only, ports on Caddy only, images pinned, logs rotated, memory limited, no Mock provider");
  });
}
