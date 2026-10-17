import "dotenv/config";
import app from "./app.js";
import { connectDatabase,  disconnectDatabase } from "./config/database.js";
import { closeRedisConnection } from "./config/queue.js";
import { closeTransactionQueue } from "./queues/transaction.queue.js";

const port = Number.parseInt(process.env.PORT || "3000", 10);
let server;
let isShuttingDown = false;

async function startServer() {
  try {
    await connectDatabase();

    server = app.listen(port, () => {
      console.log(`API listening on port ${port}`);
    });
  } catch (error) {
    console.error("API startup failed:", error.message);
    process.exitCode = 1;
  }
}

async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`${signal} received; shutting down`);

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }

  await Promise.allSettled([
    closeTransactionQueue(),
    closeRedisConnection(),
    disconnectDatabase()
  ]);

  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

startServer();
