const express = require("express");
const router = express.Router();
const Question = require("../models/Question");

router.post("/", async (req, res) => {
  try {
    const { toUserId, fromUserId, text } = req.body;
    const question = new Question({ toUserId, fromUserId, text });
    await question.save();
    res.status(201).json(question);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to submit question." });
  }
});

module.exports = router;