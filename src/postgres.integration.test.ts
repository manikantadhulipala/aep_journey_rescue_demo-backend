import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { AddressInfo } from "node:net";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  describe("PostgreSQL integration", { skip: "Set TEST_DATABASE_URL to a disposable migrated and seeded PostgreSQL database." }, () => {
    it("runs against a real PostgreSQL database", () => {});
  });
} else {
  process.env.DATABASE_URL = databaseUrl;
  const [{ createApp }, { pool }] = await Promise.all([
    import("./app.js"),
    import("./db.js"),
  ]);
  const server = createApp(pool).listen(0, "127.0.0.1");
  const baseUrl = await new Promise<string>((resolve) => {
    server.once("listening", () => {
      const address = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
  const idempotencyKey = `pg-test-${crypto.randomUUID()}`;

  after(async () => {
    await pool.query("DELETE FROM activation_runs WHERE idempotency_key = $1", [idempotencyKey]);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await pool.end();
  });

  describe("real PostgreSQL query, schema and uniqueness behavior", () => {
    it("uses indexed database-side event predicates to return the expected audience", async () => {
      const response = await fetch(`${baseUrl}/api/audience?asOf=2026-09-30&searchDays=14&abandonDays=14&bookingDays=7`);
      assert.equal(response.status, 200);
      const result = await response.json() as { qualifiedCustomerIds: string[]; qualifiedCount: number };
      assert.deepEqual(result.qualifiedCustomerIds, ["C003", "C006", "C008", "C010"]);
      assert.equal(result.qualifiedCount, 4);
    });

    it("creates an activation record without PII and safely replays a concurrent retry", async () => {
      const payload = {
        destinationId: "braze_mock",
        audienceName: "PostgreSQL integration test",
        rules: { asOf: "2026-09-30", searchDays: 14, abandonDays: 14, bookingDays: 7 },
        confirmSimulation: true,
      };
      const send = () => fetch(`${baseUrl}/api/activations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(payload),
      });
      const responses = await Promise.all([send(), send()]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
      const bodies = await Promise.all(responses.map((response) => response.json())) as {
        run: { activation_id: string; qualified_count: number; pii_transferred: boolean };
      }[];
      assert.equal(bodies[0]?.run.activation_id, bodies[1]?.run.activation_id);
      assert.equal(bodies[0]?.run.qualified_count, 4);
      assert.equal(bodies[0]?.run.pii_transferred, false);

      const stored = await pool.query(
        "SELECT qualified_count, pii_transferred, idempotency_key FROM activation_runs WHERE idempotency_key = $1",
        [idempotencyKey],
      );
      assert.equal(stored.rowCount, 1);
      assert.equal(stored.rows[0]?.qualified_count, 4);
      assert.equal(stored.rows[0]?.pii_transferred, false);
    });
  });
}
