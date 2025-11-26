// routes/status.js
const express = require("express");
const router = express.Router();

const User = require("../models/User");
const Friendship = require("../models/Friendship");

/**
 * GET /api/status/feed/:userId
 * Friends’ (and optionally your own) recent blurblets.
 *
 * NOTE: define this BEFORE "/:userId" so it doesn’t get shadowed.
 */
router.get("/feed/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // 1) Find accepted friendships where this user is either side.
    const friendships = await Friendship.find({
      $or: [
        { requester: userId, status: "accepted" },
        { recipient: userId, status: "accepted" },
      ],
    })
      .select("requester recipient status")
      .lean();

    if (!friendships.length) {
      return res.json([]);
    }

    // 2) Derive friendIds from those edges.
    const friendIdSet = new Set();

    friendships.forEach((f) => {
      const reqId = String(f.requester);
      const recId = String(f.recipient);

      if (reqId === userId) {
        friendIdSet.add(recId);
      } else if (recId === userId) {
        friendIdSet.add(reqId);
      } else {
        // (shouldn’t happen, but be defensive)
        friendIdSet.add(reqId);
        friendIdSet.add(recId);
      }
    });

    const friendIds = Array.from(friendIdSet);

    if (!friendIds.length) {
      return res.json([]);
    }

    // 3) Pull friends who actually *have* a status.
    //    We only need small fields + status data.
    const friendsWithStatus = await User.find({
      _id: { $in: friendIds },
      $or: [
        { statusMood: { $ne: "" } },
        { statusBlip: { $ne: "" } },
      ],
    })
      .select("username handle profilePicture statusMood statusBlip statusUpdatedAt")
      .sort({ statusUpdatedAt: -1 }) // newest first
      .limit(100)                    // hard cap for scale
      .lean();

    const feed = friendsWithStatus.map((u) => ({
      userId: u._id,
      username: u.username,
      handle: u.handle,
      profilePicture: u.profilePicture,
      mood: u.statusMood,
      blip: u.statusBlip,
      updatedAt: u.statusUpdatedAt,
    }));

    res.json(feed);
  } catch (err) {
    console.error("GET /api/status/feed/:userId error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET /api/status/:userId
 * Current user status (mood + blurblet).
 */
router.get("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId)
      .select("statusMood statusBlip statusUpdatedAt")
      .lean();

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      mood: user.statusMood || "",
      blip: user.statusBlip || "",
      updatedAt: user.statusUpdatedAt || null,
    });
  } catch (err) {
    console.error("GET /api/status/:userId error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * POST /api/status/:userId
 * Update current user status.
 */
router.post("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { mood = "", blip = "" } = req.body;

    const now = new Date();

    const updated = await User.findByIdAndUpdate(
      userId,
      {
        statusMood: mood,
        statusBlip: blip,
        statusUpdatedAt: now,
      },
      { new: true, select: "statusMood statusBlip statusUpdatedAt" }
    ).lean();

    if (!updated) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      mood: updated.statusMood || "",
      blip: updated.statusBlip || "",
      updatedAt: updated.statusUpdatedAt || now,
    });
  } catch (err) {
    console.error("POST /api/status/:userId error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;