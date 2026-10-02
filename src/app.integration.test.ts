import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { parse } from "csv-parse/sync";
import type { AddressInfo } from "node:net";
import type { QueryResultRow } from "pg";
import { evaluateCustomer } from "./audience.js";
import type { Queryable } from "./db.js";
import type { AudienceRules, Customer, JourneyEvent } from "./types.js";

process.env.DATABASE_URL ??= "postgres://journey_demo:journey_demo@127.0.0.1:1/journey_rescue_test";
const { createApp } = await import("./app.js");

function csv(fileName: string): Record<string, string>[] {
  return parse(readFileSync(new URL(`../data/${fileName}`, import.meta.url), "utf8"), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];
}

function fixtures() {
  const intentRows = csv("04_third_party_travel_intent.csv");
  const intent = new Map(intentRows.map((row) => [row.customer_id!, row]));
  const customers: Customer[] = csv("01_crm_customers.csv").map((row) => {
    const enrichment = intent.get(row.customer_id!)!;
    return {
      customer_id: row.customer_id!,
      email: row.email!,
      first_name: row.first_name!,
      last_name: row.last_name!,
      state: row.state!,
      home_airport: row.home_airport!,
      loyalty_tier: row.loyalty_tier as Customer["loyalty_tier"],
      marketing_consent: row.marketing_consent === "true",
      travel_intent_score: Number(enrichment.travel_intent_score),
      price_sensitivity_score: Number(enrichment.price_sensitivity_score),
      travel_intent_segment: enrichment.travel_intent_segment!,
      intent_updated_at: enrichment.updated_at!,
    };
  });
  const sources: [string, JourneyEvent["source"], string][] = [
    ["02_web_events.csv", "web", "session_id"],
    ["03_mobile_events.csv", "mobile", "app_session_id"],
    ["05_completed_bookings.csv", "booking", ""],
  ];
  const events: JourneyEvent[] = sources.flatMap(([fileName, source, sessionField]) =>
    csv(fileName).map((row) => ({
      event_id: row.event_id!,
      customer_id: row.customer_id!,
      event_type: row.event_type!,
      destination: row.destination!,
      session_id: sessionField ? row[sessionField] || null : null,
      occurred_at: row.event_time!,
      source,
    })),
  );
  return { customers, events };
}

class SyntheticDatabase implements Queryable {
  readonly customers: Customer[];
  readonly events: JourneyEvent[];
  readonly activations = new Map<string, Record<string, unknown>>();

