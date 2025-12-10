const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const Bulletin = require('../models/Bulletin');
const User = require('../models/User');
const Report = require('../models/Report');
const Notification = require('../models/Notification');
const Interaction = require('../models/Interaction');

const Friendship = require('../models/Friendship');

const { getFreeformTagsForBulletin } = require("../utils/aiTagger");

const ObjectId = mongoose.Types.ObjectId;

// -----------------------------------------------------------------------------
// Scaling / tuning constants
// -----------------------------------------------------------------------------

// How far back "My Mix" should look
const MYMIX_WINDOW_DAYS = 4;
// Max number of candidates to pull from each MyMix source before combining
const MYMIX_SOURCE_LIMIT = 200;

// Trending window & candidate cap
const TRENDING_WINDOW_DAYS = 4;
const TRENDING_CANDIDATE_LIMIT = 500;

// Bulletin content limits
const TEXT_MAX = 1500;
const CAPTION_MAX = 500;

// Very simple HTML tag detector (allows things like "<3")
const HTML_TAG_REGEX = /<\/?[a-z][^>]*>/i;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const getPagination = (req) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50); // cap at 50
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const findOriginalBulletin = async (bulletin) => {
  let current = bulletin;
  while (current && current.repostOf) {
    current = await Bulletin.findById(current.repostOf);
  }
  return current || bulletin;
};

const populateBulletin = async (bulletinId) => {
  return Bulletin.findById(bulletinId)
    .populate('userId', 'username displayName profilePicture')
    .populate('communityId', 'name')
    .populate({
      path: 'comments.user',
      select: 'username displayName profilePicture',
    })
    .populate({
      path: 'comments.replies.user',
      select: 'username displayName profilePicture',
    })
    .populate({
      path: 'comments.replies.replies.user',
      select: 'username displayName profilePicture',
    })
    .populate({
      path: 'comments.replies.replies.replies.user',
      select: 'username displayName profilePicture',
    });
};

const findCommentRecursive = (comments, commentId) => {
  for (const comment of comments) {
    if (comment._id.equals(commentId)) {
      return { target: comment, parentArray: comments };
    }
    if (comment.replies && comment.replies.length > 0) {
      const result = findCommentRecursive(comment.replies, commentId);
      if (result) return result;
    }
  }
  return null;
};

// -----------------------------------------------------------------------------
// AI Personalization Helpers
// -----------------------------------------------------------------------------

const INTERACTION_WEIGHTS = {
  like: 3,
  repost: 4,
  comment: 4,
  view: 0.5,
};

async function updateUserInterestTags(userId, bulletinId, interactionType) {
  if (!userId || !bulletinId) return; // guard against bad calls

  const weight = INTERACTION_WEIGHTS[interactionType] || 1;

  const [user, bulletin] = await Promise.all([
    User.findById(userId),
    Bulletin.findById(bulletinId).select("tags"),
  ]);

  if (!user || !bulletin || !bulletin.tags?.length) return;

  // Ensure we have a Map
  if (!user.interestTags) {
    user.interestTags = new Map();
  }

  bulletin.tags.forEach((tag) => {
    const current = user.interestTags.get(tag) || 0;
    const updated = Math.min(current + weight, 200);
    user.interestTags.set(tag, updated);
  });

  await user.save();
}

// -----------------------------------------------------------------------------
// POST routes
// -----------------------------------------------------------------------------

