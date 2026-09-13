/** Query keys, in one place so invalidation and seeding never guess at shapes. */
export const queryKeys = {
  allModels: ["models"] as const,
  models: (providerId: string) => ["models", providerId] as const,
  allAuthStatus: ["auth-status"] as const,
  authStatus: (providerId: string) => ["auth-status", providerId] as const,
};
