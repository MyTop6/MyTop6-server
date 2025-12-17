// routes/users.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt'); // 🔐 for password hashing
const User = require('../models/User');
const Question = require('../models/Question');
const mongoose = require('mongoose');

const DEFAULT_PROFILE_PICTURE = "/uploads/nophoto.png";

// 🔹 Treat anything with "nophoto" in it as a default placeholder
const isDefaultProfilePicture = (value) => {
  if (!value || typeof value !== "string") return true;
  const lower = value.toLowerCase();
  return lower.includes("nophoto");
};

// 🔢 Normalize phone: keep digits only, e.g. "(555) 123-4567" -> "5551234567"
function normalizePhone(phone) {
  if (!phone) return "";
  return String(phone).replace(/\D/g, "").trim();
}

// ✅ Coerce booleans safely ("false" -> false)
  const toBool = (v) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "string") return v.toLowerCase() === "true";
    if (typeof v === "number") return v === 1;
    return false;
  };

/* ===================================================================== */
/* 🔹 REGISTER NEW USER – CALLED FROM ExtraDetailsPage                    */
/* ===================================================================== */

router.post('/register', async (req, res) => {
  try {
    console.log('🔥 /api/users/register BODY =', req.body);

    const {
      phoneNumber,
      username,
      password,
      bio,
      handle,
      dob,       // from ExtraDetailsPage
      location,  // from ExtraDetailsPage
    } = req.body || {};

    console.log('REGISTER BODY:', req.body); // 🔍 debug: make sure dob & location are coming in

    if (!phoneNumber || !username || !password || !handle || !dob) {
      return res.status(400).json({
        error:
          'phoneNumber, username, handle, password, and dob are required.',
      });
    }

    // 🔢 Age check
    const birth = new Date(dob);
    if (Number.isNaN(birth.getTime())) {
      return res.status(400).json({ error: 'Invalid date of birth.' });
    }

    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
      age--;
    }

    if (age < 13) {
      return res.status(403).json({
        error: 'You must be at least 13 years old to create a MyTop6 account.',
      });
    }

    const normalizedPhone = normalizePhone(phoneNumber);

    // Check uniqueness for handle and phoneNumber
    const existingHandle = await User.findOne({
      handle: handle.toLowerCase().trim(),
    });
    if (existingHandle) {
      return res.status(400).json({ error: 'Handle already taken' });
    }

    const existingPhone = await User.findOne({ phoneNumber: normalizedPhone });
    if (existingPhone) {
      return res
        .status(400)
        .json({ error: 'An account already exists for this phone number.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // compute age ON THE SERVER as well, so you can store a snapshot
    let storedAge = age;
    if (storedAge < 0 || Number.isNaN(storedAge)) {
      storedAge = undefined;
    }

    const newUser = new User({
      phoneNumber: normalizedPhone,
      username,
      handle: handle.toLowerCase().trim(),
      passwordHash,
      bio: bio || '',
      dob: birth,                 // 🎂 actual Date object
      age: storedAge,             // optional snapshot
      location: location || '',   // 🗺️ "City, ST"
    });

    console.log('ABOUT TO SAVE USER:', {
      phoneNumber: normalizedPhone,
      username,
      handle: handle.toLowerCase().trim(),
      dob: birth,
      age: storedAge,
      location: location || '',
    });

    try {
      await newUser.save();
    } catch (err) {
      // Catch duplicate-key errors under high concurrency
      if (err.code === 11000) {
        if (err.keyPattern?.phoneNumber) {
          return res.status(400).json({
            error: 'An account already exists for this phone number.'
          });
        }
        if (err.keyPattern?.handle) {
          return res.status(400).json({
            error: 'Handle already taken'
          });
        }

        return res.status(400).json({
          error: 'Duplicate key error.'
        });
      }

      console.error('Register error:', err);
      return res.status(500).json({ error: 'Failed to register user.' });
    }

    const safeUser = newUser.toObject();
    delete safeUser.passwordHash;

    return res.status(201).json(safeUser);
  } catch (err) {
    console.error('Register error:', err);
    return res
      .status(400)
      .json({ error: err.message || 'Failed to register user.' });
  }
});

/* ===================================================================== */
/* 🔹 SEARCH USERS                                                        */
/* ===================================================================== */

// Search users by username or handle (now includes friends, dob, location)
router.get('/search', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: 'Missing search query' });

    const users = await User.find({
      $or: [
        { username: { $regex: query, $options: 'i' } },
        { handle: { $regex: query, $options: 'i' } },
      ],
    }).select('username handle profilePicture dob location friends');

    res.json(users);
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

/* ===================================================================== */
/* 🔹 GET USER BY HANDLE / ID                                             */
/* ===================================================================== */

// Get user by handle (place BEFORE /:id to avoid conflicts)
router.get('/handle/:handle', async (req, res) => {
  try {
    const handle = String(req.params.handle || '').toLowerCase();
    const user = await User.findOne({ handle }).populate(
      'topFriends',
      'username profilePicture'
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json(user);
  } catch (err) {
    console.error('Handle lookup error:', err);
    res.status(500).json({ error: 'Failed to fetch user by handle.' });
  }
});

// Get user by ID
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).populate(
      'topFriends',
      'username profilePicture'
    );

    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    console.error('Get user by ID error:', err);
    res.status(500).json({ error: 'Server error while fetching user' });
  }
});