// Create new bulletin with community approval logic + validation + AI tagging
router.post('/', async (req, res) => {
  try {
    const { userId, type, content, mediaUrl, communityId } = req.body;

    if (!userId || !type) {
      return res.status(400).json({ error: 'userId and type are required.' });
    }

    const allowedTypes = ['text', 'image', 'video'];
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({ error: 'Invalid bulletin type.' });
    }

    // Normalize content
    const raw = typeof content === 'string' ? content : '';
    const trimmed = raw.trim();

    // Decide max length based on type
    const maxLength = type === 'text' ? TEXT_MAX : CAPTION_MAX;

    // TEXT posts: require non-empty content
    if (type === 'text') {
      if (!trimmed) {
        return res.status(400).json({ error: 'Content cannot be empty.' });
      }
      if (trimmed.length > maxLength) {
        return res.status(400).json({
          error: `Content exceeds maximum length of ${maxLength} characters.`,
        });
      }
      // Block HTML tags in text
      if (HTML_TAG_REGEX.test(trimmed)) {
        return res.status(400).json({
          error: 'HTML is not allowed in bulletins.',
        });
      }
    }

    // IMAGE / VIDEO posts: caption optional, but must respect length & no HTML
    if (type === 'image' || type === 'video') {
      // Must have a media URL for non-text posts
      if (!mediaUrl || !mediaUrl.trim()) {
        return res.status(400).json({
          error: 'Media is required for image/video bulletins.',
        });
      }

      if (trimmed.length > maxLength) {
        return res.status(400).json({
          error: `Caption exceeds maximum length of ${maxLength} characters.`,
        });
      }

      if (trimmed && HTML_TAG_REGEX.test(trimmed)) {
        return res.status(400).json({
          error: 'HTML is not allowed in bulletins.',
        });
      }
    }

    // --- Community approval logic ---
    let approved = true;
    let communityName = null;
    let community = null;

    if (communityId) {
      const Community = require('../models/Community');
      community = await Community.findById(communityId);
      if (community?.requireApproval) {
        approved = false;
        await Community.findByIdAndUpdate(communityId, {
          $inc: { pendingBulletins: 1 },
        });
      }
      communityName = community?.name || null;
    }

    // --- Create bulletin document ---
    const bulletin = new Bulletin({
      userId,
      type,
      content: trimmed, // store trimmed text / caption
      mediaUrl,
      communityId: communityId || null,
      approved,
    });

    // --- Let AI decide the tags (non-blocking-ish: if it fails, we still save) ---
    try {
      const { tags } = await getFreeformTagsForBulletin({
        content: trimmed,
        caption: type === 'text' ? null : trimmed,
        communityName,
        imageUrl: type === 'image' ? mediaUrl : null, // 👈 NEW
      });

      if (Array.isArray(tags) && tags.length > 0) {
        bulletin.tags = tags;
      }
    } catch (tagErr) {
      console.error('AI tagging failed for bulletin:', tagErr);
      // don’t throw; we still want the bulletin to be created
    }

    await bulletin.save();
    res.status(201).json(bulletin);
  } catch (err) {
    console.error('Create bulletin error:', err);
    res.status(500).json({ error: 'Failed to create bulletin.' });
  }
});

// Report bulletin
router.post('/:id/report', async (req, res) => {
  try {
    const { userId, priority } = req.body;
    const bulletinId = req.params.id;

    const bulletin = await Bulletin.findById(bulletinId).populate('userId');
    if (!bulletin) {
      return res.status(404).json({ error: 'Bulletin not found' });
    }

    bulletin.reported = true;
    await bulletin.save();

    const newReport = new Report({
      contentId: bulletin._id,
      contentType: 'bulletin',
      contentText: bulletin.content,
      userId: bulletin.userId._id,
      reportedBy: userId,
      type: 'Bulletin',
      priority: priority || 'medium',
    });

    await newReport.save();

    res.json({ message: 'Reported successfully' });
  } catch (err) {
    console.error('Report bulletin error:', err);
    res.status(500).json({ error: 'Failed to report' });
  }
});

// Toggle like on bulletin (always on original)
router.post('/:id/like', async (req, res) => {
  try {
    const { userId } = req.body;
    let bulletin = await Bulletin.findById(req.params.id).populate('userId');
    if (!bulletin) {
      return res.status(404).json({ error: 'Bulletin not found' });
    }

    const original = await findOriginalBulletin(bulletin);
    const alreadyLiked = original.likes.some(
      (id) => id.toString() === userId
    );

    if (alreadyLiked) {
      original.likes.pull(new mongoose.Types.ObjectId(userId));
    } else {
      original.likes.push(new mongoose.Types.ObjectId(userId));

      // notification (not for self-like)
      if (original.userId._id.toString() !== userId) {
        const newNotification = new Notification({
          type: 'like',
          fromUser: userId,
          toUser: original.userId._id,
          bulletinId: original._id,
        });
        await newNotification.save();
      }

      // interaction log
      await Interaction.create({
        userId,
        bulletinId: original._id,
        type: 'like',
      });

      await updateUserInterestTags(userId, original._id, "like");

    }

    await original.save();
    const updated = await populateBulletin(req.params.id);
    res.json(updated);
  } catch (err) {
    console.error('LIKE ERROR:', err);
    res
      .status(500)
      .json({ error: 'Failed to toggle like.', details: err.message });
  }
});

