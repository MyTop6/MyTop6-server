// routes/users.public.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const User = require('../models/User');

// --- helper to normalize phone into DIGITS ONLY ---
function normalizePhone(phone) {
  if (!phone) return '';
  return String(phone).replace(/\D/g, '').trim(); // ← FIXED
}

/* ========================================================================
   PUBLIC: REGISTER NEW USER
   POST /api/users
   body: { phoneNumber, username, password, handle, bio }
   ======================================================================== */
router.post('/', async (req, res) => {
  try {
    const { phoneNumber, username, password, handle, bio } = req.body || {};

    if (!phoneNumber || !username || !password || !handle) {
      return res.status(400).json({
        error: 'phoneNumber, username, handle, and password are required.',
      });
    }

    // normalize phone
    const normalizedPhone = normalizePhone(phoneNumber);

    if (!normalizedPhone || normalizedPhone.length < 10) {
      return res.status(400).json({ error: 'Invalid phone number.' });
    }

    const cleanHandle = handle.toLowerCase().trim();

    // Unique handle?
    const existingHandle = await User.findOne({ handle: cleanHandle });
    if (existingHandle) {
      return res.status(400).json({ error: 'Handle already taken.' });
    }

    // Unique phone?
    const existingPhone = await User.findOne({ phoneNumber: normalizedPhone });
    if (existingPhone) {
      return res
        .status(400)
        .json({ error: 'An account already exists for this phone number.' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    const user = new User({
      phoneNumber: normalizedPhone,   // ← SAVES DIGITS ONLY
      username,
      handle: cleanHandle,
      passwordHash,
      bio,
    });

    await user.save();

    const safeUser = user.toObject();
    delete safeUser.passwordHash;

    return res.status(201).json(safeUser);
  } catch (err) {
    console.error('Register error:', err);
    res.status(400).json({ error: err.message });
  }
});

/* ========================================================================
   PUBLIC: LOGIN
   POST /api/users/login
   body: { phoneNumber, password }
   ======================================================================== */
router.post('/login', async (req, res) => {
  try {
    const { phoneNumber, password } = req.body || {};

    if (!phoneNumber || !password) {
      return res
        .status(400)
        .json({ error: 'Phone number and password are required.' });
    }

    // MUST use the same normalization for login too
    const normalizedPhone = normalizePhone(phoneNumber);

    const user = await User.findOne({ phoneNumber: normalizedPhone });
    if (!user || user.banned) {
      return res
        .status(401)
        .json({ error: 'Invalid phone number or password.' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash || '');
    if (!ok) {
      return res
        .status(401)
        .json({ error: 'Invalid phone number or password.' });
    }

    const safeUser = user.toObject();
    delete safeUser.passwordHash;

    return res.status(200).json(safeUser);
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Server error during login.' });
  }
});

module.exports = router;