import { z } from "zod";

const daySchema = z.coerce.number().int().min(1).max(365).default(14);

export const audienceQuerySchema = z.object({
  asOf: z.string().date().default("2026-09-30"),
  searchDays: daySchema,
  abandonDays: daySchema,
  bookingDays: daySchema.default(7),
});

export const listQuerySchema = z.object({
  q: z.string().trim().max(120).default(""),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