// Repost bulletin (always from original)
router.post('/:id/repost', async (req, res) => {
  try {
    const { userId } = req.body;
    let original = await Bulletin.findById(req.params.id).populate('userId');
    if (!original) {
      return res.status(404).json({ error: 'Original bulletin not found' });
    }

    original = await findOriginalBulletin(original);

    const repostBulletin = new Bulletin({
      userId,
      type: original.type,
      content: original.content,
      mediaUrl: original.mediaUrl,
      repostOf: original._id,
      communityId: null,
    });

    await repostBulletin.save();
    original.reposts.push(repostBulletin._id);
    await original.save();

    // notification (not for self-repost)
    if (original.userId._id.toString() !== userId) {
      const newNotification = new Notification({
        type: 'repost',
        fromUser: userId,
        toUser: original.userId._id,
        bulletinId: original._id,
      });
      await newNotification.save();
    }

    // interaction log
    await Interaction.create({
      userId,
      bulletinId: original._id,
      type: 'repost',
    });

    await updateUserInterestTags(userId, original._id, "repost");

    const populatedRepost = await populateBulletin(repostBulletin._id);
    res.status(201).json(populatedRepost);
  } catch (err) {
    console.error('Repost error:', err);
    res.status(500).json({ error: 'Failed to repost bulletin.' });
  }
});

// Add top-level comment
router.post('/:id/comment', async (req, res) => {
  try {
    const { userId, text } = req.body;
    const bulletin = await Bulletin.findById(req.params.id);
    if (!bulletin) {
      return res.status(404).json({ error: 'Bulletin not found' });
    }

    bulletin.comments.push({
      user: userId,
      text,
      createdAt: new Date(),
      likes: [],
      replies: [],
      isNewComment: true,
    });

    if (bulletin.userId.toString() !== userId) {
      await User.findByIdAndUpdate(bulletin.userId, {
        $inc: { 'dashboardData.newComments': 1 },
      });
    }

    await bulletin.save();

    await Interaction.create({
      userId,
      bulletinId: bulletin._id,
      type: 'comment',
    });

    await updateUserInterestTags(userId, bulletin._id, "comment");

    const updatedBulletin = await populateBulletin(req.params.id);
    res.json(updatedBulletin);
  } catch (err) {
    console.error('Add comment error:', err);
    res.status(500).json({ error: 'Failed to add comment.' });
  }
});

// Reply to comment (any depth)
router.post('/:bulletinId/comments/:commentId/reply', async (req, res) => {
  try {
    const { bulletinId, commentId } = req.params;
    const { userId, text } = req.body;

    const bulletin = await Bulletin.findById(bulletinId);
    if (!bulletin) {
      return res.status(404).json({ error: 'Bulletin not found' });
    }

    const found = findCommentRecursive(bulletin.comments, commentId);
    if (!found || !found.target) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    const target = found.target;
    if (!target.replies) target.replies = [];

    target.replies.push({
      user: userId,
      text,
      createdAt: new Date(),
      likes: [],
      replies: [],
      isNewComment: true,
    });

    bulletin.markModified('comments');
    await bulletin.save();

    if (target.user && target.user.toString() !== userId) {
      await User.findByIdAndUpdate(target.user, {
        $inc: { 'dashboardData.newComments': 1 },
      });
    }

    const updatedBulletin = await populateBulletin(bulletinId);
    res.json(updatedBulletin);
  } catch (err) {
    console.error('Reply error:', err);
    res.status(500).json({ error: 'Failed to add reply.' });
  }
});

