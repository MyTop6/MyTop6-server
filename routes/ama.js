const express = require("express");
const router = express.Router();
const Question = require("../models/Question");
const Bulletin = require("../models/Bulletin");
const User = require("../models/User");

// ✅ Get all questions in inbox for a user
router.get("/inbox/:userId", async (req, res) => {
  try {
  const questions = await Question.find({ toUserId: req.params.userId, isAnswered: false })
    .populate("fromUserId", "username displayName profilePicture")
    .sort({ createdAt: -1 });

    res.json(questions);
  } catch (err) {
    console.error("Failed to fetch inbox questions:", err);
    res.status(500).json({ error: "Failed to fetch questions." });
  }
});

// ✅ Submit a reply and create a bulletin
router.post("/:id/reply", async (req, res) => {
  try {
    const { answer } = req.body;
    const question = await Question.findById(req.params.id)
      .populate("fromUserId")
      .populate("toUserId");
    if (!question) return res.status(404).json({ error: "Question not found." });

    question.answer = answer;
    question.isAnswered = true;
    await question.save();

    // Create bulletin with structured AMA fields
    const bulletin = new Bulletin({
      userId: question.toUserId._id,
      type: "ama",
      isAmaAnswer: true,
      amaQuestionUser: question.fromUserId ? question.fromUserId._id : null,
      amaAnswerUser: question.toUserId._id,
      amaQuestionText: question.text,
      amaAnswerText: answer,
    });

    await bulletin.save();

    res.json({ message: "Reply saved and bulletin created successfully.", question });
  } catch (err) {
    console.error("Failed to save reply and create bulletin:", err);
    res.status(500).json({ error: "Failed to save reply and create bulletin." });
  }
});

// ✅ Mark a question as reported
router.patch("/:id/report", async (req, res) => {
  try {
    await Question.findByIdAndUpdate(req.params.id, { reported: true });
    res.json({ message: "Question marked as reported" });
  } catch (err) {
    console.error("Failed to mark question as reported:", err);
    res.status(500).json({ error: "Failed to mark question as reported." });
  }
});

// ✅ Delete a question completely
router.delete("/:id", async (req, res) => {
  try {
    await Question.findByIdAndDelete(req.params.id);
    res.json({ message: "Question deleted successfully." });
  } catch (err) {
    console.error("Failed to delete question:", err);
    res.status(500).json({ error: "Failed to delete question." });
  }
});

module.exports = router;