/* ===================================================================== */
/* 🔹 MEMOS + ADDENDA                                                     */
/* ===================================================================== */

// Add a memo to a user (updated for new fields)
router.post('/:id/memo', async (req, res) => {
  try {
    const userId = req.params.id;
    console.log('POST /users/:id/memo -> userId:', userId, 'body:', req.body);

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ error: 'Invalid user id.' });
    }

    let {
      descriptionOfContent,
      reasonForAction,
      action,
      note,
      leftByUsername,
      reportId,
    } = req.body;

    // Map NEW → LEGACY if needed (so old schema with required action/note is satisfied)
    if ((!descriptionOfContent || !reasonForAction) && (action || note)) {
      descriptionOfContent = descriptionOfContent || note || '';
      reasonForAction = reasonForAction || action || '';
    }

    // At minimum we need both values (either new fields or mapped)
    if (!descriptionOfContent || !reasonForAction) {
      return res.status(400).json({
        error:
          'descriptionOfContent and reasonForAction are required (or provide legacy action/note).',
      });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const memoDoc = {
      descriptionOfContent: descriptionOfContent.trim(),
      reasonForAction: reasonForAction.trim(),
      action: action || reasonForAction, // legacy mirror
      note: note || descriptionOfContent, // legacy mirror
      leftByUsername: leftByUsername || null,
      reportId: reportId || null,
      createdAt: new Date(),
    };

    user.memos.push(memoDoc);

    await user.save();
    console.log('Memo saved for user:', userId);
    return res.json({
      message: 'Memo added successfully',
      memos: user.memos,
    });
  } catch (err) {
    console.error('Failed to add memo:', err?.message, err);
    if (err?.name === 'ValidationError') {
      const details = Object.values(err.errors)
        .map((e) => e.message)
        .join('; ');
      return res
        .status(400)
        .json({ error: `Validation error: ${details}` });
    }
    return res.status(500).json({ error: 'Failed to add memo.' });
  }
});

// POST /api/users/:userId/memos/:memoId/addendum
router.post('/:userId/memos/:memoId/addendum', async (req, res) => {
  try {
    const { userId, memoId } = req.params;
    const {
      text = '',
      cgvi = null,
      reportId = null,
      leftByUsername = null,
    } = req.body || {};

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'user_not_found' });

    const memo = user.memos.id(memoId);
    if (!memo) return res.status(404).json({ error: 'memo_not_found' });

    if (!Array.isArray(memo.addenda)) memo.addenda = [];

    memo.addenda.push({
      text,
      cgvi: cgvi || undefined,
      reportId: reportId || undefined,
      leftByUsername: leftByUsername || undefined,
      createdAt: new Date(),
    });

    if (cgvi) memo.cgvi = cgvi;

    await user.save();
    return res.json({ ok: true, memo });
  } catch (err) {
    console.error('addendum_error', err);
    return res.status(500).json({
      error: 'server_error',
      detail: String(err.message || err),
    });
  }
});