// Mark all comments as read for a user
router.post('/comments/mark-all-read/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const bulletins = await Bulletin.find({ userId });

    const clearIsNew = (comments) => {
      for (const comment of comments) {
        if (comment.isNewComment) comment.isNewComment = false;
        if (comment.replies && comment.replies.length > 0) {
          clearIsNew(comment.replies);
        }
      }
    };

    for (const b of bulletins) {
      clearIsNew(b.comments);
      b.markModified('comments');
      await b.save();
    }

    await User.findByIdAndUpdate(userId, {
      'dashboardData.newComments': 0,
    });

    res.json({ message: 'All comments marked as read' });
  } catch (err) {
    console.error('Mark-all-read error:', err);
    res.status(500).json({ error: 'Failed to mark comments as read' });
  }
});

// Log bulletin view
router.post('/:id/view', async (req, res) => {
  try {
    const { userId } = req.body;
    await Interaction.create({
      userId,
      bulletinId: req.params.id,
      type: 'view',
    });

    await updateUserInterestTags(userId, req.params.id, "view");

    res.json({ message: 'View logged' });
  } catch (err) {
    console.error('Log view error:', err);
    res.status(500).json({ error: 'Failed to log view.' });
  }
});

// -----------------------------------------------------------------------------
// DELETE routes
// -----------------------------------------------------------------------------

// Delete bulletin and all reposts recursively
router.delete('/:id', async (req, res) => {
  try {
    const bulletinId = req.params.id;
    const original = await Bulletin.findById(bulletinId);
    if (!original) {
      return res.status(404).json({ error: 'Bulletin not found' });
    }

    async function deleteRepostsRecursive(bulletin) {
      const reposts = await Bulletin.find({ repostOf: bulletin._id });
      for (const repost of reposts) {
        await deleteRepostsRecursive(repost);
        await Bulletin.findByIdAndDelete(repost._id);
      }
    }

    await deleteRepostsRecursive(original);
    await Bulletin.findByIdAndDelete(bulletinId);

    res.json({ message: 'Bulletin and all reposts deleted successfully.' });
  } catch (err) {
    console.error('Delete bulletin error:', err);
    res.status(500).json({ error: 'Failed to delete bulletin.' });
  }
});

// -----------------------------------------------------------------------------
// PUT routes
// -----------------------------------------------------------------------------

// Approve a bulletin (for communities that require approval)
router.put('/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const bulletin = await Bulletin.findById(id);
    if (!bulletin) {
      return res.status(404).json({ error: 'Bulletin not found.' });
    }

    bulletin.approved = true;

    if (bulletin.communityId) {
      const Community = require('../models/Community');
      await Community.findByIdAndUpdate(bulletin.communityId, {
        $inc: { pendingBulletins: -1 },
      });
    }

    await bulletin.save();

    res.json({ message: 'Bulletin approved.' });
  } catch (err) {
    console.error('Approve bulletin error:', err);
    res.status(500).json({ error: 'Failed to approve bulletin.' });
  }
});

// -----------------------------------------------------------------------------
// GET routes – specific first
// -----------------------------------------------------------------------------