  constructor() {
    ({ customers: this.customers, events: this.events } = fixtures());
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    const sql = text.replace(/\s+/g, " ").trim().toLowerCase();
    let rows: QueryResultRow[] = [];

    if (sql === "select 1") {
      rows = [{ "?column?": 1 }];
    } else if (sql.startsWith("select count(*)::text as count from customers")) {
      rows = [{ count: String(this.customers.length) }];
    } else if (sql.startsWith("select count(*)::text as count from journey_events")) {
      rows = [{ count: String(this.events.length) }];
    } else if (sql.startsWith("select source_id, file_name")) {
      rows = [
        ["crm", "01_crm_customers.csv", "CRM customers", "Profile", "XDM Individual Profile", 10],
        ["web", "02_web_events.csv", "Web events", "ExperienceEvent", "XDM ExperienceEvent", 17],
        ["mobile", "03_mobile_events.csv", "Mobile events", "ExperienceEvent", "XDM ExperienceEvent", 8],
        ["intent", "04_third_party_travel_intent.csv", "Travel intent enrichment", "Profile enrichment", "XDM Individual Profile", 10],
        ["bookings", "05_completed_bookings.csv", "Completed bookings", "ExperienceEvent", "XDM ExperienceEvent", 4],
      ].map(([source_id, file_name, display_name, record_type, xdm_class, record_count]) => ({
        source_id, file_name, display_name, record_type, xdm_class, record_count, loaded_at: "2026-09-30T00:00:00.000Z",
      }));
    } else if (sql.startsWith("select c.*")) {
      const anchor = new Date(String(values[0]));
      const days = (cutoff: unknown) => Math.round((anchor.getTime() - new Date(String(cutoff)).getTime()) / (24 * 60 * 60 * 1000));
      const rules: AudienceRules = {
        asOf: String(values[0]).slice(0, 10),
        searchDays: days(values[1]),
        abandonDays: days(values[2]),
        bookingDays: days(values[3]),
      };
      rows = this.customers.map((customer) => {
        const evaluation = evaluateCustomer(customer, this.events, rules);
        return {
          ...customer,
          has_recent_search: evaluation.checks.search,
          has_recent_abandonment: evaluation.checks.abandoned,
          has_recent_booking: evaluation.checks.completed,
        };
      });
    } else if (sql.startsWith("select event_id, customer_id, event_type")) {
      rows = sql.includes("where customer_id = $1")
        ? this.events.filter((event) => event.customer_id === values[0])
        : this.events;
    } else if (sql.startsWith("select * from customers where customer_id = $1")) {
      rows = this.customers.filter((customer) => customer.customer_id === values[0]);
    } else if (sql.startsWith("select * from customers") && sql.includes("concat_ws")) {
      const [pattern, limit, offset] = values as [string, number, number];
      const query = pattern.replaceAll("%", "").toLowerCase();
      rows = this.customers.filter((customer) =>
        !query || `${customer.customer_id} ${customer.first_name} ${customer.last_name} ${customer.email} ${customer.home_airport}`.toLowerCase().includes(query),
      ).sort((a, b) => a.customer_id.localeCompare(b.customer_id)).slice(offset, offset + limit);
    } else if (sql.startsWith("select e.event_id")) {
      rows = this.events.map((event) => {
        const profile = this.customers.find((customer) => customer.customer_id === event.customer_id)!;
        return { ...event, first_name: profile.first_name, last_name: profile.last_name };
      });
    } else if (sql.startsWith("select count(*)::text as count from journey_events e")) {
      rows = [{ count: String(this.events.length) }];
    } else if (sql.startsWith("select activation_id") && sql.includes("where idempotency_key = $1")) {
      const activation = this.activations.get(String(values[0]));
      rows = activation ? [activation] : [];
    } else if (sql.startsWith("select activation_id") && sql.includes("from activation_runs order by")) {
      rows = [...this.activations.values()];
    } else if (sql.startsWith("select count(*)::text as count from activation_runs")) {
      rows = [{ count: String(this.activations.size) }];
    } else if (sql.startsWith("insert into activation_runs")) {
      const [activation_id, audience_name, destination_id, destination_name, qualified_count, rules, idempotency_key, request_hash] = values as [
        string, string, string, string, number, string, string, string,
      ];
      if (!this.activations.has(idempotency_key)) {
        const activation = {
          activation_id,
          audience_name,
          destination_id,
          destination_name,
          status: "simulated",
          qualified_count,
          rules: JSON.parse(rules),
          pii_transferred: false,
          idempotency_key,
          request_hash,
          created_at: "2026-09-30T00:00:00.000Z",
        };
        this.activations.set(idempotency_key, activation);
        const { idempotency_key: _key, request_hash: _hash, ...publicRun } = activation;
        rows = [publicRun];
      }
    } else {
      throw new Error(`Integration test database received unsupported SQL: ${sql}`);
    }

    return { rows: rows as T[], rowCount: rows.length };
  }
}

