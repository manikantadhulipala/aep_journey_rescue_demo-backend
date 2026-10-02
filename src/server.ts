import "dotenv/config";
import { app } from "./app.js";
import { pool } from "./db.js";

const port = Number.parseInt(process.env.PORT ?? "4000", 10);
const server = app.listen(port, () => {
  console.log(`Journey Rescue API listening on http://localhost:${port}`);
});

async function shutdown(signal: string) {
  console.log(`${signal} received; shutting down gracefully.`);
  server.close(async (error) => {
    await pool.end();
    if (error) {
      console.error("HTTP server failed to close cleanly.", error);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
