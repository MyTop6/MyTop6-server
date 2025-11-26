const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const mongoose = require('mongoose');

// ✅ Get all notifications for a user
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const notifications = await Notification.find({ toUser: userId })
      .populate('fromUser', 'username displayName profilePicture')
      .populate('bulletinId', 'content mediaUrl')
      .sort({ createdAt: -1 });

    res.json(notifications);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// ✅ Mark a single notification as read
router.put('/:id/mark-read', async (req, res) => {
  try {
    const { id } = req.params;

    const notification = await Notification.findByIdAndUpdate(
      id,
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json(notification);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// ✅ Mark all notifications as read for a user
router.put('/mark-all-read/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    await Notification.updateMany(
      { toUser: userId, isRead: false },
      { isRead: true }
    );

    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
});

// ✅ Delete a notification (optional)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const notification = await Notification.findByIdAndDelete(id);

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ message: 'Notification deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

module.exports = router;