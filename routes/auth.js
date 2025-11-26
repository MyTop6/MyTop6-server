// routes/auth.js
const express = require('express');
const bcrypt = require('bcrypt');
const User = require('../models/User');

const router = express.Router();

// Normalize phone: keep digits only, e.g. "(555) 123-4567" -> "5551234567"
function normalizePhone(phone) {
  if (!phone) return '';
  return String(phone).replace(/\D/g, '').trim();
}

/* ========================================================================
   CHECK PHONE AVAILABILITY
   POST /api/auth/check-phone
   body: { phoneNumber }
   ======================================================================== */
router.post('/check-phone', async (req, res) => {
  const { phoneNumber } = req.body || {};
  const normalized = normalizePhone(phoneNumber);

  console.log('🔎 /api/auth/check-phone hit with:', req.body);

  // If no usable phone, just say "not available" so the UI nudges them
  if (!normalized) {
    console.log(' -> no phone provided');
    return res.json({ available: false, reason: 'missing-phone' });
  }

  try {
    const existingUser = await User.findOne({ phoneNumber: normalized }).select('_id');
    const available = !existingUser;

    console.log(' -> phone normalized:', normalized, 'available:', available);

    // Always 200, frontend just reads `.available`
    return res.json({ available });
  } catch (err) {
    console.error('❌ Auth check-phone error:', err);

    // FAIL-SAFE: don’t block signup because of a DB hiccup.
    // Tell the frontend "available: true" but log the error.
    return res.json({ available: true, reason: 'db-error' });
  }
});

/* ========================================================================
   CHECK HANDLE AVAILABILITY
   POST /api/auth/check-handle
   body: { handle }
   ======================================================================== */
router.post('/check-handle', async (req, res) => {
  try {
    const { handle } = req.body || {};
    if (!handle) {
      return res.json({ available: false, reason: 'missing' });
    }

    const clean = handle.toLowerCase().trim();

    const allowedRegex = /^[a-zA-Z0-9_]+$/;
    if (!allowedRegex.test(clean)) {
      return res.json({ available: false, reason: "invalid-format" });
    }

    const existing = await User.findOne({ handle: clean }).select('_id');
    const available = !existing;

    console.log('🔎 Handle check:', clean, 'available:', available);

    return res.json({ available });
  } catch (err) {
    console.error("❌ check-handle error:", err);
    return res.json({ available: true, reason: "db-error" });
  }
});

/* ========================================================================
   LOGIN
   POST /api/auth/login
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

    const normalized = normalizePhone(phoneNumber);

    const user = await User.findOne({ phoneNumber: normalized });
    if (!user || user.banned) {
      return res.status(401).json({ error: 'Invalid phone number or password.' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash || '');
    if (!ok) {
      return res.status(401).json({ error: 'Invalid phone number or password.' });
    }

    const safeUser = user.toObject();
    delete safeUser.passwordHash;

    res.json(safeUser);
  } catch (err) {
    console.error('Auth login error:', err);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

module.exports = router;