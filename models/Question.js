const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema({
  toUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  text: { type: String, required: true },
  answer: { type: String, default: "" },
  isAnswered: { type: Boolean, default: false },
  reported: { type: Boolean, default: false }, // ✅ new field to track if the question is reported
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Question", questionSchema);