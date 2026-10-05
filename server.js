require("dotenv").config();

const app = require("./app");
const { pool } = require("./server/db/connection");
const { ensureDatabaseSchema } = require("./server/db/migrate");

const port = Number(process.env.PORT) || 5000;
let server;

async function start() {
  try {
    await ensureDatabaseSchema();
    server = app.listen(port, () => {
      console.log(`Murmur is running at http://localhost:${port}`);
      if (!pool) console.log("Database is not configured: set DB_HOST, DB_USER, DB_PASSWORD and DB_NAME in .env.");
    });
  } catch (error) {
    console.error("Database setup failed:", error.message);
    process.exitCode = 1;
    if (pool) await pool.end();
  }
}

start();

async function shutdown() {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (pool) await pool.end();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
