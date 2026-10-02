import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parse } from "csv-parse/sync";
import { evaluateAudience, evaluateCustomer } from "./audience.js";
import type { AudienceRules, Customer, JourneyEvent } from "./types.js";

const rules: AudienceRules = { asOf: "2026-09-30", searchDays: 14, abandonDays: 14, bookingDays: 7 };
const customer: Customer = {
  customer_id: "C001",
  email: "demo@example.com",
  first_name: "Demo",
  last_name: "Traveler",
  state: "CA",
  home_airport: "LAX",
  loyalty_tier: "GOLD",
  marketing_consent: true,
  travel_intent_score: 0.91,
  price_sensitivity_score: 0.42,
  travel_intent_segment: "High Intent",
  intent_updated_at: "2026-09-21T00:00:00Z",
};
const event = (event_id: string, event_type: string, occurred_at: string): JourneyEvent => ({
  event_id,
  customer_id: "C001",
  event_type,
  destination: "Hawaii",
  session_id: null,
  occurred_at,
  source: event_type === "booking_completed" ? "booking" : "web",
});

function readRows(fileName: string): Record<string, string>[] {
  return parse(readFileSync(new URL(`../data/${fileName}`, import.meta.url), "utf8"), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];
}

function field(row: Record<string, string>, name: string): string {
  const value = row[name];
  assert.ok(value, `CSV row includes ${name}`);
  return value;
}

describe("Journey Rescue audience evaluation", () => {
  it("qualifies a consented high-intent abandoner without a recent booking", () => {
    const result = evaluateCustomer(customer, [
      event("W1", "flight_search", "2026-09-20T14:10:00Z"),
      event("W2", "booking_abandoned", "2026-09-20T14:42:00Z"),
    ], rules);
    assert.equal(result.qualifies, true);
    assert.deepEqual(result.reasons, []);
  });

  it("suppresses a profile with a completed booking within the exclusion window", () => {
    const result = evaluateCustomer(customer, [
      event("W1", "flight_search", "2026-09-20T14:10:00Z"),
      event("W2", "booking_abandoned", "2026-09-20T14:42:00Z"),
      event("B1", "booking_completed", "2026-09-24T15:30:00Z"),
    ], rules);
    assert.equal(result.qualifies, false);
    assert.ok(result.reasons.includes("Recent completed booking"));
  });

  it("does not qualify an opted-out traveler", () => {
    const result = evaluateCustomer({ ...customer, marketing_consent: false }, [
      event("W1", "flight_search", "2026-09-20T14:10:00Z"),
      event("W2", "booking_abandoned", "2026-09-20T14:42:00Z"),
    ], rules);
    assert.equal(result.qualifies, false);
    assert.ok(result.reasons.includes("No marketing consent"));
  });

  it("honors the requested lookback window and evaluation anchor", () => {
    const result = evaluateCustomer(customer, [
      event("W1", "flight_search", "2026-09-10T14:10:00Z"),
      event("W2", "booking_abandoned", "2026-09-20T14:42:00Z"),
    ], { ...rules, searchDays: 14 });
    assert.equal(result.checks.search, false);
    assert.equal(result.qualifies, false);
  });

  it("matches the four documented synthetic audience members", () => {
    const enrichment = new Map(
      readRows("04_third_party_travel_intent.csv").map((row) => [field(row, "customer_id"), row]),
    );
    const customers: Customer[] = readRows("01_crm_customers.csv").map((row) => {
      const customerId = field(row, "customer_id");
      const intent = enrichment.get(customerId);
      assert.ok(intent, `travel intent enrichment exists for ${customerId}`);
      return {
        customer_id: customerId,
        email: field(row, "email"),
        first_name: field(row, "first_name"),
        last_name: field(row, "last_name"),
        state: field(row, "state"),
        home_airport: field(row, "home_airport"),
        loyalty_tier: field(row, "loyalty_tier") as Customer["loyalty_tier"],
        marketing_consent: field(row, "marketing_consent").toLowerCase() === "true",
        travel_intent_score: Number(field(intent, "travel_intent_score")),
        price_sensitivity_score: Number(field(intent, "price_sensitivity_score")),
        travel_intent_segment: field(intent, "travel_intent_segment"),
        intent_updated_at: field(intent, "updated_at"),
      };
    });
    const sources: [string, JourneyEvent["source"], string][] = [
      ["02_web_events.csv", "web", "session_id"],
      ["03_mobile_events.csv", "mobile", "app_session_id"],
      ["05_completed_bookings.csv", "booking", ""],
    ];
    const events: JourneyEvent[] = sources.flatMap(([fileName, source, sessionField]) => readRows(fileName).map((row) => ({
      event_id: field(row, "event_id"),
      customer_id: field(row, "customer_id"),
      event_type: field(row, "event_type"),
      destination: field(row, "destination"),
      session_id: sessionField ? row[sessionField] || null : null,
      occurred_at: field(row, "event_time"),
      source: source as JourneyEvent["source"],
    })));
    const result = evaluateAudience(customers, events, rules);
    assert.deepEqual(result.qualifiedCustomerIds, ["C003", "C006", "C008", "C010"]);
  });
});
