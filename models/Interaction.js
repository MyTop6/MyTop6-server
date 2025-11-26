const mongoose = require("mongoose");

const interactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  bulletinId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Bulletin",
    required: true,
  },
  type: {
    type: String,
    enum: ["view", "like", "repost", "comment", "click"],
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Interaction", interactionSchema);