// Get bulletins for user (optional friends filter + pagination)
router.get('/user/:userId', async (req, res) => {
  try {
    const { filter } = req.query;
    const { userId } = req.params;
    const { page, limit, skip } = getPagination(req);

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const Friendship = require('../models/Friendship');

    const friendships = await Friendship.find({
      $or: [
        { requester: userId, status: 'accepted' },
        { recipient: userId, status: 'accepted' },
      ],
    });

    const friendIds = friendships.map((f) =>
      f.requester.toString() === userId ? f.recipient : f.requester
    );
    const friendObjectIds = friendIds.map((id) => new ObjectId(id));
    const userObjectId = new ObjectId(userId);

    let query;
    if (filter === 'friends') {
      query = {
        userId: { $in: [...friendObjectIds, userObjectId] },
        communityId: null,
      };
    } else {
      query = { userId: userId, communityId: null };
    }

    const [bulletins, total] = await Promise.all([
      Bulletin.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('userId', 'username displayName profilePicture')
        .populate('reposts')
        .populate('repostedBy', 'username displayName profilePicture')
        .populate('communityId', 'name')
        .populate('amaQuestionUser', 'username displayName profilePicture')
        .populate('amaAnswerUser', 'username displayName profilePicture')
        .populate({
          path: 'repostOf',
          populate: [
            {
              path: 'userId',
              select: 'username displayName profilePicture',
            },
            { path: 'communityId', select: 'name' },
            {
              path: 'comments.user',
              select: 'username displayName profilePicture',
            },
            {
              path: 'comments.replies.user',
              select: 'username displayName profilePicture',
            },
            {
              path: 'comments.replies.replies.user',
              select: 'username displayName profilePicture',
            },
            {
              path: 'amaQuestionUser',
              select: 'username displayName profilePicture',
            },
            {
              path: 'amaAnswerUser',
              select: 'username displayName profilePicture',
            },
          ],
        })
        .populate({
          path: 'comments.user',
          select: 'username displayName profilePicture',
        })
        .populate({
          path: 'comments.replies.user',
          select: 'username displayName profilePicture',
        })
        .populate({
          path: 'comments.replies.replies.user',
          select: 'username displayName profilePicture',
        }),
      Bulletin.countDocuments(query),
    ]);

    const hasMore = skip + bulletins.length < total;

    res.json({
      items: bulletins,
      page,
      limit,
      total,
      hasMore,
    });
  } catch (err) {
    console.error('Get user bulletins error:', err);
    res.status(500).json({ error: 'Failed to fetch bulletins.' });
  }
});

// Get bulletins for a community (only approved originals)
router.get('/community/:communityId', async (req, res) => {
  try {
    const { communityId } = req.params;

    const bulletins = await Bulletin.find({
      communityId,
      repostOf: null,
      approved: true,
    })
      .sort({ createdAt: -1 })
      .populate('userId', 'username displayName profilePicture')
      .populate('reposts')
      .populate('repostedBy', 'username displayName profilePicture')
      .populate('communityId', 'name')
      .populate('amaQuestionUser', 'username displayName profilePicture')
      .populate('amaAnswerUser', 'username displayName profilePicture')
      .populate({
        path: 'repostOf',
        populate: [
          {
            path: 'userId',
            select: 'username displayName profilePicture',
          },
          { path: 'communityId', select: 'name' },
          {
            path: 'comments.user',
            select: 'username displayName profilePicture',
          },
          {
            path: 'comments.replies.user',
            select: 'username displayName profilePicture',
          },
          {
            path: 'comments.replies.replies.user',
            select: 'username displayName profilePicture',
          },
          {
            path: 'amaQuestionUser',
            select: 'username displayName profilePicture',
          },
          {
            path: 'amaAnswerUser',
            select: 'username displayName profilePicture',
          },
        ],
      })
      .populate({
        path: 'comments.user',
        select: 'username displayName profilePicture',
      })
      .populate({
        path: 'comments.replies.user',
        select: 'username displayName profilePicture',
      })
      .populate({
        path: 'comments.replies.replies.user',
        select: 'username displayName profilePicture',
      });

    res.json(bulletins);
  } catch (err) {
    console.error('Get community bulletins error:', err);
    res.status(500).json({ error: 'Failed to fetch community bulletins.' });
  }
});

// Get bulletin count for a community
router.get('/community/:communityId/count', async (req, res) => {
  try {
    const { communityId } = req.params;
    const count = await Bulletin.countDocuments({ communityId });
    res.json({ count });
  } catch (err) {
    console.error('Count community bulletins error:', err);
    res.status(500).json({ error: 'Failed to count community bulletins.' });
  }
});

// Get unapproved bulletins for a community
router.get('/unapproved/:communityId', async (req, res) => {
  try {
    const { communityId } = req.params;
    const bulletins = await Bulletin.find({
      communityId,
      approved: false,
    })
      .sort({ createdAt: -1 })
      .populate('userId', 'username displayName profilePicture');

    res.json(bulletins);
  } catch (err) {
    console.error('Get unapproved bulletins error:', err);
    res.status(500).json({ error: 'Failed to fetch unapproved bulletins.' });
  }
});

