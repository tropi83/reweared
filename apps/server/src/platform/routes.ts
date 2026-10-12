import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { jobCost } from "@aiv/domain/services/credits";
import { platformDto } from "@aiv/contracts/platform";
import type { RunDeps } from "../generations/runs";

/** `GET /api/v1/platform`: run costs and the platform image model's choices, so the apps never hard-code them. */
export function registerPlatformRoutes(app: FastifyInstance, deps: RunDeps): void {
  app.withTypeProvider<ZodTypeProvider>().get("/api/v1/platform", { schema: { response: { 200: platformDto } } }, async () => ({
    runCost: { image: jobCost("image"), copy: jobCost("copy") },
    freeMonthlyCredits: deps.freeMonthlyCredits,
    imageModel: {
      aspectRatios: ["original" as const, ...deps.platform.imageModel.capabilities.supportedAspectRatios],
      options: (deps.platform.imageModel.capabilities.options ?? []).map((o) => ({
        key: o.key,
        labelKey: o.labelKey,
        type: o.type,
        ...(o.min !== undefined ? { min: o.min } : {}),
        ...(o.max !== undefined ? { max: o.max } : {}),
        ...(o.step !== undefined ? { step: o.step } : {}),
        default: o.default,
      })),
    },
  }));
}
