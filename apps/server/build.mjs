// Bundles the server entrypoints into dist/ for the Docker image. Workspace packages (@aiv/*) are TypeScript
// sources, so they are bundled; npm dependencies stay external and are installed by `pnpm deploy --prod`.
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith("@aiv/"));

await build({
  entryPoints: { api: "src/api.ts" },
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  external,
  logLevel: "info",
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
