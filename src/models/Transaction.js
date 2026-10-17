import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema(
  {
    transaction_id: {
      type: String,
      required: true,
      trim: true,
      immutable: true
    },
    source_account: { type: String, required: true, trim: true },
    destination_account: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    currency: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      minlength: 3,
      maxlength: 3
    },
    status: {
      type: String,
      enum: ["PROCESSING", "PROCESSED", "FAILED"],
      default: "PROCESSING",
      required: true
    },
    created_at: { type: Date, default: Date.now, required: true },
    processed_at: { type: Date, default: null },
    last_error: { type: String, default: null }
  },
  {
    versionKey: false,
    timestamps: false
  }
);

// This is the primary database-level idempotency guarantee.
transactionSchema.index({ transaction_id: 1 }, { unique: true });

export default mongoose.model("Transaction", transactionSchema);
