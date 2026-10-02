import type { AudienceRules, Customer, Evaluation, JourneyEvent } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AudienceCheckRow extends Customer {
  has_recent_search: boolean;
  has_recent_abandonment: boolean;
  has_recent_booking: boolean;
}

export function evaluationFromChecks(
  checks: Pick<AudienceCheckRow, "marketing_consent" | "loyalty_tier" | "travel_intent_score" | "has_recent_search" | "has_recent_abandonment" | "has_recent_booking">,
): Evaluation {
  const result = {
    consent: checks.marketing_consent,
    intent: checks.loyalty_tier === "GOLD"
      || checks.loyalty_tier === "PLATINUM"
      || checks.travel_intent_score >= 0.8,
    search: checks.has_recent_search,
    abandoned: checks.has_recent_abandonment,
    completed: checks.has_recent_booking,
  };

  const reasons: string[] = [];
  if (!result.consent) reasons.push("No marketing consent");
  if (!result.intent) reasons.push("Intent or loyalty threshold not met");
  if (!result.search) reasons.push("No recent flight search");
  if (!result.abandoned) reasons.push("No recent abandoned booking");
  if (result.completed) reasons.push("Recent completed booking");

  return {
    qualifies: result.consent && result.intent && result.search && result.abandoned && !result.completed,
    checks: result,
    reasons,
  };
}

function withinWindow(event: JourneyEvent, asOf: string, days: number): boolean {
  const eventTime = Date.parse(event.occurred_at);
  const anchor = Date.parse(`${asOf}T23:59:59.999Z`);
  return Number.isFinite(eventTime) && eventTime >= anchor - days * DAY_MS && eventTime <= anchor;
}

export function evaluateCustomer(
  customer: Customer,
  events: JourneyEvent[],
  rules: AudienceRules,
): Evaluation {
  const customerEvents = events.filter((event) => event.customer_id === customer.customer_id);
  return evaluationFromChecks({
    ...customer,
    has_recent_search: customerEvents.some((event) =>
      event.event_type === "flight_search" && withinWindow(event, rules.asOf, rules.searchDays)),
    has_recent_abandonment: customerEvents.some((event) =>
      event.event_type === "booking_abandoned" && withinWindow(event, rules.asOf, rules.abandonDays)),
    has_recent_booking: customerEvents.some((event) =>
      event.event_type === "booking_completed" && withinWindow(event, rules.asOf, rules.bookingDays)),
  });
}

export function evaluateAudience(
  customers: Customer[],
  events: JourneyEvent[],
  rules: AudienceRules,
) {
  const profiles = customers.map((customer) => ({
    ...customer,
    audience: evaluateCustomer(customer, events, rules),
  }));
  const qualified = profiles.filter((profile) => profile.audience.qualifies);
  return {
    rules,
    totalProfiles: profiles.length,
    qualifiedCount: qualified.length,
    excludedCount: profiles.length - qualified.length,
    qualifiedCustomerIds: qualified.map((profile) => profile.customer_id),
    profiles,
  };
}
