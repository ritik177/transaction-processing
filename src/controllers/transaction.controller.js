import mongoose from "mongoose";
import Transaction from "../models/Transaction.js";
import { enqueueTransaction } from "../queues/transaction.queue.js";

const requiredStringFields = [
  "transaction_id",
  "source_account",
  "destination_account",
  "currency"
];

function validatePayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Request body must be a JSON object";
  }

  for (const field of requiredStringFields) {
    if (typeof body[field] !== "string" || body[field].trim() === "") {
      return `${field} must be a non-empty string`;
    }
  }

  if (typeof body.amount !== "number" || !Number.isFinite(body.amount) || body.amount < 0) {
    return "amount must be a finite number greater than or equal to zero";
  }

  if (!/^[A-Za-z]{3}$/.test(body.currency.trim())) {
    return "currency must be a three-letter currency code";
  }

  return null;
}

export async function receiveTransactionWebhook(req, res, next) {
  const validationError = validatePayload(req.body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const payload = {
    transaction_id: req.body.transaction_id.trim(),
    source_account: req.body.source_account.trim(),
    destination_account: req.body.destination_account.trim(),
    amount: req.body.amount,
    currency: req.body.currency.trim().toUpperCase()
  };

  try {
    let transaction;
    let wasCreated = false;

    try {
      transaction = await Transaction.create({
        ...payload,
        status: "PROCESSING",
        created_at: new Date(),
        processed_at: null
      });
      wasCreated = true;
    } catch (error) {
      if (error?.code !== 11000) throw error;

      // Duplicate delivery: do not create a second transaction. Re-enqueue PROCESSING
      // records so a previous DB-write/queue-write interruption can self-heal.
      transaction = await Transaction.findOne({
        transaction_id: payload.transaction_id
      });

      if (!transaction) throw error;
      if (transaction.status === "PROCESSED") {
        return res.status(202).json({
          message: "Webhook already processed",
          transaction_id: transaction.transaction_id,
          status: transaction.status
        });
      }
      if (transaction.status === "FAILED") {
        return res.status(409).json({
          error: "Transaction previously failed; manual review is required",
          transaction_id: transaction.transaction_id,
          status: transaction.status
        });
      }
    }

    try {
      // Stable job ID deduplicates queue entries. This is awaited so we only acknowledge
      // once the queue has accepted the job.
      await enqueueTransaction(transaction.transaction_id);
    } catch (queueError) {
      // Keep the database record: a later duplicate delivery can attempt to enqueue again.
      console.error("Could not enqueue transaction:", queueError.message);
      return res.status(503).json({
        error: "Transaction was recorded but processing could not be scheduled; retry webhook",
        transaction_id: transaction.transaction_id
      });
    }

    return res.status(202).json({
      message: wasCreated ? "Webhook accepted" : "Webhook already accepted",
      transaction_id: transaction.transaction_id,
      status: transaction.status
    });
  } catch (error) {
    return next(error);
  }
}

export async function getTransactionStatus(req, res, next) {
  try {
    const transaction = await Transaction.findOne({
      transaction_id: req.params.transaction_id
    }).lean();

    if (!transaction) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    return res.status(200).json([
      {
        transaction_id: transaction.transaction_id,
        source_account: transaction.source_account,
        destination_account: transaction.destination_account,
        amount: transaction.amount,
        currency: transaction.currency,
        status: transaction.status,
        created_at: transaction.created_at,
        processed_at: transaction.processed_at,
        ...(transaction.last_error ? { last_error: transaction.last_error } : {})
      }
    ]);
  } catch (error) {
    return next(error);
  }
}

export function healthCheck(req, res) {
  res.status(200).json({
    status: "HEALTHY",
    current_time: new Date().toISOString()
  });
}

export { validatePayload };
