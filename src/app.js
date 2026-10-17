import express from "express";
import transactionRoutes from "./routes/transaction.routes.js";
import { healthCheck } from "./controllers/transaction.controller.js";

const app = express();

// Payment providers may send JSON; keep the parser limit conservative.
app.use(express.json({ limit: "100kb", strict: true }));

app.get("/", healthCheck);
app.use("/v1", transactionRoutes);

app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Global error handler
app.use((error, req, res, next) => {
  // check response is already send or not.
  if (res.headersSent) return next(error);

  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  console.error("Unhandled request error:", error);
  return res.status(500).json({ error: "Internal server error" });
});

export default app;
