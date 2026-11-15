import { z } from "zod";

export const loginBodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(256),
});

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(20).max(256),
});

export type LoginBody = z.infer<typeof loginBodySchema>;
export type RefreshBody = z.infer<typeof refreshBodySchema>;
