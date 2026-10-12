// Checks the resolved production compose file (stdin: `docker compose -f compose.yaml config --format json`):
// provider keys reach the worker only, and only Caddy publishes ports. Exits non-zero on the first problem.
const PROVIDER_SECRETS = ["cloudflare_api_token", "gemini_api_key"];

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const config = JSON.parse(input);
  const problems = [];
  for (const [name, service] of Object.entries(config.services ?? {})) {
    const secrets = (service.secrets ?? []).map((s) => s.source);
    const env = Object.keys(service.environment ?? {});
    if (name !== "worker") {
      for (const secret of PROVIDER_SECRETS) if (secrets.includes(secret)) problems.push(`${name} receives the provider secret ${secret}`);
      for (const key of env) if (/^(CLOUDFLARE_API_TOKEN|GEMINI_API_KEY)/.test(key)) problems.push(`${name} has the provider variable ${key}`);
    }
    if (name !== "caddy" && (service.ports ?? []).length > 0) problems.push(`${name} publishes ports`);
  }
  for (const secret of PROVIDER_SECRETS) {
    if (!(config.services?.worker?.secrets ?? []).some((s) => s.source === secret)) problems.push(`the worker lacks ${secret}`);
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(`✗ ${p}`);
    process.exit(1);
  }
  console.log("compose: provider keys on the worker only, ports on Caddy only");
});
