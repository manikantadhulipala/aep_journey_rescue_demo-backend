import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { pool } from "./db.js";

interface CsvRecord {
  [key: string]: string;
}

const directory = path.resolve(process.cwd(), process.env.DEMO_DATA_DIR ?? "./data");
const sourceFiles = {
  crm: "01_crm_customers.csv",
  web: "02_web_events.csv",
  mobile: "03_mobile_events.csv",
  intent: "04_third_party_travel_intent.csv",
  bookings: "05_completed_bookings.csv",
} as const;

async function readCsv(fileName: string): Promise<CsvRecord[]> {
  const content = await readFile(path.join(directory, fileName), "utf8");
  const records = parse(content, { columns: true, skip_empty_lines: true, trim: true }) as CsvRecord[];
  if (!records.length) throw new Error(`${fileName} contains no data rows.`);
  return records;
}

function required(record: CsvRecord, field: string, fileName: string): string {
  const value = record[field];
  if (!value) throw new Error(`Missing ${field} in ${fileName}.`);
  return value;
}

async function seed() {
  const [customers, web, mobile, intent, bookings] = await Promise.all([
    readCsv(sourceFiles.crm),
    readCsv(sourceFiles.web),
    readCsv(sourceFiles.mobile),
    readCsv(sourceFiles.intent),
    readCsv(sourceFiles.bookings),
  ]);
  const intentById = new Map(intent.map((record) => [required(record, "customer_id", sourceFiles.intent), record]));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const profile of customers) {
      const id = required(profile, "customer_id", sourceFiles.crm);
      const enrichment = intentById.get(id);
      if (!enrichment) throw new Error(`No travel intent enrichment found for ${id}.`);
      const score = Number(required(enrichment, "travel_intent_score", sourceFiles.intent));
      const sensitivity = Number(required(enrichment, "price_sensitivity_score", sourceFiles.intent));
      if (!Number.isFinite(score) || score < 0 || score > 1 || !Number.isFinite(sensitivity) || sensitivity < 0 || sensitivity > 1) {
        throw new Error(`Invalid travel intent score for ${id}.`);
      }
      await client.query(
        `INSERT INTO customers (
          customer_id, email, first_name, last_name, state, home_airport, loyalty_tier,
          marketing_consent, travel_intent_score, price_sensitivity_score, travel_intent_segment, intent_updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (customer_id) DO UPDATE SET
          email=EXCLUDED.email, first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name,
          state=EXCLUDED.state, home_airport=EXCLUDED.home_airport, loyalty_tier=EXCLUDED.loyalty_tier,
          marketing_consent=EXCLUDED.marketing_consent, travel_intent_score=EXCLUDED.travel_intent_score,
          price_sensitivity_score=EXCLUDED.price_sensitivity_score, travel_intent_segment=EXCLUDED.travel_intent_segment,
          intent_updated_at=EXCLUDED.intent_updated_at, updated_at=now()`,
        [
          id,
          required(profile, "email", sourceFiles.crm),
          required(profile, "first_name", sourceFiles.crm),
          required(profile, "last_name", sourceFiles.crm),
          required(profile, "state", sourceFiles.crm),
          required(profile, "home_airport", sourceFiles.crm),
          required(profile, "loyalty_tier", sourceFiles.crm),
          required(profile, "marketing_consent", sourceFiles.crm).toLowerCase() === "true",
          score,
          sensitivity,
          required(enrichment, "travel_intent_segment", sourceFiles.intent),
          required(enrichment, "updated_at", sourceFiles.intent),
        ],
      );
    }

    await client.query("DELETE FROM journey_events");
    const eventSources = [
      { id: "web", type: "web", rows: web, file: sourceFiles.web, sessionField: "session_id" },
      { id: "mobile", type: "mobile", rows: mobile, file: sourceFiles.mobile, sessionField: "app_session_id" },
      { id: "bookings", type: "booking", rows: bookings, file: sourceFiles.bookings, sessionField: null },
    ] as const;
    for (const source of eventSources) {
      for (const record of source.rows) {
        await client.query(
          `INSERT INTO journey_events (event_id, customer_id, event_type, destination, session_id, occurred_at, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            required(record, "event_id", source.file),
            required(record, "customer_id", source.file),
            required(record, "event_type", source.file),
            required(record, "destination", source.file),
            source.sessionField ? record[source.sessionField] || null : null,
            required(record, "event_time", source.file),
            source.type,
          ],
        );
      }
    }

    const counts: Record<string, number> = {
      crm: customers.length,
      web: web.length,
      mobile: mobile.length,
      intent: intent.length,
      bookings: bookings.length,
    };
    for (const [sourceId, count] of Object.entries(counts)) {
      await client.query(
        "UPDATE demo_sources SET record_count = $2, loaded_at = now() WHERE source_id = $1",
        [sourceId, count],
      );
    }
    await client.query("COMMIT");
    console.log(`Seeded ${customers.length} customers and ${web.length + mobile.length + bookings.length} journey events from ${directory}.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((error: unknown) => {
  console.error("Seed failed; transaction rolled back.", error);
  process.exitCode = 1;
  void pool.end();
});
