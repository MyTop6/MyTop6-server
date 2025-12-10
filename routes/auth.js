// routes/auth.js
const express = require('express');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const twilioClient = require("twilio")(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// 🔹 Dev-only OTP bypass config
const DEV_MAGIC_OTP = process.env.DEV_MAGIC_OTP || "385338";
const DEV_BYPASS_OTP = process.env.DEV_BYPASS_OTP === "true";
const IS_DEV_BYPASS = DEV_BYPASS_OTP && process.env.NODE_ENV !== "production";

const router = express.Router();

console.log("✅ authRoutes loaded: /api/auth/* is mounted");

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

/* ========================================================================
   OTP SEND  (Twilio DISABLED for now)
   POST /api/auth/send-otp
   body: { phoneNumber }
   ======================================================================== */
router.post("/send-otp", async (req, res) => {
  try {
    let { phoneNumber } = req.body || {};
    const normalized = normalizePhone(phoneNumber);

    if (!normalized) {
      return res.status(400).json({ error: "Phone number required." });
    }

    const to = "+1" + normalized;

    if (IS_DEV_BYPASS) {
      // 🔸 DEV MODE: do NOT call Twilio, just pretend SMS was sent
      console.log("🧪 Dev SEND-OTP bypass for", to);
      return res.json({
        status: "sent",
        devBypass: true,
        note: "Twilio disabled in dev; no SMS actually sent.",
      });
    }

    // 🔻 PRODUCTION / REAL SMS (currently disabled)
    console.log("⚠ Twilio send-otp is currently disabled in this build.");
    return res.status(500).json({
      error: "SMS sending is temporarily disabled on this server.",
    });

    /*
    // 👉 ORIGINAL Twilio code (re-enable later if needed):

    console.log("🔔 Sending OTP via Twilio Verify to:", to);

    const verification = await twilioClient.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verifications.create({
        to,
        channel: "sms",
      });

    console.log("✅ Twilio Verify response:", verification.status);

    return res.json({ status: verification.status });
    */
  } catch (err) {
    const twilioData = err.response?.data;
    console.error("❌ send-otp error:", {
      message: err.message,
      twilioData,
    });

    return res.status(500).json({
      error: twilioData?.message || "Failed to send OTP.",
      code: twilioData?.code,
    });
  }
});

/* ========================================================================
   OTP VERIFY  (Twilio DISABLED for now)
   POST /api/auth/verify-otp
   body: { phoneNumber, code }
   ======================================================================== */
router.post("/verify-otp", async (req, res) => {
  try {
    let { phoneNumber, code } = req.body || {};
    const normalized = normalizePhone(phoneNumber);

    if (!normalized || !code) {
      return res
        .status(400)
        .json({ error: "Phone number and code required." });
    }

    const to = "+1" + normalized;

    if (IS_DEV_BYPASS && code === DEV_MAGIC_OTP) {
      // 🔸 DEV MODE: accept magic code without Twilio
      console.log("🧪 Dev OTP bypass used for", to, "with code", code);
      return res.json({
        success: true,
        devBypass: true,
      });
    }

    // 🔻 PRODUCTION / REAL Twilio Verify (currently disabled)
    console.log("⚠ Twilio verify-otp is currently disabled in this build.");
    return res.status(500).json({
      error: "OTP verification via Twilio is temporarily disabled on this server.",
    });

    /*
    // 👉 ORIGINAL Twilio verify code (re-enable later if needed):

    console.log("🔍 Verifying OTP via Twilio for:", to);

    const result = await twilioClient.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({
        to,
        code,
      });

    console.log("✅ Twilio verification status:", result.status);

    if (result.status === "approved") {
      return res.json({ success: true });
    } else {
      return res.status(400).json({ success: false, error: "Invalid code" });
    }
    */
  } catch (err) {
    const twilioData = err.response?.data;
    console.error("❌ verify-otp error:", {
      message: err.message,
      twilioData,
    });

    return res.status(500).json({
      error: twilioData?.message || "Failed to verify OTP.",
      code: twilioData?.code,
    });
  }
});

module.exports = router;