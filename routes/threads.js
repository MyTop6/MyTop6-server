// routes/threads.js
const express = require("express");
const router = express.Router();

const Thread = require("../models/Thread");
const ThreadReply = require("../models/ThreadReply");
const Community = require("../models/Community");
const User = require("../models/User");

const ThreadKudos = require("../models/ThreadKudos");

// Small helper to normalize ObjectId/string arrays
const normalizeIds = (arr = []) =>
  arr.map((m) => (typeof m === "string" ? m : m._id?.toString())).filter(Boolean);

/**
 * Helper: build full thread response with replies embedded
 * (even though replies are stored in a separate collection)
 */
const buildThreadResponse = async (threadId) => {
  const thread = await Thread.findById(threadId).populate(
    "author",
    "username handle profilePicture"
  );

  if (!thread) return null;

  const replies = await ThreadReply.find({ thread: threadId })
    .sort({ createdAt: 1 })
    .populate("author", "username handle profilePicture");

  const threadObj = thread.toObject();
  threadObj.replies = replies;
  return threadObj;
};

// GET /api/communities/:id/threads?userId=...
router.get("/communities/:id/threads", async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.query;

    const threads = await Thread.find({ community: id })
      .populate("author", "username handle profilePicture")
      .sort({ pinned: -1, lastActivityAt: -1 });

    // If no userId, just return plain threads like before
    if (!userId) {
      return res.json(threads);
    }

    // Get all kudos this user has given for these threads
    const threadIds = threads.map((t) => t._id);
    const userKudos = await ThreadKudos.find(
      { userId, threadId: { $in: threadIds } },
      "threadId"
    );

    const kudoedSet = new Set(userKudos.map((k) => k.threadId.toString()));

    const threadsWithFlags = threads.map((t) => {
      const obj = t.toObject();
      obj.hasKudoed = kudoedSet.has(t._id.toString());
      return obj;
    });

    res.json(threadsWithFlags);
  } catch (err) {
    console.error("Error fetching threads:", err);
    res.status(500).json({ error: "Failed to fetch threads" });
  }
});

// ============================================================================
// POST /api/communities/:id/threads
// Create a new thread
// ============================================================================
router.post("/communities/:id/threads", async (req, res) => {
  try {
    const { id } = req.params;
    const { authorId, title, body } = req.body;

    if (!authorId || !title || !body) {
      return res
        .status(400)
        .json({ error: "authorId, title, and body are required" });
    }

    const [community, author] = await Promise.all([
      Community.findById(id)
        .populate("administrator", "_id")
        .populate("moderators", "_id")
        .populate("members", "_id"),
      User.findById(authorId),
    ]);

    if (!community) return res.status(404).json({ error: "Community not found" });
    if (!author) return res.status(404).json({ error: "Author not found" });

    const authorIdStr = authorId.toString();
    const memberIds = normalizeIds(community.members);
    const adminId =
      community.administrator?._id?.toString() ||
      community.administrator?.toString();
    const moderatorIds = normalizeIds(community.moderators);

    const isAdmin = adminId === authorIdStr;
    const isModerator = moderatorIds.includes(authorIdStr);
    const isMember = isAdmin || isModerator || memberIds.includes(authorIdStr);

    // Require membership to start a thread
    if (!isMember) {
      return res
        .status(403)
        .json({ error: "You must be a member to start a thread" });
    }

    const thread = new Thread({
      community: id,
      author: authorId,
      title,
      body,
      replyCount: 0,
      lastActivityAt: new Date(),
    });

    await thread.save();

    const populated = await Thread.findById(thread._id).populate(
      "author",
      "username handle profilePicture"
    );

    res.status(201).json(populated);
  } catch (err) {
    console.error("Error creating thread:", err);
    res.status(500).json({ error: "Failed to create thread" });
  }
});

// ============================================================================
// GET /api/threads/:threadId?userId=...
// Basic thread metadata + hasKudoed for that user
// ============================================================================
router.get("/threads/:threadId", async (req, res) => {
  try {
    const { threadId } = req.params;
    const { userId } = req.query;

    const thread = await Thread.findById(threadId).populate(
      "author",
      "username handle profilePicture"
    );

    if (!thread) {
      return res.status(404).json({ error: "Thread not found" });
    }

    let hasKudoed = false;

    if (userId) {
      const existing = await ThreadKudos.exists({ threadId, userId });
      hasKudoed = !!existing;
    }

    const threadObj = thread.toObject();
    threadObj.hasKudoed = hasKudoed;

    res.json(threadObj);
  } catch (err) {
    console.error("Error fetching thread:", err);
    res.status(500).json({ error: "Failed to fetch thread" });
  }
});