const database = new SyntheticDatabase();
const server = createApp(database).listen(0, "127.0.0.1");
const baseUrl = await new Promise<string>((resolve) => {
  server.once("listening", () => {
    const address = server.address() as AddressInfo;
    resolve(`http://127.0.0.1:${address.port}`);
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

describe("HTTP API integration against the bundled synthetic CSV fixtures", () => {
  it("serves health with request correlation and security headers", async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);
    assert.equal(response.headers.get("x-powered-by"), null);
    assert.deepEqual(await response.json(), {
      status: "ok",
      service: "journey-rescue-api",
      database: "connected",
    });
  });

  it("returns the documented qualified IDs from the real CSV fixtures", async () => {
    const response = await fetch(`${baseUrl}/api/audience?asOf=2026-09-30&searchDays=14&abandonDays=14&bookingDays=7`);
    const result = await response.json() as { qualifiedCustomerIds: string[]; qualifiedCount: number; excludedCount: number };
    assert.equal(response.status, 200);
    assert.deepEqual(result.qualifiedCustomerIds, ["C003", "C006", "C008", "C010"]);
    assert.equal(result.qualifiedCount, 4);
    assert.equal(result.excludedCount, 6);
  });

  it("rejects malformed audience query settings before data evaluation", async () => {
    const response = await fetch(`${baseUrl}/api/audience?searchDays=366`);
    assert.equal(response.status, 400);
    assert.match((await response.json() as { error: string }).error, /Invalid audience settings/);
  });

  it("rejects malformed JSON and oversized request bodies with client errors", async () => {
    const invalidJson = await fetch(`${baseUrl}/api/assistant/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    assert.equal(invalidJson.status, 400);

    const oversized = await fetch(`${baseUrl}/api/assistant/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "x".repeat(40_000) }),
    });
    assert.equal(oversized.status, 413);
  });

  it("drafts a clearly identified offline suggestion and rejects unsupported domains", async () => {
    const suggestion = await fetch(`${baseUrl}/api/assistant/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "Travelers searched in the last 21 days and abandoned in the last 10 days with no booking in the last 5 days",
      }),
    });
    assert.equal(suggestion.status, 200);
    const suggestionBody = await suggestion.json() as { mode: string; requiresHumanReview: boolean; rules: { searchDays: number; abandonDays: number; bookingDays: number } };
    assert.equal(suggestionBody.mode, "offline-demo-heuristic");
    assert.equal(suggestionBody.requiresHumanReview, true);
    assert.deepEqual(suggestionBody.rules, { asOf: "2026-09-30", searchDays: 21, abandonDays: 10, bookingDays: 5 });

    const unsupported = await fetch(`${baseUrl}/api/assistant/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Find customers who like indoor plants" }),
    });
    assert.equal(unsupported.status, 422);
  });

  it("requires an idempotency key before any activation is recorded", async () => {
    const response = await fetch(`${baseUrl}/api/activations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destinationId: "braze_mock",
        rules: { asOf: "2026-09-30", searchDays: 14, abandonDays: 14, bookingDays: 7 },
        confirmSimulation: true,
      }),
    });
    assert.equal(response.status, 400);
    assert.equal(database.activations.size, 0);
  });

  it("records one count-only activation and replays an identical idempotent request", async () => {
    const payload = {
      destinationId: "braze_mock",
      audienceName: "Journey Rescue — High-Intent Abandoners",
      rules: { asOf: "2026-09-30", searchDays: 14, abandonDays: 14, bookingDays: 7 },
      confirmSimulation: true,
    };
    const send = () => fetch(`${baseUrl}/api/activations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "demo-run-0001" },
      body: JSON.stringify(payload),
    });
    const created = await send();
    assert.equal(created.status, 201);
    const createdBody = await created.json() as { run: Record<string, unknown>; liveConnection: boolean; message: string };
    assert.equal(createdBody.liveConnection, false);
    assert.equal(createdBody.run.qualified_count, 4);
    assert.equal(createdBody.run.pii_transferred, false);
    assert.equal(JSON.stringify(createdBody).includes("@example.com"), false);
    assert.equal(JSON.stringify(createdBody).includes("C003"), false);

    const replay = await send();
    assert.equal(replay.status, 200);
    const replayBody = await replay.json() as { run: Record<string, unknown>; replayed: boolean };
    assert.equal(replayBody.replayed, true);
    assert.equal(replayBody.run.activation_id, createdBody.run.activation_id);
    assert.equal(database.activations.size, 1);
  });

  it("rejects reuse of an idempotency key with a different request", async () => {
    const response = await fetch(`${baseUrl}/api/activations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "demo-run-0001" },
      body: JSON.stringify({
        destinationId: "meta_mock",
        audienceName: "Journey Rescue — High-Intent Abandoners",
        rules: { asOf: "2026-09-30", searchDays: 14, abandonDays: 14, bookingDays: 7 },
        confirmSimulation: true,
      }),
    });
    assert.equal(response.status, 409);
  });

  it("serves profile detail and returns a clear not-found response", async () => {
    const profileResponse = await fetch(`${baseUrl}/api/profiles/C003`);
    assert.equal(profileResponse.status, 200);
    const profileBody = await profileResponse.json() as { profile: Customer; events: JourneyEvent[] };
    assert.equal(profileBody.profile.customer_id, "C003");
    assert.ok(profileBody.events.length > 0);

    const missing = await fetch(`${baseUrl}/api/profiles/C999`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json() as { error: string }).error, "Profile not found.");
  });
});
