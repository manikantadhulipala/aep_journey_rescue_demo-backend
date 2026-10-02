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

export const assistantPromptSchema = z.object({
  prompt: z.string().trim().min(5).max(500),
  currentSettings: audienceQuerySchema.partial().optional(),
});

export const activationRequestSchema = z.object({
  destinationId: z.enum(["braze_mock", "meta_mock", "webhook_mock"]),
  audienceName: z.string().trim().min(3).max(100).default("Journey Rescue — High-Intent Abandoners"),
  rules: audienceQuerySchema,
  confirmSimulation: z.literal(true),
});
