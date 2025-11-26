// routes/messages.js
const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const User = require('../models/User');

// ✅ Send a message
router.post('/', async (req, res) => {
  try {
    const { sender, recipient, content } = req.body;

    // Ensure sender and recipient are valid users
    const senderUser = await User.findById(sender);
    const recipientUser = await User.findById(recipient);

    if (!senderUser || !recipientUser) {
      return res.status(400).json({ error: 'Invalid sender or recipient.' });
    }

    // Create the message
    const message = new Message({ sender, recipient, text: content });
    await message.save();

    res.status(201).json(message);
  } catch (err) {
    console.error('Failed to send message:', err); // Log the error for debugging
    res.status(500).json({ error: 'Failed to send message.' });
  }
});

// ✅ Get conversation between two users
router.get('/conversation/:user1/:user2', async (req, res) => {
  try {
    const { user1, user2 } = req.params;

    const messages = await Message.find({
      $or: [
        { sender: user1, recipient: user2 },
        { sender: user2, recipient: user1 },
      ],
    })
      .sort({ timestamp: 1 }) // Oldest to newest
      .populate('sender', 'username profilePicture')
      .populate('recipient', 'username profilePicture');

    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch conversation.' });
  }
});

// ✅ Get recent messages received by a user
router.get('/inbox/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const messages = await Message.find({ recipient: userId })
      .sort({ timestamp: -1 })
      .populate('sender', 'username profilePicture');

    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch inbox.' });
  }
});

// ✅ Get unique conversation users with last message
router.get('/conversations/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const sent = await Message.find({ sender: userId }).distinct('recipient');
    const received = await Message.find({ recipient: userId }).distinct('sender');

    const conversationUserIds = Array.from(new Set([...sent, ...received]));

    const conversations = await Promise.all(
      conversationUserIds.map(async (otherUserId) => {
        const otherUser = await User.findById(otherUserId).select('username profilePicture');

        // Find last message between the logged-in user and this user
        const lastMessage = await Message.findOne({
          $or: [
            { sender: userId, recipient: otherUserId },
            { sender: otherUserId, recipient: userId },
          ],
        })
          .sort({ timestamp: -1 }) // Most recent
          .select('text timestamp');

        return {
          _id: otherUser._id,
          username: otherUser.username,
          profilePicture: otherUser.profilePicture,
          lastMessage: lastMessage ? { content: lastMessage.text, timestamp: lastMessage.timestamp } : null,
        };
      })
    );

    res.json(conversations);
  } catch (err) {
    console.error('Error fetching conversations:', err);
    res.status(500).json({ error: 'Failed to fetch conversations.' });
  }
});

module.exports = router;