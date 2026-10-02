import type { QueryResultRow } from "pg";
import { evaluationFromChecks, type AudienceCheckRow } from "./audience.js";
import type { Queryable } from "./db.js";
import type { AudienceRules } from "./types.js";

export async function loadAudienceSnapshot(database: Queryable, rules: AudienceRules) {
  const anchor = new Date(`${rules.asOf}T23:59:59.999Z`);
  const cutoff = (days: number) => new Date(anchor.getTime() - days * 24 * 60 * 60 * 1000);
  const result = await database.query<AudienceCheckRow & QueryResultRow>(
    `SELECT c.*,
       EXISTS (
         SELECT 1 FROM journey_events e
         WHERE e.customer_id = c.customer_id
           AND e.event_type = 'flight_search'
           AND e.occurred_at >= $2::timestamptz
           AND e.occurred_at <= $1::timestamptz
       ) AS has_recent_search,
       EXISTS (
         SELECT 1 FROM journey_events e
         WHERE e.customer_id = c.customer_id
           AND e.event_type = 'booking_abandoned'
           AND e.occurred_at >= $3::timestamptz
           AND e.occurred_at <= $1::timestamptz
       ) AS has_recent_abandonment,
       EXISTS (
         SELECT 1 FROM journey_events e
         WHERE e.customer_id = c.customer_id
           AND e.event_type = 'booking_completed'
           AND e.occurred_at >= $4::timestamptz
           AND e.occurred_at <= $1::timestamptz
       ) AS has_recent_booking
     FROM customers c
     ORDER BY c.customer_id`,
    [anchor.toISOString(), cutoff(rules.searchDays).toISOString(), cutoff(rules.abandonDays).toISOString(), cutoff(rules.bookingDays).toISOString()],
  );

  const profiles = result.rows.map((profile) => ({
    ...profile,
    audience: evaluationFromChecks(profile),
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
