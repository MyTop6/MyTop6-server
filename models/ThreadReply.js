// models/ThreadReply.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const ThreadReplySchema = new Schema(
  {
    thread: { type: Schema.Types.ObjectId, ref: "Thread", required: true },
    author: { type: Schema.Types.ObjectId, ref: "User", required: true },
    body:   { type: String, required: true, trim: true },

    // 👇 NEW: if null => top-level comment; if set => reply to that top-level comment
    parentReply: { type: Schema.Types.ObjectId, ref: "ThreadReply", default: null },
  },
  { timestamps: true }
);

// Indexes for fetching replies by thread + parent in order
ThreadReplySchema.index({ thread: 1, createdAt: 1 });
ThreadReplySchema.index({ thread: 1, parentReply: 1, createdAt: 1 });

module.exports = mongoose.model("ThreadReply", ThreadReplySchema);