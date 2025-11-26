const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const Bulletin = require('../models/Bulletin');
const User = require('../models/User');
const Report = require('../models/Report');
const Notification = require('../models/Notification');
const Interaction = require('../models/Interaction');

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
// POST routes
// -----------------------------------------------------------------------------

// Create new bulletin with community approval logic + validation
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

    if (communityId) {
      const Community = require('../models/Community');
      const community = await Community.findById(communityId);
      if (community?.requireApproval) {
        approved = false;
        await Community.findByIdAndUpdate(communityId, {
          $inc: { pendingBulletins: 1 },
        });
      }
    }

    const bulletin = new Bulletin({
      userId,
      type,
      content: trimmed, // store trimmed
      mediaUrl,
      communityId: communityId || null,
      approved,
    });

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

// "My Mix" personalized bulletin feed
router.get('/myMix/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { page, limit, skip } = getPagination(req);

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const Friendship = require('../models/Friendship');
    const Community = require('../models/Community');

    const friendships = await Friendship.find({
      $or: [
        { requester: userId, status: 'accepted' },
        { recipient: userId, status: 'accepted' },
      ],
    });

    const friendIds = friendships.map((f) =>
      f.requester.toString() === userId ? f.recipient : f.requester
    );

    // Communities the user is a member of
    const userCommunities = await Community.find({ members: userId }).select(
      '_id'
    );
    const communityIds = userCommunities.map((c) => c._id);

    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - MYMIX_WINDOW_DAYS);

    // 1) Random original posts (last window, no community)
    const randomPosts = await Bulletin.find({
      repostOf: null,
      communityId: null,
      createdAt: { $gte: windowStart },
    })
      .sort({ createdAt: -1 })
      .limit(MYMIX_SOURCE_LIMIT);

    // 2) Friends' original posts (last window, no community)
    const friendsOriginalPosts = await Bulletin.find({
      userId: { $in: friendIds },
      repostOf: null,
      communityId: null,
      createdAt: { $gte: windowStart },
    })
      .sort({ createdAt: -1 })
      .limit(MYMIX_SOURCE_LIMIT);

    // 3) Friends' reposts (reposted in last window, no community)
    const friendsReposts = await Bulletin.find({
      userId: { $in: friendIds },
      repostOf: { $ne: null },
      communityId: null,
      createdAt: { $gte: windowStart },
    })
      .sort({ createdAt: -1 })
      .limit(MYMIX_SOURCE_LIMIT);

    // 4) Trending candidate posts (originals only, last window)
    const trendingCandidates = await Bulletin.find({
      repostOf: null,
      createdAt: { $gte: windowStart },
    })
      .sort({ createdAt: -1 })
      .limit(MYMIX_SOURCE_LIMIT);

    // 5) Community posts from joined communities (approved only)
    const communityPosts = await Bulletin.find({
      communityId: { $in: communityIds },
      repostOf: null,
      approved: true,
      createdAt: { $gte: windowStart },
    })
      .sort({ createdAt: -1 })
      .limit(MYMIX_SOURCE_LIMIT);

    // Calculate trending scores for trendingCandidates
    const now = new Date();
    const thresholdScore = 5;

    const scoredTrending = trendingCandidates.map((b) => {
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

    const trendingFiltered = scoredTrending
      .filter((entry) => entry.score >= thresholdScore)
      .map((entry) => entry.bulletin);

    // Combine sources
    const combined = [
      ...randomPosts,
      ...friendsOriginalPosts,
      ...friendsReposts,
      ...trendingFiltered,
      ...communityPosts,
    ];

    // Deduplicate
    const uniqueMap = new Map();
    combined.forEach((b) => {
      uniqueMap.set(b._id.toString(), b);
    });
    const uniqueBulletins = Array.from(uniqueMap.values());

    // Shuffle
    for (let i = uniqueBulletins.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [uniqueBulletins[i], uniqueBulletins[j]] = [
        uniqueBulletins[j],
        uniqueBulletins[i],
      ];
    }

    const total = uniqueBulletins.length;
    const sliced = uniqueBulletins.slice(skip, skip + limit);
    const hasMore = skip + sliced.length < total;

    // Populate only current page
    const populated = await Bulletin.populate(sliced, [
      { path: 'userId', select: 'username displayName profilePicture' },
      { path: 'communityId', select: 'name' },
      {
        path: 'comments.user',
        select: 'username displayName profilePicture',
      },
      {
        path: 'repostOf',
        populate: {
          path: 'userId',
          select: 'username displayName profilePicture',
        },
      },
    ]);

    res.json({
      items: populated,
      page,
      limit,
      total,
      hasMore,
    });
  } catch (err) {
    console.error('Failed to fetch My Mix bulletins:', err);
    res.status(500).json({ error: 'Failed to fetch My Mix bulletins' });
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