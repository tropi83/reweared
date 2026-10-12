import { z } from "zod";

/** The signed-in account as the API exposes it (Better Auth keeps its own user ids). */
export const meDto = z.object({
  id: z.string().min(1),
  email: z.email(),
  emailVerified: z.boolean(),
  name: z.string(),
});
