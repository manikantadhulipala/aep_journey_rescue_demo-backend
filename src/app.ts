import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { ZodError } from "zod";
import { pool } from "./db.js";
import { evaluateAudience } from "./audience.js";
import type { Customer, JourneyEvent } from "./types.js";
import { audienceQuerySchema, listQuerySchema } from "./validation.js";

export const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(",").map((value) => value.trim()) ?? "http://localhost:5173",
}));
app.use(express.json({ limit: "32kb" }));

app.get("/api/health", async (_request, response, next) => {
  try {
    await pool.query("SELECT 1");
    response.json({ status: "ok", service: "journey-rescue-api", database: "connected" });
  } catch (error) {
    next(error);
  }
});

app.get("/api/dashboard", async (_request, response, next) => {
  try {
    const [profiles, events, sources] = await Promise.all([
      pool.query<{ count: string }>("SELECT count(*)::text AS count FROM customers"),
      pool.query<{ count: string }>("SELECT count(*)::text AS count FROM journey_events"),
      pool.query("SELECT source_id, file_name, display_name, record_type, xdm_class, record_count, loaded_at FROM demo_sources ORDER BY array_position(ARRAY['crm','web','mobile','intent','bookings'], source_id)"),
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
    const [customers, events] = await Promise.all([
      pool.query<Customer>("SELECT * FROM customers ORDER BY customer_id"),
      pool.query<JourneyEvent>("SELECT event_id, customer_id, event_type, destination, session_id, occurred_at, source FROM journey_events"),
    ]);
    response.json(evaluateAudience(customers.rows, events.rows, parsed.data));
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
    const result = await pool.query<Customer>(
      `SELECT * FROM customers
       WHERE $1 = '' OR concat_ws(' ', customer_id, first_name, last_name, email, home_airport) ILIKE $1
       ORDER BY customer_id LIMIT $2 OFFSET $3`,
      [pattern, limit, offset],
    );
    const count = await pool.query<{ count: string }>(
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
    const customer = await pool.query<Customer>("SELECT * FROM customers WHERE customer_id = $1", [request.params.customerId]);
    if (!customer.rows[0]) {
      response.status(404).json({ error: "Profile not found." });
      return;
    }
    const events = await pool.query<JourneyEvent>(
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
    const result = await pool.query(
      `SELECT e.event_id, e.customer_id, e.event_type, e.destination, e.session_id, e.occurred_at, e.source,
              c.first_name, c.last_name
       FROM journey_events e JOIN customers c USING (customer_id)
       WHERE $1 = '' OR concat_ws(' ', e.customer_id, c.first_name, c.last_name, e.event_type, e.destination, e.source) ILIKE $1
       ORDER BY e.occurred_at DESC LIMIT $2 OFFSET $3`,
      [pattern, limit, offset],
    );
    const count = await pool.query<{ count: string }>(
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
    const result = await pool.query(
      "SELECT source_id, file_name, display_name, record_type, xdm_class, record_count, loaded_at FROM demo_sources ORDER BY array_position(ARRAY['crm','web','mobile','intent','bookings'], source_id)",
    );
    response.json({ items: result.rows });
  } catch (error) {
    next(error);
  }
});

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof ZodError) {
    response.status(400).json({ error: "Invalid request.", details: error.flatten() });
    return;
  }
  console.error("API request failed.", error);
  response.status(500).json({ error: "Internal server error." });
};
app.use(errorHandler);
