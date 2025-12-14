const express = require("express");
const router = express.Router();

const Question = require("../models/Question");
const { moderateAmaQuestion } = require("../utils/amaModeration");

/**
 * POST /api/questions
 * Submit an AMA question
 */
router.post("/", async (req, res) => {
  try {
    const { toUserId, fromUserId, text } = req.body;

    if (!toUserId || !text) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    // 🛡️ OpenAI moderation gate
    const verdict = await moderateAmaQuestion(text);

    if (verdict.action === "block") {
      return res.status(400).json({
        error: verdict.message,
        reasons: verdict.reasons || [],
      });
    }

    const question = new Question({
      toUserId,
      fromUserId: fromUserId || null,
      text,
    });

    await question.save();

    res.status(201).json(question);
  } catch (err) {
    console.error("❌ Failed to submit AMA question:", err);
    res.status(500).json({ error: "Failed to submit question." });
  }
});

module.exports = router;
