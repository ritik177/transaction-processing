# Transaction Webhook Service

A Node.js + Express backend assessment implementation using MongoDB for durable transaction records and Redis + BullMQ for background processing.

## Features

- `POST /v1/webhooks/transactions` accepts a webhook and returns `202 Accepted`.
- `GET /` health check.
- `GET /v1/transactions/:transaction_id` retrieves transaction status.
- Background worker simulates external processing with a 30-second delay.
- MongoDB unique index enforces one record per `transaction_id`.
- BullMQ stable job IDs reduce duplicate queue jobs.
- Worker status checks prevent already-processed transactions from being processed again.
- Queue retries and terminal failure status are recorded.
- Integration tests cover health, validation, latency, duplicate delivery, and missing records.

## Architecture

1. The API validates the webhook payload.
2. It inserts the transaction in MongoDB with status `PROCESSING`.
3. It enqueues a BullMQ job with a deterministic job ID.
4. It returns `202 Accepted` after the database and queue accept the work.
5. The worker waits for `PROCESSING_DELAY_MS` (30 seconds by default), simulates success, and updates the transaction to `PROCESSED`.
6. Clients can poll the status endpoint.

MongoDB is the source of truth for transaction state. Redis/BullMQ stores background work. The API and worker use the same repository but run as separate processes.

## Requirements

- Node.js 20+
- MongoDB Atlas or a local MongoDB instance
- Redis 6.2+ (managed Redis recommended for deployment)

## Local setup

```bash
git clone <your-public-repository-url>
cd transaction-webhook-service
npm install
cp .env.example .env
```

Edit `.env` and set valid `MONGODB_URI` and `REDIS_URL` values.

Run MongoDB and Redis locally, or use managed instances.

Start the API in one terminal:

```bash
npm run dev
```

Start the worker in another terminal:

```bash
npm run dev:worker
```

The API listens on `http://localhost:3000` by default.

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `NODE_ENV` | Runtime environment | `development` |
| `PORT` | HTTP port | `3000` |
| `MONGODB_URI` | MongoDB connection URI | Required |
| `REDIS_URL` | Redis connection URI | Required |
| `QUEUE_NAME` | BullMQ queue name | `transaction-processing` |
| `PROCESSING_DELAY_MS` | Simulated processing delay | `30000` |
| `WORKER_CONCURRENCY` | Worker concurrency | `5` |
| `JOB_ATTEMPTS` | Maximum queue attempts | `3` |
| `JOB_BACKOFF_MS` | Initial exponential retry delay | `2000` |

## API

### 1. Health check

```bash
curl -i http://localhost:3000/
```

Example response:

```json
{
  "status": "HEALTHY",
  "current_time": "2026-10-15T14:00:00.000Z"
}
```

### 2. Submit transaction webhook

```bash
curl -i -X POST http://localhost:3000/v1/webhooks/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "transaction_id": "txn_abc123def456",
    "source_account": "acc_user_789",
    "destination_account": "acc_merchant_456",
    "amount": 1500,
    "currency": "INR"
  }'
```

Successful response (HTTP `202`):

```json
{
  "message": "Webhook accepted",
  "transaction_id": "txn_abc123def456",
  "status": "PROCESSING"
}
```

A duplicate of a transaction that is still processing is acknowledged without creating a second record or a second deterministic queue job. Invalid payloads return `400`. If queue scheduling fails, the API returns `503` so the sender can retry; the existing database record is retained and a retry can attempt to enqueue it.

### 3. Query transaction status

```bash
curl -i http://localhost:3000/v1/transactions/txn_abc123def456
```

Initially, `status` is `PROCESSING` and `processed_at` is `null`. After the configured delay, status should be `PROCESSED` and `processed_at` should be populated. Unknown IDs return `404`.

Possible statuses are `PROCESSING`, `PROCESSED`, and `FAILED`. `FAILED` means all configured job attempts failed and needs investigation/recovery.

## Tests

The tests use your configured MongoDB and Redis instances. They can create and delete test data, so use a **dedicated test database and Redis instance**, not production.

```bash
npm test
```

Without `RUN_INTEGRATION_TESTS=true`, integration tests are skipped. To run them:

```bash
RUN_INTEGRATION_TESTS=true npm run test:integration
```

The integration test asserts the webhook response takes less than 500ms. Shared or sleeping development environments may have variable latency, so run it more than once.

## Deployment

Deploy two services from this repository:

### Web service (API)

- Build/install command: `npm install`
- Start command: `npm start`
- Set `MONGODB_URI`, `REDIS_URL`, `QUEUE_NAME`, and other required environment variables.
- Set `PORT` according to the hosting provider's runtime environment.

### Background worker

- Build/install command: `npm install`
- Start command: `npm run start:worker`
- Set the same `MONGODB_URI`, `REDIS_URL`, and queue-related variables.
- Keep the worker running continuously; it is not an HTTP service.

Use managed MongoDB and Redis services with network access configured for the deployed services. Do not commit `.env` or credentials.

After deployment, test the public base URL:

```bash
curl -i https://<your-api-host>/
curl -i -X POST https://<your-api-host>/v1/webhooks/transactions \
  -H "Content-Type: application/json" \
  -d '{"transaction_id":"txn_live_test_001","source_account":"acc_a","destination_account":"acc_b","amount":1500,"currency":"INR"}'
curl -i https://<your-api-host>/v1/transactions/txn_live_test_001
```

## Reliability notes and limitations

- The unique MongoDB index prevents duplicate transaction records, including concurrent inserts.
- Deterministic BullMQ job IDs prevent duplicate queued jobs while the corresponding job remains in Redis.
- The worker checks status before processing and uses a conditional update to avoid overwriting an already completed transaction.
- If the database insert succeeds but queue insertion fails, the API returns `503`; a repeated webhook can try to enqueue the existing `PROCESSING` transaction again.
- For stronger recovery guarantees, production systems should implement a transactional outbox or a reconciliation worker that periodically scans `PROCESSING` transactions and ensures they have queue jobs. A queue job and MongoDB write cannot be made one atomic operation without an explicit coordination pattern.
- This sample simulates successful external processing. Real payment integrations should verify provider signatures, authenticate webhook senders, handle provider event IDs, use safe monetary representations (for example integer minor units or Decimal128), and reconcile external payment state.
- BullMQ job retention is configured to preserve completed/failed jobs for deduplication and inspection. Plan retention/cleanup based on expected volume in a production deployment.