// Personalized "For You" feed – mix of interest posts, friend posts, and trending
router.get("/for-you/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId).lean();
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const now = Date.now();

    // Windows
    const INTEREST_WINDOW_DAYS = 21; // ~3 weeks
    const FRIEND_WINDOW_DAYS = 4;    // super fresh friend posts
    const TRENDING_WINDOW_DAYS_LOCAL = 21;

    const interestSince = new Date(now - INTEREST_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const friendSince = new Date(now - FRIEND_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const trendingSince = new Date(now - TRENDING_WINDOW_DAYS_LOCAL * 24 * 60 * 60 * 1000);

    // -----------------------------------------------------------------------
    // 1) Build tag map / interest-based posts
    // -----------------------------------------------------------------------
    const tagMap = user.interestTags || {};
    const entries = Array.from(
      tagMap instanceof Map ? tagMap.entries() : Object.entries(tagMap)
    );

    let interestPosts = [];

    if (entries.length) {
      // top 15 tags
      entries.sort((a, b) => b[1] - a[1]);
      const topTags = entries.slice(0, 15).map(([tag]) => tag);

      const interestCandidates = await Bulletin.find({
        createdAt: { $gte: interestSince },
        tags: { $in: topTags },
      })
        .populate("userId", "username displayName profilePicture")
        .lean();

      interestPosts = interestCandidates.map((b) => {
        const ageHours =
          (now - new Date(b.createdAt).getTime()) / (1000 * 60 * 60);

        const notes = (b.likes?.length || 0) + (b.reposts?.length || 0);

        let tagScore = 0;
        (b.tags || []).forEach((tag) => {
          const val =
            tagMap instanceof Map ? tagMap.get(tag) : tagMap[tag];
          if (val) tagScore += val;
        });

        let score = 0;
        score += tagScore;                   // personalization
        score += Math.max(0, 15 - ageHours); // recency
        score += Math.log1p(notes);          // popularity

        return { ...b, _score: score };
      });

      interestPosts.sort((a, b) => b._score - a._score);
    }

    // -----------------------------------------------------------------------
    // 2) Friend posts (very recent)
    // -----------------------------------------------------------------------
    const friendships = await Friendship.find({
      $or: [
        { requester: userId, status: "accepted" },
        { recipient: userId, status: "accepted" },
      ],
    }).lean();

    const friendIds = friendships.map((f) =>
      f.requester.toString() === userId ? f.recipient : f.requester
    );

    const friendObjectIds = friendIds.map((id) => new mongoose.Types.ObjectId(id));
    const userObjectId = new mongoose.Types.ObjectId(userId);

    let friendPosts = [];

    if (friendObjectIds.length) {
      const friendCandidates = await Bulletin.find({
        createdAt: { $gte: friendSince },
        userId: { $in: [...friendObjectIds, userObjectId] },
      })
        .populate("userId", "username displayName profilePicture")
        .lean();

      friendPosts = friendCandidates.map((b) => {
        const ageHours =
          (now - new Date(b.createdAt).getTime()) / (1000 * 60 * 60);
        const notes = (b.likes?.length || 0) + (b.reposts?.length || 0) + (b.comments?.length || 0);

        let score = 0;
        score += Math.max(0, 24 - ageHours); // very recency-weighted
        score += Math.log1p(notes);          // engagement at least a bit

        return { ...b, _score: score };
      });

      friendPosts.sort((a, b) => b._score - a._score);
    }

    // -----------------------------------------------------------------------
    // 3) Trending posts (sitewide, last 3 weeks, original posts)
    // -----------------------------------------------------------------------
    const trendingCandidates = await Bulletin.find({
      repostOf: null,
      createdAt: { $gte: trendingSince },
    })
      .populate("userId", "username displayName profilePicture")
      .lean();

    let trendingPosts = trendingCandidates.map((b) => {
      const likes = b.likes?.length || 0;
      const reposts = b.reposts?.length || 0;
      const comments = b.comments?.length || 0;
      const views = 0; // not tracked yet

      const rawScore = likes * 3 + reposts * 2 + comments * 2 + views;
      const hoursSinceCreated =
        Math.abs(now - new Date(b.createdAt).getTime()) / 36e5;
      const decayFactor = 1.2;

      const score = rawScore / Math.pow(hoursSinceCreated + 2, decayFactor);
      return { ...b, _score: score };
    });

    trendingPosts.sort((a, b) => b._score - a._score);

    // -----------------------------------------------------------------------
    // 4) Deduplicate IDs across buckets
    // -----------------------------------------------------------------------
    const seen = new Set();

    const dedupe = (arr) => {
      const out = [];
      for (const item of arr) {
        const id = item._id.toString();
        if (!seen.has(id)) {
          seen.add(id);
          out.push(item);
        }
      }
      return out;
    };

    interestPosts = dedupe(interestPosts);
    friendPosts = dedupe(friendPosts);
    trendingPosts = dedupe(trendingPosts);

    // -----------------------------------------------------------------------
    // 5) Choose counts from each bucket, then shuffle them together
    // -----------------------------------------------------------------------
    const MAX_TOTAL = 50;

    const targetInterest = Math.floor(MAX_TOTAL * 0.5); // ~50%
    const targetFriends = Math.floor(MAX_TOTAL * 0.3);  // ~30%
    const targetTrending = MAX_TOTAL - targetInterest - targetFriends; // ~20%

    const chosenInterest = interestPosts.slice(0, targetInterest);
    const remainingAfterInterest = MAX_TOTAL - chosenInterest.length;

    const chosenFriends = friendPosts.slice(
      0,
      Math.min(targetFriends, remainingAfterInterest)
    );
    const remainingAfterFriends =
      MAX_TOTAL - chosenInterest.length - chosenFriends.length;

    const chosenTrending = trendingPosts.slice(
      0,
      Math.min(targetTrending, remainingAfterFriends)
    );

    let combined = [
      ...chosenInterest,
      ...chosenFriends,
      ...chosenTrending,
    ];

    // If user has no interest tags at all, or buckets are super small,
    // fall back to just "recent everything" so feed isn't empty.
    if (!combined.length) {
      const fallback = await Bulletin.find()
        .sort({ createdAt: -1 })
        .limit(MAX_TOTAL)
        .populate("userId", "username displayName profilePicture")
        .lean();

      return res.json(fallback);
    }

    // Fisher–Yates shuffle so they are mixed, not in big blocks
    for (let i = combined.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [combined[i], combined[j]] = [combined[j], combined[i]];
    }

    // Strip the helper score field before sending
    combined = combined.map(({ _score, ...rest }) => rest);

    res.json(combined);
  } catch (err) {
    console.error("Error in /for-you:", err);
    res.status(500).json({ error: "Failed to fetch personalized feed" });
  }
});

