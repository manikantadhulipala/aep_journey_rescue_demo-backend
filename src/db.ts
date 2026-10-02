import pg from "pg";
import type { QueryResultRow } from "pg";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and configure PostgreSQL.");
}

pg.types.setTypeParser(1700, (value) => Number.parseFloat(value));

export const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error.", error);
});
