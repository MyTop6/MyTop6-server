// models/Thread.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const ThreadSchema = new Schema(
  {
    community: { type: Schema.Types.ObjectId, ref: "Community", required: true },
    author:    { type: Schema.Types.ObjectId, ref: "User", required: true },
    title:     { type: String, required: true, trim: true },
    body:      { type: String, required: true, trim: true },
    replyCount:{ type: Number, default: 0 },
    pinned:    { type: Boolean, default: false },
    locked:    { type: Boolean, default: false },
    lastActivityAt: { type: Date, default: Date.now },
    kudos: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Index for listing threads in a community
ThreadSchema.index({ community: 1, pinned: -1, lastActivityAt: -1 });

// keep lastActivityAt up to date
ThreadSchema.pre("save", function (next) {
  if (!this.lastActivityAt) {
    this.lastActivityAt = this.updatedAt || new Date();
  }
  next();
});

module.exports = mongoose.model("Thread", ThreadSchema);