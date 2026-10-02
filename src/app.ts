import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { ZodError } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { pool, type Queryable } from "./db.js";
import { loadAudienceSnapshot } from "./audience-repository.js";
import { suggestTravelAudienceRules } from "./assistant.js";
import type { Customer, JourneyEvent } from "./types.js";
import { audienceQuerySchema, assistantPromptSchema, activationRequestSchema, listQuerySchema } from "./validation.js";

const destinations = [
  { id: "braze_mock", name: "Braze", type: "Customer engagement", mode: "simulation", description: "Simulated customer engagement audience sync.", icon: "✳" },
  { id: "meta_mock", name: "Meta Custom Audiences", type: "Paid media", mode: "simulation", description: "Simulated hashed-identifier audience export. No identifiers are exported.", icon: "◉" },
  { id: "webhook_mock", name: "Webhook Preview", type: "Developer endpoint", mode: "simulation", description: "Simulated downstream event delivery with count-only payload.", icon: "⌁" },
] as const;

export function createApp(database: Queryable = pool) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({
    origin: process.env.CORS_ORIGIN?.split(",").map((value) => value.trim()) ?? "http://localhost:5173",
  }));
  app.use((_request, response, next) => {
    response.setHeader("X-Request-Id", randomUUID());
    next();
  });
  app.use(express.json({ limit: "32kb" }));

  app.get("/api/health", async (_request, response, next) => {
    try {
      await database.query("SELECT 1");
      response.json({ status: "ok", service: "journey-rescue-api", database: "connected" });
    } catch {
      response.status(503).json({ status: "unavailable", service: "journey-rescue-api", database: "unavailable" });
    }
  });

  app.get("/api/dashboard", async (_request, response, next) => {
  try {
    const [profiles, events, sources] = await Promise.all([
      database.query<{ count: string }>("SELECT count(*)::text AS count FROM customers"),
      database.query<{ count: string }>("SELECT count(*)::text AS count FROM journey_events"),
      database.query("SELECT source_id, file_name, display_name, record_type, xdm_class, record_count, loaded_at FROM demo_sources ORDER BY array_position(ARRAY['crm','web','mobile','intent','bookings'], source_id)"),
    ]);
    response.json({
      profileCount: Number(profiles.rows[0]?.count ?? 0),
      eventCount: Number(events.rows[0]?.count ?? 0),
      sourceCount: sources.rowCount ?? 0,
      sources: sources.rows,
    });
  } catch (error) {
    next(error);
  }
});

  app.get("/api/audience", async (request, response, next) => {
  try {
    const parsed = audienceQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({ error: "Invalid audience settings.", details: parsed.error.flatten() });
      return;
    }
    response.json(await loadAudienceSnapshot(database, parsed.data));
  } catch (error) {
    next(error);
  }
});

  app.get("/api/profiles", async (request, response, next) => {
  try {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({ error: "Invalid profile query.", details: parsed.error.flatten() });
      return;
    }
    const { q, limit, offset } = parsed.data;
    const pattern = q ? `%${q}%` : "";
    const result = await database.query<Customer>(
      `SELECT * FROM customers
       WHERE $1 = '' OR concat_ws(' ', customer_id, first_name, last_name, email, home_airport) ILIKE $1
       ORDER BY customer_id LIMIT $2 OFFSET $3`,
      [pattern, limit, offset],
    );
    const count = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM customers
       WHERE $1 = '' OR concat_ws(' ', customer_id, first_name, last_name, email, home_airport) ILIKE $1`,
      [pattern],
    );
    response.json({ items: result.rows, total: Number(count.rows[0]?.count ?? 0), limit, offset });
  } catch (error) {
    next(error);
  }
});

  app.get("/api/profiles/:customerId", async (request, response, next) => {
  try {
    const customer = await database.query<Customer>("SELECT * FROM customers WHERE customer_id = $1", [request.params.customerId]);
    if (!customer.rows[0]) {
      response.status(404).json({ error: "Profile not found." });
      return;
    }
    const events = await database.query<JourneyEvent>(
      "SELECT event_id, customer_id, event_type, destination, session_id, occurred_at, source FROM journey_events WHERE customer_id = $1 ORDER BY occurred_at DESC",
      [request.params.customerId],
    );
    response.json({ profile: customer.rows[0], events: events.rows });
  } catch (error) {
    next(error);
  }
});

  app.get("/api/events", async (request, response, next) => {
  try {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({ error: "Invalid event query.", details: parsed.error.flatten() });
      return;
    }
    const { q, limit, offset } = parsed.data;
    const pattern = q ? `%${q}%` : "";
    const result = await database.query(
      `SELECT e.event_id, e.customer_id, e.event_type, e.destination, e.session_id, e.occurred_at, e.source,
              c.first_name, c.last_name
       FROM journey_events e JOIN customers c USING (customer_id)
       WHERE $1 = '' OR concat_ws(' ', e.customer_id, c.first_name, c.last_name, e.event_type, e.destination, e.source) ILIKE $1
       ORDER BY e.occurred_at DESC LIMIT $2 OFFSET $3`,
      [pattern, limit, offset],
    );
    const count = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM journey_events e JOIN customers c USING (customer_id)
       WHERE $1 = '' OR concat_ws(' ', e.customer_id, c.first_name, c.last_name, e.event_type, e.destination, e.source) ILIKE $1`,
      [pattern],
    );
    response.json({ items: result.rows, total: Number(count.rows[0]?.count ?? 0), limit, offset });
  } catch (error) {
    next(error);
  }
});

  app.get("/api/sources", async (_request, response, next) => {
  try {
    const result = await database.query(
      "SELECT source_id, file_name, display_name, record_type, xdm_class, record_count, loaded_at FROM demo_sources ORDER BY array_position(ARRAY['crm','web','mobile','intent','bookings'], source_id)",
    );
    response.json({ items: result.rows });
  } catch (error) {
    next(error);
  }
});

  app.post("/api/assistant/suggest", async (request, response) => {
  const parsed = assistantPromptSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid rule-assistant request.", details: parsed.error.flatten() });
    return;
  }

  const suggestion = suggestTravelAudienceRules(parsed.data.prompt, parsed.data.currentSettings);
  if (!suggestion.supported) {
    response.status(422).json({
      error: "This offline demo assistant only drafts rules for the travel journey sample.",
      supportedExample: suggestion.supportedExample,
    });
    return;
  }
  response.json(suggestion);
});

  app.get("/api/destinations", (_request, response) => {
  response.json({ items: destinations, liveConnections: false });
});

  app.get("/api/activations", async (request, response, next) => {
  try {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({ error: "Invalid activation query.", details: parsed.error.flatten() });
      return;
    }
    const { limit, offset } = parsed.data;
    const [runs, total] = await Promise.all([
      database.query(
        `SELECT activation_id, audience_name, destination_id, destination_name, status,
                qualified_count, rules, pii_transferred, created_at
         FROM activation_runs ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      database.query<{ count: string }>("SELECT count(*)::text AS count FROM activation_runs"),
    ]);
    response.json({ items: runs.rows, total: Number(total.rows[0]?.count ?? 0), limit, offset });
  } catch (error) {
    next(error);
  }
});

  app.post("/api/activations", async (request, response, next) => {
  try {
    const parsed = activationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "Invalid activation request.", details: parsed.error.flatten() });
      return;
    }
    const destination = destinations.find((item) => item.id === parsed.data.destinationId);
    if (!destination) {
      response.status(400).json({ error: "Unsupported destination." });
      return;
    }
    const idempotencyKey = request.header("Idempotency-Key");
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      response.status(400).json({
        error: "A valid Idempotency-Key header is required (8–128 safe characters).",
      });
      return;
    }
    const requestHash = createHash("sha256")
      .update(JSON.stringify(parsed.data))
      .digest("hex");
    const existing = await database.query(
      `SELECT activation_id, audience_name, destination_id, destination_name, status,
              qualified_count, rules, pii_transferred, created_at, request_hash
       FROM activation_runs WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].request_hash !== requestHash) {
        response.status(409).json({
          error: "This Idempotency-Key was already used with a different activation request.",
        });
        return;
      }
      const { request_hash: _requestHash, ...run } = existing.rows[0];
      response.status(200).json({
        run,
        message: "This idempotent activation simulation already exists; no duplicate run was created.",
        liveConnection: false,
        replayed: true,
      });
      return;
    }
    const result = await loadAudienceSnapshot(database, parsed.data.rules);
    if (!result.qualifiedCount) {
      response.status(422).json({ error: "The current audience is empty. Review the preview before activating." });
      return;
    }
    const activationId = randomUUID();
    const inserted = await database.query(
      `INSERT INTO activation_runs (
        activation_id, audience_name, destination_id, destination_name, status,
        qualified_count, rules, pii_transferred, idempotency_key, request_hash
      ) VALUES ($1,$2,$3,$4,'simulated',$5,$6::jsonb,false,$7,$8)
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
      RETURNING activation_id, audience_name, destination_id, destination_name, status,
                qualified_count, rules, pii_transferred, created_at`,
      [
        activationId,
        parsed.data.audienceName,
        destination.id,
        destination.name,
        result.qualifiedCount,
        JSON.stringify(parsed.data.rules),
        idempotencyKey,
        requestHash,
      ],
    );
    if (!inserted.rows[0]) {
      const replay = await database.query(
        `SELECT activation_id, audience_name, destination_id, destination_name, status,
                qualified_count, rules, pii_transferred, created_at, request_hash
         FROM activation_runs WHERE idempotency_key = $1`,
        [idempotencyKey],
      );
      if (!replay.rows[0]) throw new Error("Activation idempotency conflict could not be resolved.");
      if (replay.rows[0].request_hash !== requestHash) {
        response.status(409).json({
          error: "This Idempotency-Key was already used with a different activation request.",
        });
        return;
      }
      const { request_hash: _requestHash, ...run } = replay.rows[0];
      response.status(200).json({
        run,
        message: "This idempotent activation simulation already exists; no duplicate run was created.",
        liveConnection: false,
        replayed: true,
      });
      return;
    }
    response.status(201).json({
      run: inserted.rows[0],
      message: "Simulation completed. No customer identifiers or profile data were transmitted.",
      liveConnection: false,
    });
  } catch (error) {
    next(error);
  }
});

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof ZodError) {
    response.status(400).json({ error: "Invalid request.", details: error.flatten() });
    return;
  }
  const requestError = error as { type?: string; status?: number };
  if (requestError.type === "entity.too.large") {
    response.status(413).json({ error: "Request body exceeds the 32 KB limit." });
    return;
  }
  if (error instanceof SyntaxError && requestError.status === 400) {
    response.status(400).json({ error: "Request body must contain valid JSON." });
    return;
  }
  console.error("API request failed.", error);
  response.status(500).json({ error: "Internal server error." });
};
  app.use(errorHandler);
  return app;
}

export const app = createApp();
