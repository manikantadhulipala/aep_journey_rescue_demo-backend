import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { activationRequestSchema, assistantPromptSchema, audienceQuerySchema } from "./validation.js";

describe("API request validation", () => {
  it("rejects an audience lookback above the supported maximum", () => {
    const result = audienceQuerySchema.safeParse({
      asOf: "2026-09-30",
      searchDays: 366,
      abandonDays: 14,
      bookingDays: 7,
    });
    assert.equal(result.success, false);
  });

  it("requires a short, non-empty assistant prompt", () => {
    assert.equal(assistantPromptSchema.safeParse({ prompt: "Hi" }).success, false);
    assert.equal(assistantPromptSchema.safeParse({ prompt: "Travel abandoners" }).success, true);
  });

  it("requires explicit confirmation and a supported destination for simulated activation", () => {
    const validRequest = {
      destinationId: "braze_mock",
      audienceName: "Travel abandoners",
      rules: { asOf: "2026-09-30", searchDays: 14, abandonDays: 14, bookingDays: 7 },
      confirmSimulation: true,
    };
    assert.equal(activationRequestSchema.safeParse(validRequest).success, true);
    assert.equal(activationRequestSchema.safeParse({ ...validRequest, confirmSimulation: false }).success, false);
    assert.equal(activationRequestSchema.safeParse({ ...validRequest, destinationId: "live-prod" }).success, false);
  });
});
