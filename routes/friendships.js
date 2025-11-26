// routes/friendships.js
const express = require("express");
const router = express.Router();
const Friendship = require("../models/Friendship");
const User = require("../models/User");

const mongoose = require("mongoose");
const ObjectId = mongoose.Types.ObjectId;

// ✅ Send friend request
router.post("/request", async (req, res) => {
  try {
    const { requesterId, recipientId } = req.body;

    // Check if request already exists
    const existing = await Friendship.findOne({
      requester: requesterId,
      recipient: recipientId,
    });

    if (existing) {
      return res.status(400).json({ error: "Friend request already sent." });
    }

    const newRequest = new Friendship({
      requester: requesterId,
      recipient: recipientId,
      status: "pending",
    });

    await newRequest.save();
    res.status(201).json(newRequest);
  } catch (err) {
    console.error("Send request error:", err);
    res.status(500).json({ error: err.message || "Failed to send request." });
  }
});

// ✅ Accept friend request
router.post("/:id/accept", async (req, res) => {
  try {
    const { id } = req.params;

    const friendship = await Friendship.findById(id);
    if (!friendship) return res.status(404).json({ error: "Request not found." });

    friendship.status = "accepted";
    await friendship.save();

    res.json(friendship);
  } catch (err) {
    console.error("Accept request error:", err);
    res.status(500).json({ error: err.message || "Failed to accept request." });
  }
});

// ✅ Decline friend request
router.post("/:id/decline", async (req, res) => {
  try {
    const { id } = req.params;

    await Friendship.findByIdAndDelete(id);
    res.json({ message: "Request declined." });
  } catch (err) {
    console.error("Decline request error:", err);
    res.status(500).json({ error: err.message || "Failed to decline request." });
  }
});

// ✅ Remove friendship by user IDs
router.post("/remove-by-users", async (req, res) => {
  try {
    const { userId1, userId2 } = req.body;

    const friendship = await Friendship.findOneAndDelete({
      $or: [
        { requester: userId1, recipient: userId2 },
        { requester: userId2, recipient: userId1 },
      ],
    });

    if (!friendship) return res.status(404).json({ error: "Friendship not found" });

    res.json({ message: "Friend removed." });
  } catch (err) {
    console.error("Remove friend error:", err);
    res.status(500).json({ error: err.message || "Failed to remove friend." });
  }
});

// GET /api/friendships/friends/:userId
router.get("/friends/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // All accepted friendships where user is requester or recipient
    const friendships = await Friendship.find({
      $or: [
        { requester: userId, status: "accepted" },
        { recipient: userId, status: "accepted" },
      ],
    })
      .populate("requester", "username handle profilePicture")
      .populate("recipient", "username handle profilePicture");

    // Convert friendship docs → list of user objects
    const friends = friendships.map((f) => {
      if (f.requester._id.toString() === userId) {
        return f.recipient; // the friend is the recipient
      } else {
        return f.requester; // the friend is the requester
      }
    });

    res.json(friends);
  } catch (err) {
    console.error("Error fetching friends:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Get pending friend requests for a user (includes mutual count)
router.get("/requests/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const requests = await Friendship.find({
      recipient: new ObjectId(userId),
      status: "pending",
    }).populate("requester", "username handle profilePicture");

    // Get current user's accepted friendships
    const currentUserFriendships = await Friendship.find({
      $or: [
        { requester: userId, status: "accepted" },
        { recipient: userId, status: "accepted" },
      ],
    });

    const userFriends = currentUserFriendships.map((f) =>
      f.requester.toString() === userId ? f.recipient.toString() : f.requester.toString()
    );

    // Add mutualCount to each request
    const requestsWithMutuals = await Promise.all(
      requests.map(async (reqItem) => {
        const requesterFriendships = await Friendship.find({
          $or: [
            { requester: reqItem.requester._id, status: "accepted" },
            { recipient: reqItem.requester._id, status: "accepted" },
          ],
        });

        const requesterFriends = requesterFriendships.map((f) =>
          f.requester.toString() === reqItem.requester._id.toString()
            ? f.recipient.toString()
            : f.requester.toString()
        );

        const mutualFriends = userFriends.filter((id) => requesterFriends.includes(id));

        return {
          ...reqItem.toObject(),
          mutualCount: mutualFriends.length,
        };
      })
    );

    res.json(requestsWithMutuals);
  } catch (err) {
    console.error("Get requests error:", err);
    res.status(500).json({ error: err.message || "Failed to get requests." });
  }
});

// ✅ Check friendship status
router.get("/status/:loggedInUserId/:profileUserId", async (req, res) => {
  try {
    const { loggedInUserId, profileUserId } = req.params;

    const friendship = await Friendship.findOne({
      $or: [
        { requester: loggedInUserId, recipient: profileUserId },
        { requester: profileUserId, recipient: loggedInUserId },
      ],
    });

    if (!friendship) return res.json({ status: "not_friends" });
    if (friendship.status === "pending") return res.json({ status: "pending" });
    if (friendship.status === "accepted") return res.json({ status: "friends" });

    res.json({ status: "not_friends" });
  } catch (err) {
    console.error("Failed to get friendship status:", err);
    res.status(500).json({ error: "Failed to get friendship status" });
  }
});

module.exports = router;