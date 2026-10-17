/** Query keys, in one place so invalidation and seeding never guess at shapes. */
export const queryKeys = {
  /** The account's balance and latest movements. */
  credits: ["credits"] as const,
  /** Run costs and the platform image model's choices (public). */
  platform: ["platform"] as const,
};
