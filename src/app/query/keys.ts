/** Query keys, in one place so invalidation and seeding never guess at shapes. */
export const queryKeys = {
  allModels: ["models"] as const,
  models: (providerId: string) => ["models", providerId] as const,
  allAuthStatus: ["auth-status"] as const,
  authStatus: (providerId: string) => ["auth-status", providerId] as const,
  /** API mode: the account's balance and latest movements. */
  credits: ["credits"] as const,
  /** API mode: run costs and the platform image model's choices (public). */
  platform: ["platform"] as const,
};