// Trending bulletins (originals, thresholded, shuffled, paginated)
router.get('/trending', async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req);

    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - TRENDING_WINDOW_DAYS);

    // Only original bulletins in the recent window, cap candidates
    const bulletins = await Bulletin.find({
      repostOf: null,
      createdAt: { $gte: windowStart },
    })
      .sort({ createdAt: -1 })
      .limit(TRENDING_CANDIDATE_LIMIT)
      .populate('userId', 'username displayName profilePicture')
      .populate('reposts')
      .populate('repostedBy', 'username displayName profilePicture')
      .populate('communityId', 'name')
      .populate('amaQuestionUser', 'username displayName profilePicture')
      .populate('amaAnswerUser', 'username displayName profilePicture')
      .populate({
        path: 'repostOf',
        populate: [
          {
            path: 'userId',
            select: 'username displayName profilePicture',
          },
          { path: 'communityId', select: 'name' },
          {
            path: 'comments.user',
            select: 'username displayName profilePicture',
          },
          {
            path: 'comments.replies.user',
            select: 'username displayName profilePicture',
          },
          {
            path: 'comments.replies.replies.user',
            select: 'username displayName profilePicture',
          },
          {
            path: 'amaQuestionUser',
            select: 'username displayName profilePicture',
          },
          {
            path: 'amaAnswerUser',
            select: 'username displayName profilePicture',
          },
        ],
      })
      .populate({
        path: 'comments.user',
        select: 'username displayName profilePicture',
      })
      .populate({
        path: 'comments.replies.user',
        select: 'username displayName profilePicture',
      })
      .populate({
        path: 'comments.replies.replies.user',
        select: 'username displayName profilePicture',
      });

    const now = new Date();
    const thresholdScore = 5;

    const scoredBulletins = bulletins.map((b) => {
      const likes = b.likes.length;
      const reposts = b.reposts.length;
      const comments = b.comments.length;
      const views = 0;

      const rawScore = likes * 3 + reposts * 2 + comments * 2 + views;
      const hoursSinceCreated = Math.abs(now - b.createdAt) / 36e5;
      const decayFactor = 1.2;

      const finalScore =
        rawScore / Math.pow(hoursSinceCreated + 2, decayFactor);

      return { bulletin: b, score: finalScore };
    });

    const filtered = scoredBulletins.filter(
      (entry) => entry.score >= thresholdScore
    );

    // Shuffle
    for (let i = filtered.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [filtered[i], filtered[j]] = [filtered[j], filtered[i]];
    }

    const orderedBulletins = filtered.map((entry) => entry.bulletin);

    const total = orderedBulletins.length;
    const sliced = orderedBulletins.slice(skip, skip + limit);
    const hasMore = skip + sliced.length < total;

    res.json({
      items: sliced,
      page,
      limit,
      total,
      hasMore,
    });
  } catch (err) {
    console.error('Failed to fetch trending bulletins:', err);
    res.status(500).json({ error: 'Failed to fetch trending bulletins' });
  }
});

