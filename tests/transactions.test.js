import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import { closeRedisConnection } from "../src/config/queue.js";
import { closeTransactionQueue } from "../src/queues/transaction.queue.js";
import Transaction from "../src/models/Transaction.js";

const enabled = process.env.RUN_INTEGRATION_TESTS === "true";

test("health endpoint returns HEALTHY and an ISO timestamp", async (t) => {
  if (!enabled) return t.skip("Set RUN_INTEGRATION_TESTS=true to run integration tests");
  const response = await request(app).get("/");
  assert.equal(response.status, 200);
  assert.equal(response.body.status, "HEALTHY");
  assert.ok(!Number.isNaN(Date.parse(response.body.current_time)));
});

test("invalid webhook payload is rejected", async (t) => {
  if (!enabled) return t.skip("Set RUN_INTEGRATION_TESTS=true to run integration tests");
  const response = await request(app)
    .post("/v1/webhooks/transactions")
    .send({ transaction_id: "missing-fields" });
  assert.equal(response.status, 400);
});

test("webhook is accepted quickly and duplicate deliveries create one record", async (t) => {
  if (!enabled) return t.skip("Set RUN_INTEGRATION_TESTS=true to run integration tests");

  await connectDatabase();
  const id = `test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const payload = {
    transaction_id: id,
    source_account: "acc_test_source",
    destination_account: "acc_test_destination",
    amount: 1500,
    currency: "INR"
  };

  try {
    const start = Date.now();
    const first = await request(app).post("/v1/webhooks/transactions").send(payload);
    const elapsed = Date.now() - start;

    assert.equal(first.status, 202);
    assert.ok(elapsed < 500, `Webhook took ${elapsed}ms (expected under 500ms)`);

    const duplicate = await request(app).post("/v1/webhooks/transactions").send(payload);
    assert.equal(duplicate.status, 202);

    const records = await Transaction.find({ transaction_id: id });
    assert.equal(records.length, 1);
    assert.equal(records[0].status, "PROCESSING");

    const status = await request(app).get(`/v1/transactions/${id}`);
    assert.equal(status.status, 200);
    assert.equal(status.body[0].status, "PROCESSING");
  } finally {
    // Clean up test data and any pending job.
    await Transaction.deleteOne({ transaction_id: id });
    const queue = (await import("../src/queues/transaction.queue.js")).getTransactionQueue();
    const safeId = Buffer.from(id, "utf8").toString("base64url");
    const job = await queue.getJob(`transaction-${safeId}`);
    if (job) await job.remove().catch(() => {});
    await closeTransactionQueue();
    await closeRedisConnection();
    await disconnectDatabase();
  }
});

test("unknown transaction returns 404", async (t) => {
  if (!enabled) return t.skip("Set RUN_INTEGRATION_TESTS=true to run integration tests");

  await connectDatabase();

  try {
    const response = await request(app).get(
      "/v1/transactions/definitely_missing_transaction"
    );
    assert.equal(response.status, 404);
  } finally {
    await disconnectDatabase();
  }
});
