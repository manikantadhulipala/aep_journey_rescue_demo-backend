import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "./db.js";

try {
  const migrationPath = path.resolve(process.cwd(), "sql/001_init.sql");
  const migration = await readFile(migrationPath, "utf8");
  await pool.query(migration);
  console.log(`Applied ${migrationPath}.`);
} catch (error) {
  console.error("Database migration failed.", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