/* ===================================================================== */
/* 🔹 UPDATE USER (PROFILE / THEME / MUSIC)                               */
/* ===================================================================== */

router.put('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Bio
    if (req.body.bio !== undefined) user.bio = req.body.bio;

    // Profile picture
    if (typeof req.body.profilePicture === "string") {
      const trimmed = req.body.profilePicture.trim();
      if (trimmed && !isDefaultProfilePicture(trimmed)) {
        user.profilePicture = trimmed;
      }
    }

    // Music URL
    if (req.body.profileMusicUrl !== undefined) {
      user.profileMusicUrl = req.body.profileMusicUrl;
    }

    // Location
    if (req.body.location !== undefined) {
      user.location = req.body.location;
    }

    // DOB
    if (req.body.dob !== undefined) {
      user.dob = new Date(req.body.dob);
    }

    // ✅ Ask Me Anything settings (always run)
    if (req.body.askMeAnythingEnabled !== undefined) {
      user.askMeAnythingEnabled = toBool(req.body.askMeAnythingEnabled);
    }

    if (req.body.allowAnonymousQuestions !== undefined) {
      user.allowAnonymousQuestions = toBool(req.body.allowAnonymousQuestions);
    }

    // Optional safety: if AMA is off, anonymous must be off too
    if (!user.askMeAnythingEnabled) {
      user.allowAnonymousQuestions = false;
    }

    // ✅ Theme merge (ONLY when theme exists)
    if (req.body.theme) {
      const currentTheme =
        user.theme && typeof user.theme === 'object'
          ? (typeof user.theme.toObject === 'function'
              ? user.theme.toObject()
              : user.theme)
          : {};

      user.theme = {
        ...currentTheme,
        ...req.body.theme,
      };
    }

    await user.save();
    return res.json(user);
  } catch (err) {
    console.error('Update user error:', err);
    return res.status(500).json({ error: 'Server error while updating user' });
  }
});

/* ===================================================================== */
/* 🔹 OTHER UTIL ROUTES                                                   */
/* ===================================================================== */

// Get all users
router.get('/', async (req, res) => {
  try {
    const users = await User.find().select('username profilePicture');
    res.json(users);
  } catch (err) {
    console.error('Get all users error:', err);
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

// Update Top Friends
router.put('/:id/top-friends', async (req, res) => {
  try {
    const { topFriends } = req.body;
    if (!Array.isArray(topFriends) || topFriends.length > 8) {
      return res.status(400).json({
        error: 'Top friends must be an array of up to 8 user IDs.',
      });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { topFriends },
      { new: true }
    ).populate('topFriends', 'username profilePicture');

    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json(user.topFriends);
  } catch (err) {
    console.error('Update top friends error:', err);
    res.status(500).json({ error: 'Failed to update top friends.' });
  }
});


// Reset new comments count
router.post('/:id/reset-new-comments', async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.id, {
      $set: { 'dashboardData.newComments': 0 },
    });
    res.json({ message: 'New comments count reset.' });
  } catch (err) {
    console.error('Failed to reset new comments count:', err);
    res.status(500).json({ error: 'Failed to reset new comments count.' });
  }
});

// Dashboard Data
router.get('/:id/dashboard-data', async (req, res) => {
  try {
    const userId = req.params.id;

    const amaCount = await Question.countDocuments({
      toUserId: userId,
      reported: { $ne: true },
    });

    res.json({ amaCount });
  } catch (err) {
    console.error('Failed to fetch dashboard data:', err);
    res.status(500).json({ error: 'Failed to fetch dashboard data.' });
  }
});

module.exports = router;