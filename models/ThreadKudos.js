// models/ThreadKudos.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const ThreadKudosSchema = new Schema(
  {
    threadId: { type: Schema.Types.ObjectId, ref: "Thread", index: true },
    userId:   { type: Schema.Types.ObjectId, ref: "User", index: true },
  },
  { timestamps: true }
);

// Each user can only kudo a thread once
ThreadKudosSchema.index({ threadId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("ThreadKudos", ThreadKudosSchema);