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

## API Reference

The service exposes the following endpoints.

| Method | Endpoint | Description | Success Response |
|---|---|---|---|
| `GET` | `/` | Checks API health | `200 OK` |
| `POST` | `/v1/webhooks/transactions` | Accepts a transaction webhook for asynchronous processing | `202 Accepted` |
| `GET` | `/v1/transactions/:transaction_id` | Retrieves the current status of a transaction | `200 OK` |

### Webhook Payload

The `POST /v1/webhooks/transactions` endpoint accepts a JSON payload:

```json
{
  "transaction_id": "txn_abc123def456",
  "source_account": "acc_user_789",
  "destination_account": "acc_merchant_456",
  "amount": 1500,
  "currency": "INR"
}
```

### Response and Error Codes

- `200 OK` — Health check or successful transaction lookup.
- `202 Accepted` — Webhook accepted or duplicate webhook acknowledged.
- `400 Bad Request` — Invalid webhook payload.
- `404 Not Found` — Transaction does not exist.
- `503 Service Unavailable` — Queue scheduling fails.

For request examples and step-by-step verification, see [Testing and Verification](#testing-and-verification).

## Testing and Verification

This section explains how to test the Transaction Webhook Service locally and verify the live AWS EC2 deployment.

### Test Environments

Choose the appropriate base URL for your environment.

| Environment | Base URL |
|---|---|
| Local | `http://localhost:3000` |
| AWS EC2 Live | `http://52.66.240.197` |

The live deployment is currently accessible over HTTP, not HTTPS.

### Prerequisites

For local testing:

- Start MongoDB and Redis, or configure dedicated managed instances.
- Start the API using `npm run dev`.
- Start the background worker in a separate terminal using `npm run dev:worker`.

For AWS live testing, use the deployed public API endpoint. The API and background worker are configured to run on the EC2 instance, allowing transactions to be accepted and processed asynchronously.

### 1. Health Check

Verify that the API is reachable and responding successfully.

**Request**

```http
GET /
```

**Local command**

```bash
curl -i http://localhost:3000/
```

**AWS live command**

```bash
curl -i http://52.66.240.197/
```

**Expected response: HTTP `200 OK`**

```json
{
  "status": "HEALTHY",
  "current_time": "2026-10-17T18:04:53.636Z"
}
```

The timestamp above is an example. The actual value changes with each request.

**Verification:** The public API responds with HTTP `200 OK` and reports a healthy status.

### 2. Submit a Transaction Webhook

Submit a valid transaction payload to the webhook endpoint.

**Request**

```http
POST /v1/webhooks/transactions
Content-Type: application/json
```

**Local command**

```bash
curl -i -X POST http://localhost:3000/v1/webhooks/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "transaction_id": "txn_test_001",
    "source_account": "acc_a",
    "destination_account": "acc_b",
    "amount": 1500,
    "currency": "INR"
  }'
```

**AWS live command**

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

**Expected response: HTTP `202 Accepted`**

```json
{
  "message": "Webhook accepted",
  "transaction_id": "txn_live_test_001",
  "status": "PROCESSING"
}
```

The transaction ID in the response matches the ID supplied in the request. The transaction is accepted for asynchronous processing rather than being processed synchronously.

**Verification:** The API returns HTTP `202 Accepted` and acknowledges the transaction.

### 3. Check the Initial Transaction Status

Retrieve the transaction using the ID supplied in the webhook request.

**Local command**

```bash
curl -i http://localhost:3000/v1/transactions/txn_test_001
```

**AWS live command**

```bash
curl -i http://52.66.240.197/v1/transactions/txn_live_test_001
```

**Expected response: HTTP `200 OK`**

```json
[
  {
    "transaction_id": "txn_live_test_001",
    "source_account": "acc_a",
    "destination_account": "acc_b",
    "amount": 1500,
    "currency": "INR",
    "status": "PROCESSING",
    "created_at": "2026-10-17T18:05:23.252Z",
    "processed_at": null
  }
]
```

This is an illustrative response. The actual timestamps and transaction ID depend on your request.

**Verification:** The transaction can be retrieved from persistent storage and initially has the `PROCESSING` status.

### 4. Verify Background Processing

The background worker processes the transaction after the configured delay, which defaults to 30 seconds.

Wait approximately 30–35 seconds, then run the status request again.

**AWS live command**

```bash
curl -i http://52.66.240.197/v1/transactions/txn_live_test_001
```

**Local command**

```bash
curl -i http://localhost:3000/v1/transactions/txn_test_001
```

**Expected response: HTTP `200 OK`**

```json
[
  {
    "transaction_id": "txn_live_test_001",
    "source_account": "acc_a",
    "destination_account": "acc_b",
    "amount": 1500,
    "currency": "INR",
    "status": "PROCESSED",
    "created_at": "2026-10-17T18:05:23.252Z",
    "processed_at": "2026-10-17T18:05:53.304Z"
  }
]
```

The timestamps are illustrative; `processed_at` should be populated after successful processing.

**Verification:** The status changes from `PROCESSING` to `PROCESSED` after approximately 30 seconds.

### 5. Test Duplicate Webhook Delivery

Submit the same transaction payload again using an existing transaction ID that has already been processed.

**AWS live command**

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

For local testing, replace the base URL with `http://localhost:3000` and use the local transaction ID.

**Observed response: HTTP `202 Accepted`**

```json
{
  "message": "Webhook already processed",
  "transaction_id": "txn_live_test_001",
  "status": "PROCESSED"
}
```

Check the transaction status again to confirm it remains `PROCESSED` and its original timestamps remain unchanged.

**Verification:** The duplicate delivery is acknowledged without creating another transaction record or reprocessing the completed transaction.

### 6. Test Invalid Payload Validation

Send a webhook without the required `transaction_id` field.

**AWS live command**

```bash
curl -i -X POST http://52.66.240.197/v1/webhooks/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "source_account": "acc_a",
    "destination_account": "acc_b",
    "amount": 1500,
    "currency": "INR"
  }'
```

**Expected response: HTTP `400 Bad Request`**

```json
{
  "error": "transaction_id must be a non-empty string"
}
```

For local testing, use the same request with `http://localhost:3000`.

**Verification:** The API rejects the invalid payload and returns an appropriate validation error.

### 7. Test an Unknown Transaction ID

Request a transaction ID that does not exist in the database.

**AWS live command**

```bash
curl -i http://52.66.240.197/v1/transactions/txn_does_not_exist_999
```

**Local command**

```bash
curl -i http://localhost:3000/v1/transactions/txn_does_not_exist_999
```

**Expected response: HTTP `404 Not Found`**

```json
{
  "error": "Transaction not found"
}
```

**Verification:** The API returns HTTP `404 Not Found` when the requested transaction does not exist.

### Production Verification Results

The following functional checks were manually verified against the live AWS deployment.

| Test | Result | Verified behavior |
|---|---|---|
| 1. Health check | PASS | Public API responds with HTTP `200 OK` |
| 2. Submit webhook | PASS | Returns HTTP `202 Accepted` |
| 3. Initial status | PASS | Transaction can be retrieved |
| 4. Background processing | PASS | Status changes to `PROCESSED` after approximately 30 seconds |
| 5. Duplicate webhook | PASS | Completed transaction is acknowledged without reprocessing |
| 6. Invalid payload | PASS | Returns HTTP `400 Bad Request` |
| 7. Unknown transaction | PASS | Returns HTTP `404 Not Found` |

**Note:** These results represent the manual checks performed against the live deployment. They do not imply that load testing, concurrency testing, or simulated queue failures have also been completed.

## Test with Postman

Postman can be used to inspect request payloads, HTTP status codes, and JSON responses. The `curl` commands in the Testing and Verification section provide an alternative for terminal-based testing.

Create a Postman collection named **Transaction Webhook Service** and add the following requests:

| Request | Method | URL (local) |
|---|---|---|
| Health check | `GET` | `http://localhost:3000/` |
| Submit transaction | `POST` | `http://localhost:3000/v1/webhooks/transactions` |
| Get transaction status | `GET` | `http://localhost:3000/v1/transactions/txn_abc123def456` |

For the POST request:

1. Select **Body → raw → JSON**.
2. Paste the webhook payload from the API Reference section.
3. Send the request and verify that the API returns `202 Accepted`.
4. Send the same payload again using the same transaction ID to test duplicate delivery.
5. Query the transaction status immediately, then query it again after the configured processing delay.

For live testing, replace `http://localhost:3000` with `http://52.66.240.197`. Use unique transaction IDs for new transactions to avoid conflicts with existing test data.

For detailed request examples, expected responses, and verified test results, refer to the [Testing and Verification](#testing-and-verification) section.

## Automated Tests

The project uses Node.js's built-in test runner (`node:test`) and Supertest to test the API.

### Run the Default Test Suite

```bash
npm test
```

### Run Integration Tests

Integration tests are skipped by default. To enable them, run:

```bash
npm run test:integration
```

The integration tests use the configured MongoDB and Redis instances to verify transaction webhook behavior.

**Important:** Integration tests may create or delete test data. Configure a dedicated test database and Redis instance before running them. Do not run destructive integration tests against production resources.

### Response Time Verification

The webhook endpoint was manually tested locally against the 500 ms response-time target.

| Metric | Result |
|---|---|
| HTTP status | `202 Accepted` |
| Measured response time | `0.134543 seconds` (approximately 134.5 ms) |
| Target | Less than 500 ms |
| Result | PASS |

Response time may vary depending on the machine, database, and environment.

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

Use the [Testing and Verification](#testing-and-verification) section to verify the live API, webhook submission, transaction status, duplicate delivery, payload validation, and background processing.

The deployed API is available at:

http://52.66.240.197/

### Deployment and Security Notes

- Never commit `.env` files, database credentials, Redis credentials, or private SSH keys to version control.
- Keep the Node.js application port and Redis port private. Route public HTTP traffic through Nginx.
- The current live endpoint uses HTTP rather than HTTPS. HTTPS can be configured using a domain name and a TLS certificate.
- Pushing changes to GitHub does not automatically update the EC2 deployment unless CI/CD is configured. For manual deployments, pull the latest code on EC2, install dependencies if needed, restart the API and worker services, and verify the health endpoint and service logs.

## Reliability Notes and Limitations

- A unique MongoDB index on `transaction_id` prevents duplicate transaction records, including during concurrent insert attempts.
- Deterministic BullMQ job IDs help prevent duplicate job creation while the corresponding job remains in Redis. They do not guarantee permanent deduplication if jobs are removed.
- The worker checks transaction status and uses conditional updates to avoid overwriting an already completed transaction.
- If a transaction is saved to MongoDB but queue insertion fails, the API returns `503 Service Unavailable`. The transaction record may already exist, and restarting Redis alone does not guarantee that the job will be rescheduled.
- MongoDB writes and Redis queue insertion are not atomic. A transactional outbox or reconciliation worker could improve recovery by identifying transactions stuck in `PROCESSING` without corresponding queue jobs and rescheduling them.
- This assessment simulates transaction processing rather than integrating with a real payment provider. A production implementation should verify webhook signatures, authenticate senders, handle provider event IDs, use safe monetary representations such as integer minor units or `Decimal128`, and reconcile external payment states.
- BullMQ completed and failed job retention should be configured according to operational and debugging requirements.

### Testing Coverage

The following scenarios were tested locally:

- Duplicate webhook handling, including five simultaneous requests using the same transaction ID.
- MongoDB transaction uniqueness.
- Redis unavailability and the expected `503 Service Unavailable` response.
- Worker restart and processing of a previously queued transaction.
- Webhook response time against the 500 ms target.

These results demonstrate the behavior verified in the local development environment. They do not imply that every failure scenario was tested in production.

## Author

**Ritik Patel**  
Full Stack Developer

- GitHub: [ritik177](https://github.com/ritik177)
- Project Repository: [Transaction Processing](https://github.com/ritik177/transaction-processing)

*Developed as part of the Full Stack Developer assessment for Walnut Folks Group.*


