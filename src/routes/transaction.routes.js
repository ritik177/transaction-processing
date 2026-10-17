import { Router } from "express";
import {
  getTransactionStatus,
  receiveTransactionWebhook
} from "../controllers/transaction.controller.js";

const router = Router();

router.post("/webhooks/transactions", receiveTransactionWebhook);
router.get("/transactions/:transaction_id", getTransactionStatus);

export default router;
