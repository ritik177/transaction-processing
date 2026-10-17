# Transaction Webhook Service

A Node.js and Express backend assessment implementation for accepting transaction webhooks, storing durable transaction records in MongoDB, and processing transactions asynchronously with Redis and BullMQ.

## Live Demo

- **Live API:** http://52.66.240.197/
- **GitHub Repository:** https://github.com/ritik177/transaction-processing

The deployed API is exposed through Nginx on port 80, which forwards requests to the Express application running on port 3000. The live URL currently uses **HTTP**, not HTTPS.

### Quick health check

```bash
curl -i http://52.66.240.197/
```

Expected response: HTTP `200 OK` with a JSON health status.

## Features

- `GET /` — health check.
- `POST /v1/webhooks/transactions` — accepts a transaction webhook and returns `202 Accepted`.
- `GET /v1/transactions/:transaction_id` — retrieves the current transaction status.
- Background processing through a separate BullMQ worker, with a configurable 30-second delay by default.
- MongoDB unique index on `transaction_id` to prevent duplicate transaction records.
- Deterministic BullMQ job IDs to reduce duplicate job creation.
- Worker-side status checks and conditional updates to avoid overwriting completed transactions.
- Configurable queue retries and terminal failure status.
- Integration tests for health checks, validation, response latency, duplicate delivery, and missing records.

## Architecture

### Request and processing flow

1. The API validates the incoming webhook payload.
2. It creates or retrieves the transaction record in MongoDB with status `PROCESSING`.
3. It enqueues a BullMQ job using a deterministic job ID.
4. It returns `202 Accepted` after the database and queue accept the work.
5. The separate worker waits for `PROCESSING_DELAY_MS` (30 seconds by default), simulates processing, and updates the transaction to `PROCESSED`.
6. Clients poll the status endpoint to check the result.

MongoDB is the source of truth for transaction state. Redis/BullMQ manages background jobs. The API and worker use the same codebase but run as separate processes.

### AWS deployment architecture

```text
Client / Postman
       |
       v
EC2 Public IP (HTTP :80)
       |
       v
Nginx reverse proxy
       |
       v
Express API (127.0.0.1:3000)
       |                     \
       v                      v
MongoDB Atlas             Redis / BullMQ
                                |
                                v
                         Background worker
```

The API and worker are managed as separate systemd services on the EC2 instance. MongoDB Atlas and Redis connection settings are supplied through environment variables.

## Requirements

- Node.js 20 or newer
- MongoDB Atlas or a local MongoDB instance
- Redis 6.2 or newer

## Run locally

### 1. Clone the repository

```bash
git clone https://github.com/ritik177/transaction-processing.git
cd transaction-processing
npm install
```

If you have already cloned the repository, navigate to the project directory and pull the latest changes before installing dependencies.

### 2. Configure environment variables

Copy the example environment file:

```bash
cp .env.example .env
```

Update `.env` with valid connection details. Do not commit `.env` or share database credentials.

```dotenv
NODE_ENV=development
PORT=3000
MONGODB_URI=<your-mongodb-connection-uri>
REDIS_URL=<your-redis-connection-uri>
QUEUE_NAME=transaction-processing
PROCESSING_DELAY_MS=30000
WORKER_CONCURRENCY=5
JOB_ATTEMPTS=3
JOB_BACKOFF_MS=2000
```

The placeholders above are examples; use the variable names and format supported by your environment. Start MongoDB and Redis locally, or use dedicated managed instances.

### 3. Start the API

In the first terminal:

```bash
npm run dev
```

### 4. Start the background worker

In a second terminal:

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
| `PROCESSING_DELAY_MS` | Simulated processing delay in milliseconds | `30000` |
| `WORKER_CONCURRENCY` | Maximum concurrent worker jobs | `5` |
| `JOB_ATTEMPTS` | Maximum queue attempts | `3` |
| `JOB_BACKOFF_MS` | Initial exponential retry delay in milliseconds | `2000` |

## API reference

The examples below use the local base URL. To test the live deployment, replace `http://localhost:3000` with `http://52.66.240.197`.

### 1. Health check

**Request**

```http
GET /
```

```bash
curl -i http://localhost:3000/
```

**Example response**

```json
{
  "status": "HEALTHY",
  "current_time": "2026-10-15T14:00:00.000Z"
}
```

The timestamp is an example and will vary for each request.

### 2. Submit a transaction webhook

**Request**

```http
POST /v1/webhooks/transactions
Content-Type: application/json
```

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

**Example successful response — HTTP `202 Accepted`**

```json
{
  "message": "Webhook accepted",
  "transaction_id": "txn_abc123def456",
  "status": "PROCESSING"
}
```

A repeated delivery of a transaction that is still processing should not create another transaction record or another deterministic queue job. Invalid payloads return `400 Bad Request`. If queue scheduling fails, the API returns `503 Service Unavailable`, allowing the sender to retry; the existing database record is retained so a subsequent delivery can attempt to enqueue it again.

### 3. Get transaction status

**Request**

```http
GET /v1/transactions/:transaction_id
```

```bash
curl -i http://localhost:3000/v1/transactions/txn_abc123def456
```

Initially, the status is expected to be `PROCESSING` and `processed_at` is `null`. After the configured delay, the status should normally become `PROCESSED` and `processed_at` should be populated. Unknown transaction IDs return `404 Not Found`.

Possible statuses:

- `PROCESSING` — accepted and awaiting completion.
- `PROCESSED` — processing completed successfully.
- `FAILED` — all configured job attempts failed; investigate and recover as appropriate.