// Get all comments (and nested replies) on user's bulletins
router.get('/comments/new/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;

    const bulletins = await Bulletin.find({ userId })
      .populate({
        path: 'comments.user',
        select: 'username displayName profilePicture',
      })
      .populate({
        path: 'comments.replies.user',
        select: 'username displayName profilePicture',
      })
      .populate({
        path: 'comments.replies.replies.user',
        select: 'username displayName profilePicture',
      })
      .populate({
        path: 'comments.replies.replies.replies.user',
        select: 'username displayName profilePicture',
      });

    const allComments = [];

    const traverseReplies = (replies, bulletin) => {
      for (const reply of replies) {
        allComments.push({
          commentId: reply._id,
          text: reply.text,
          createdAt: reply.createdAt,
          commenter: reply.user,
          bulletinId: bulletin._id,
          bulletinContent: bulletin.content,
          bulletinMediaUrl: bulletin.mediaUrl,
          isNewComment: reply.isNewComment,
        });

        if (reply.replies && reply.replies.length > 0) {
          traverseReplies(reply.replies, bulletin);
        }
      }
    };

    for (const b of bulletins) {
      for (const c of b.comments) {
        allComments.push({
          commentId: c._id,
          text: c.text,
          createdAt: c.createdAt,
          commenter: c.user,
          bulletinId: b._id,
          bulletinContent: b.content,
          bulletinMediaUrl: b.mediaUrl,
          isNewComment: c.isNewComment,
        });

        if (c.replies && c.replies.length > 0) {
          traverseReplies(c.replies, b);
        }
      }
    }

    allComments.sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    res.json(allComments);
  } catch (err) {
    console.error('Get new comments error:', err);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

// -----------------------------------------------------------------------------
// Generic GET – MUST be last
// -----------------------------------------------------------------------------

// Get single bulletin by ID
router.get('/:id', async (req, res) => {
  try {
    const bulletin = await populateBulletin(req.params.id);
    if (!bulletin) {
      return res.status(404).json({ error: 'Bulletin not found' });
    }
    res.json(bulletin);
  } catch (err) {
    console.error('Get bulletin error:', err);
    res.status(500).json({ error: 'Failed to fetch bulletin.' });
  }
});

module.exports = router;