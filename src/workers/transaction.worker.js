import "dotenv/config";
import { Worker } from "bullmq";
import { connectDatabase } from "../config/database.js";
import {
  closeRedisConnection,
  getRedisConnection
} from "../config/queue.js";
import Transaction from "../models/Transaction.js";
import { QUEUE_NAME } from "../queues/transaction.queue.js";

const delayMs = Math.max(
  0,
  Number.parseInt(process.env.PROCESSING_DELAY_MS || "30000", 10)
);

const concurrency = Math.max(
  1,
  Number.parseInt(process.env.WORKER_CONCURRENCY || "5", 10)
);

await connectDatabase();

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { transactionId } = job.data;

    const transaction = await Transaction.findOne({
      transaction_id: transactionId
    });

    if (!transaction) {
      throw new Error(`Transaction ${transactionId} was not found`);
    }

    // Avoid processing a transaction that has already completed.
    if (transaction.status === "PROCESSED") {
      return {
        transactionId,
        status: "PROCESSED"
      };
    }

    if (transaction.status === "FAILED") {
      return {
        transactionId,
        status: "FAILED"
      };
    }

    // Simulate an external API call that takes 30 seconds.
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    const updatedTransaction = await Transaction.findOneAndUpdate(
      {
        transaction_id: transactionId,
        status: "PROCESSING"
      },
      {
        $set: {
          status: "PROCESSED",
          processed_at: new Date(),
          last_error: null
        }
      },
      { new: true }
    );

    return {
      transactionId,
      status: updatedTransaction?.status || "already-updated"
    };
  },
  {
    connection: getRedisConnection(),
    concurrency
  }
);

worker.on("completed", (job, result) => {
  console.log(`Job ${job.id} completed`, result);
});

worker.on("failed", async (job, error) => {
  console.error(`Job ${job?.id || "unknown"} failed:`, error.message);

  // Mark the transaction as FAILED after the final retry.
  if (job && job.attemptsMade >= (job.opts.attempts || 1)) {
    const transactionId = job.data?.transactionId;

    if (transactionId) {
      await Transaction.updateOne(
        {
          transaction_id: transactionId,
          status: "PROCESSING"
        },
        {
          $set: {
            status: "FAILED",
            last_error: error.message.slice(0, 1000)
          }
        }
      ).catch((dbError) => {
        console.error(
          "Could not record transaction failure:",
          dbError.message
        );
      });
    }
  }
});

worker.on("error", (error) => {
  console.error("Worker error:", error.message);
});

console.log(
  `Worker started; queue=${QUEUE_NAME}, concurrency=${concurrency}, delay=${delayMs}ms`
);

async function shutdown(signal) {
  console.log(`${signal} received, closing worker`);

  await worker.close();
  await closeRedisConnection();

  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