## Test with Postman

Postman is a convenient way to manually inspect request payloads, HTTP status codes, and JSON responses. The `curl` examples above are also provided for quick terminal-based checks.

Create a Postman collection named **Transaction Webhook Service** and add these requests:

| Request | Method | URL (local) |
|---|---|---|
| Health check | `GET` | `http://localhost:3000/` |
| Submit transaction | `POST` | `http://localhost:3000/v1/webhooks/transactions` |
| Get transaction status | `GET` | `http://localhost:3000/v1/transactions/txn_abc123def456` |

For the POST request:

1. Select **Body → raw → JSON**.
2. Paste the webhook payload from the API reference above.
3. Send the request and verify the response is `202 Accepted`.
4. Send the same payload again to test duplicate delivery.
5. Query the status endpoint immediately, then query it again after the configured processing delay.

For live testing, replace `http://localhost:3000` with `http://52.66.240.197`. Use unique transaction IDs for new test transactions. A Postman collection can be added to the repository if one is created; do not assume a collection is included unless the file is actually committed.

## Testing checklist

Run these checks in a local environment or against the deployed API where appropriate.

| Scenario | Expected result |
|---|---|
| Health check | HTTP `200 OK` |
| Valid webhook | HTTP `202 Accepted`; status is initially `PROCESSING` |
| Invalid or missing required fields | HTTP `400 Bad Request` |
| Duplicate webhook delivery | No duplicate transaction record; no duplicate active deterministic job |
| Existing transaction status lookup | HTTP `200 OK` with current transaction status |
| Unknown transaction ID | HTTP `404 Not Found` |
| Background processing | Status changes to `PROCESSED` after the configured delay when processing succeeds |
| Queue scheduling failure | HTTP `503 Service Unavailable`, so the sender can retry |

The expected results above describe the intended behavior; verify each scenario in your environment before reporting it as tested. Queue scheduling failure may require explicitly simulating a Redis or queue error.

## Automated tests

The integration tests use the configured MongoDB and Redis instances. They may create and delete test data, so use a **dedicated test database and Redis instance**, not production resources.

Run the default test command:

```bash
npm test
```

Integration tests are skipped unless `RUN_INTEGRATION_TESTS=true`. To enable them:

```bash
RUN_INTEGRATION_TESTS=true npm run test:integration
```

The integration test asserts that the webhook response takes less than 500 ms. Results can vary on shared or resource-constrained environments, so investigate failures rather than assuming they always indicate a code defect.

**Important:** Do not run destructive integration tests against the live production database or Redis instance. Use isolated test resources.

## AWS EC2 deployment

The assessment application is deployed on an Ubuntu EC2 instance in AWS.

- **Public base URL:** `http://52.66.240.197/`
- **Reverse proxy:** Nginx listens on port 80 and forwards requests to `127.0.0.1:3000`.
- **API process:** managed by the `transaction-api` systemd service.
- **Worker process:** managed separately by the `transaction-worker` systemd service.
- **Database:** MongoDB Atlas.
- **Queue:** Redis with BullMQ.

The API and worker are separate processes. The worker is not an HTTP service and should remain running continuously.

### Verify the deployment

Health check from the public URL:

```bash
curl -i http://52.66.240.197/
```

Submit a test webhook:

```bash
curl -i -X POST http://52.66.240.197/v1/webhooks/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "transaction_id": "txn_live_test_001",
    "source_account": "acc_a",
    "destination_account": "acc_b",
    "amount": 1500,
    "currency": "INR"
  }'
```

Check the transaction status:

```bash
curl -i http://52.66.240.197/v1/transactions/txn_live_test_001
```

Query the status again after the configured processing delay.

### Deployment and security notes

- Keep `.env`, MongoDB credentials, Redis credentials, and private SSH keys out of Git.
- Do not expose the internal Node.js port or Redis port publicly; route HTTP traffic through Nginx.
- The current public endpoint uses HTTP. HTTPS requires a domain and TLS configuration.
- Pushing code to GitHub does not automatically update EC2 unless a CI/CD workflow has been configured. For manual deployment, pull the latest code on the instance, install changed dependencies if needed, restart the API and worker services, and verify service logs and health checks.

## Reliability notes and limitations

- A MongoDB unique index on `transaction_id` prevents duplicate transaction records, including concurrent insert attempts.
- Deterministic BullMQ job IDs reduce duplicate job creation while the relevant job remains in Redis. They are not a permanent deduplication mechanism if jobs are removed from Redis.
- The worker checks transaction status before processing and uses a conditional update to avoid overwriting an already completed transaction.
- If the database insert succeeds but queue insertion fails, the API returns `503`. A subsequent webhook delivery can attempt to enqueue the existing `PROCESSING` transaction again.
- MongoDB writes and Redis queue insertion are not one atomic operation. For stronger recovery guarantees, production systems should implement a transactional outbox or a reconciliation worker that finds `PROCESSING` transactions without corresponding jobs and reschedules them.
- This assessment simulates successful external processing. Real payment integrations should verify provider signatures, authenticate webhook senders, handle provider event IDs, use safe monetary representations (for example, integer minor units or Decimal128), and reconcile external payment state.
- Completed and failed BullMQ job retention should be configured for the expected workload and operational inspection needs.

## Author

**Ritik Patel**  
Full Stack Developer

- GitHub: [ritik177](https://github.com/ritik177)
- Project Repository: [Transaction Processing](https://github.com/ritik177/transaction-processing)

*Developed as part of the Full Stack Developer assessment for Walnut Folks Group.*


