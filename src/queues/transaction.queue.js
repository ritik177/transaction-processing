import { Queue } from "bullmq";
import { getRedisConnection } from "../config/queue.js";

export const QUEUE_NAME =
  process.env.QUEUE_NAME || "transaction-processing";

let transactionQueue;

export function getTransactionQueue() {
  if (!transactionQueue) {
    transactionQueue = new Queue(QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: Number.parseInt(process.env.JOB_ATTEMPTS || "3", 10),
        backoff: {
          type: "exponential",
          delay: Number.parseInt(process.env.JOB_BACKOFF_MS || "2000", 10)
        },
        removeOnComplete: { age: 24 * 60 * 60, count: 10000 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 10000 }
      }
    });
  }

  return transactionQueue;
}

export async function enqueueTransaction(transactionId) {
  const queue = getTransactionQueue();
  const safeId = Buffer.from(transactionId).toString("base64url");

  // Don't wait indefinitely if Redis is unavailable.
  return Promise.race([
    queue.add(
      "process-transaction",
      { transactionId },
      { jobId: `transaction-${safeId}` }
    ),
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error("Redis queue operation timed out"));
      }, 2000);
    })
  ]);
}

export async function closeTransactionQueue() {
  if (transactionQueue) {
    await transactionQueue.close();
    transactionQueue = null;
  }
}