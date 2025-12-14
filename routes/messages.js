// routes/messages.js
const express = require("express");
const router = express.Router();
const Message = require("../models/Message");
const User = require("../models/User");

// ✅ Send a message
router.post("/", async (req, res) => {
  try {
    const { sender, recipient, content } = req.body;

    // Ensure sender and recipient are valid users
    const senderUser = await User.findById(sender);
    const recipientUser = await User.findById(recipient);

    if (!senderUser || !recipientUser) {
      return res.status(400).json({ error: "Invalid sender or recipient." });
    }

    // Create the message (Message schema uses "text")
    const message = new Message({ sender, recipient, text: content });
    await message.save();

    // 🔔 Real-time emit via Socket.IO (if available)
    const io = req.app.get("io");
    if (io) {
      // Notify the recipient in their personal room
      io.to(`user:${recipient}`).emit("message:new", {
        message,
        conversationId: sender, // you can change this to a real convo id later if you add one
      });

      // (Optional) If you ever want to notify the sender too (e.g., for "delivered"):
      // io.to(`user:${sender}`).emit("message:sent", {
      //   message,
      //   conversationId: recipient,
      // });
    }

    res.status(201).json(message);
  } catch (err) {
    console.error("Failed to send message:", err);
    res.status(500).json({ error: "Failed to send message." });
  }
});

// ✅ Get conversation between two users
router.get("/conversation/:user1/:user2", async (req, res) => {
  try {
    const { user1, user2 } = req.params;

    const messages = await Message.find({
      $or: [
        { sender: user1, recipient: user2 },
        { sender: user2, recipient: user1 },
      ],
    })
      .sort({ createdAt: 1 }) // Oldest → newest
      .populate("sender", "username profilePicture")
      .populate("recipient", "username profilePicture");

    res.json(messages);
  } catch (err) {
    console.error("Failed to fetch conversation:", err);
    res.status(500).json({ error: "Failed to fetch conversation." });
  }
});

// ✅ Get recent messages *received* by a user (raw inbox messages)
router.get("/inbox/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const messages = await Message.find({ recipient: userId })
      .sort({ createdAt: -1 }) // Newest first
      .populate("sender", "username profilePicture");

    res.json(messages);
  } catch (err) {
    console.error("Failed to fetch inbox:", err);
    res.status(500).json({ error: "Failed to fetch inbox." });
  }
});

// ✅ Get unique conversation users with last message
router.get("/conversations/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // All people this user has ever messaged / been messaged by
    const sent = await Message.find({ sender: userId }).distinct("recipient");
    const received = await Message.find({ recipient: userId }).distinct("sender");

    // 💡 Dedupe by string value (NOT by ObjectId reference)
    const conversationUserIds = [
      ...new Set([...sent, ...received].map((id) => id.toString())),
    ];

    const conversations = await Promise.all(
      conversationUserIds.map(async (otherUserId) => {
        const otherUser = await User.findById(otherUserId).select(
          "username handle profilePicture"
        );
        if (!otherUser) return null; // user deleted, etc.

        // Find last message between logged-in user and this user
        const lastMessage = await Message.findOne({
          $or: [
            { sender: userId, recipient: otherUserId },
            { sender: otherUserId, recipient: userId },
          ],
        })
          .sort({ createdAt: -1 }) // newest first
          .select("text createdAt sender recipient");

        return {
          _id: otherUser._id,
          username: otherUser.username,
          handle: otherUser.handle,
          profilePicture: otherUser.profilePicture,
          lastMessage: lastMessage
            ? {
                content: lastMessage.text,
                timestamp: lastMessage.createdAt,
                sender: lastMessage.sender,
                recipient: lastMessage.recipient,
              }
            : null,
        };
      })
    );

    // strip nulls and sort by last message time
    const filtered = (conversations || []).filter(Boolean);

    filtered.sort((a, b) => {
      const tA = a.lastMessage
        ? new Date(a.lastMessage.timestamp).getTime()
        : 0;
      const tB = b.lastMessage
        ? new Date(b.lastMessage.timestamp).getTime()
        : 0;
      return tB - tA;
    });

    res.json(filtered);
  } catch (err) {
    console.error("Error fetching conversations:", err);
    res.status(500).json({ error: "Failed to fetch conversations." });
  }
});

module.exports = router;
