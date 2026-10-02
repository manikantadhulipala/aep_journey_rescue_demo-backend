import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { suggestTravelAudienceRules } from "./assistant.js";

describe("offline audience-rule assistant", () => {
  it("suggests bounded rule windows for a supported travel prompt", () => {
    const result = suggestTravelAudienceRules(
      "Travelers who searched in the last 21 days, abandoned in the last 10 days, and no booking in the last 5 days",
    );
    assert.equal(result.supported, true);
    if (!result.supported) return;
    assert.deepEqual(result.rules, {
      asOf: "2026-09-30",
      searchDays: 21,
      abandonDays: 10,
      bookingDays: 5,
    });
    assert.equal(result.requiresHumanReview, true);
  });

  it("retains current settings when the prompt does not specify a window", () => {
    const result = suggestTravelAudienceRules("High-intent flight journey abandoners", {
      asOf: "2026-09-29",
      searchDays: 8,
      abandonDays: 9,
      bookingDays: 4,
    });
    assert.equal(result.supported, true);
    if (!result.supported) return;
    assert.deepEqual(result.rules, {
      asOf: "2026-09-29",
      searchDays: 8,
      abandonDays: 9,
      bookingDays: 4,
    });
  });

  it("caps parsed windows and explicitly rejects unsupported business domains", () => {
    const supported = suggestTravelAudienceRules("flight search 999 days and booking 999 days");
    assert.equal(supported.supported, true);
    if (supported.supported) assert.equal(supported.rules.searchDays, 365);

    const unsupported = suggestTravelAudienceRules("Find people interested in indoor plants");
    assert.equal(unsupported.supported, false);
  });
});
