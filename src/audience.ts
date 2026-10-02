import type { AudienceRules, Customer, Evaluation, JourneyEvent } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

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
  const checks = {
    consent: customer.marketing_consent,
    intent: customer.loyalty_tier === "GOLD"
      || customer.loyalty_tier === "PLATINUM"
      || customer.travel_intent_score >= 0.8,
    search: customerEvents.some((event) =>
      event.event_type === "flight_search" && withinWindow(event, rules.asOf, rules.searchDays)),
    abandoned: customerEvents.some((event) =>
      event.event_type === "booking_abandoned" && withinWindow(event, rules.asOf, rules.abandonDays)),
    completed: customerEvents.some((event) =>
      event.event_type === "booking_completed" && withinWindow(event, rules.asOf, rules.bookingDays)),
  };

  const reasons: string[] = [];
  if (!checks.consent) reasons.push("No marketing consent");
  if (!checks.intent) reasons.push("Intent or loyalty threshold not met");
  if (!checks.search) reasons.push("No recent flight search");
  if (!checks.abandoned) reasons.push("No recent abandoned booking");
  if (checks.completed) reasons.push("Recent completed booking");

  return {
    qualifies: checks.consent && checks.intent && checks.search && checks.abandoned && !checks.completed,
    checks,
    reasons,
  };
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