// ============================================================================
// GET /api/threads/:threadId/replies?page=1&limit=20
// Paginated replies for infinite scroll
// ============================================================================
router.get("/threads/:threadId/replies", async (req, res) => {
  try {
    const { threadId } = req.params;
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(parseInt(req.query.limit || "20", 10), 50);
    const skip = (page - 1) * limit;

    const threadExists = await Thread.exists({ _id: threadId });
    if (!threadExists) return res.status(404).json({ error: "Thread not found" });

    const [replies, total] = await Promise.all([
      ThreadReply.find({ thread: threadId })
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(limit)
        .populate("author", "username handle profilePicture"),
      ThreadReply.countDocuments({ thread: threadId }),
    ]);

    const hasMore = skip + replies.length < total;

    res.json({ replies, page, limit, total, hasMore });
  } catch (err) {
    console.error("Error fetching replies:", err);
    res.status(500).json({ error: "Failed to fetch replies" });
  }
});

// ============================================================================
// POST /api/threads/:threadId/kudos
// Toggle kudos (give / un-give) for a user
// ============================================================================
router.post("/threads/:threadId/kudos", async (req, res) => {
  const { userId } = req.body;
  const { threadId } = req.params;

  if (!userId) {
    return res.status(400).json({ error: "userId required" });
  }

  try {
    // Check if this user already kudoed this thread
    const existing = await ThreadKudos.findOne({ threadId, userId });

    if (existing) {
      // 👉 UN-GIVE KUDOS
      await ThreadKudos.deleteOne({ _id: existing._id });

      const kudosCount = await ThreadKudos.countDocuments({ threadId });
      await Thread.findByIdAndUpdate(threadId, { kudos: kudosCount });

      return res.json({
        kudos: kudosCount,
        hasKudoed: false,   // current state AFTER toggle
      });
    }

    // 👉 FIRST TIME: GIVE KUDOS
    await ThreadKudos.create({ threadId, userId });

    const kudosCount = await ThreadKudos.countDocuments({ threadId });
    await Thread.findByIdAndUpdate(threadId, { kudos: kudosCount });

    return res.json({
      kudos: kudosCount,
      hasKudoed: true,      // current state AFTER toggle
    });
  } catch (err) {
    console.error("KUDOS ERROR:", err);
    return res.status(500).json({ error: "Could not toggle Kudos" });
  }
});

// ============================================================================
// POST /api/threads/:threadId/replies
// Add a reply (with optional parentReplyId for nesting)
// ============================================================================
router.post("/threads/:threadId/replies", async (req, res) => {
  try {
    const { threadId } = req.params;
    const { authorId, body, parentReplyId } = req.body;

    if (!authorId || !body) {
      return res.status(400).json({ error: "authorId and body are required" });
    }

    const thread = await Thread.findById(threadId).populate(
      "community",
      "members administrator moderators"
    );
    if (!thread) return res.status(404).json({ error: "Thread not found" });

    if (thread.locked) {
      return res.status(403).json({ error: "Thread is locked" });
    }

    const community = thread.community;
    const authorIdStr = authorId.toString();

    const memberIds = normalizeIds(community.members);
    const adminId =
      community.administrator?._id?.toString() ||
      community.administrator?.toString();
    const moderatorIds = normalizeIds(community.moderators);

    const isAdmin = adminId === authorIdStr;
    const isModerator = moderatorIds.includes(authorIdStr);
    const isMember = isAdmin || isModerator || memberIds.includes(authorIdStr);

    if (!isMember) {
      return res.status(403).json({ error: "You must be a member to reply" });
    }

    let parentReply = null;

    if (parentReplyId) {
      parentReply = await ThreadReply.findById(parentReplyId);
      if (!parentReply) {
        return res.status(400).json({ error: "Parent reply not found" });
      }
      if (parentReply.thread.toString() !== threadId.toString()) {
        return res
          .status(400)
          .json({ error: "Parent reply does not belong to this thread" });
      }
    }

    await ThreadReply.create({
      thread: thread._id,
      author: authorId,
      body,
      parentReply: parentReply ? parentReply._id : null,
    });

    thread.replyCount = (thread.replyCount || 0) + 1;
    thread.lastActivityAt = new Date();
    await thread.save();

    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error("Error adding reply:", err);
    res.status(500).json({ error: "Failed to add reply" });
  }
});

module.exports = router;