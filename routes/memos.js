const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { Types: { ObjectId } } = mongoose;

const Memo = require('../models/Memo');
let User = null;
try {
  // Optional: if you have a User model, we'll use it to resolve @handles → _id.
  User = require('../models/User');
} catch (_) { /* ok if missing */ }

const { ADMIN_CODES, computeCMO, defaultEscalation } = require('../utils/cgviMatrix');

/**
 * GET /api/memos/by-user/:userId
 *
 * Accepts:
 *  - Mongo ObjectId string (24 hex)
 *  - Plain string ids that your memos may have stored (e.g., legacy)
 *  - @handle (we’ll resolve to the user’s _id if the User model exists)
 *
 * Searches across many possible memo fields to find everything written “for” that user.
 * Light-normalizes output so the UI can read cgviCodes even if the doc stored cgvi: [{code:"101.1"}].
 */
router.get('/by-user/:userId', async (req, res) => {
  try {
    const raw = String(req.params.userId || '').trim();
    if (!raw) return res.json([]);

    // Try to resolve an ObjectId and (optionally) a user by @handle
    const isHexId = /^[a-f\d]{24}$/i.test(raw);
    const asOid   = isHexId ? new ObjectId(raw) : null;

    // Best-effort resolve user by handle/username → _id (if model available)
    let resolvedUserId = null;
    if (User) {
      try {
        if (raw.startsWith('@') || !isHexId) {
          const handle = raw.replace(/^@/, '');
          const u = await User.findOne({
            $or: [{ handle: handle }, { username: handle }]
          }).select('_id memos').lean();
          if (u?._id) resolvedUserId = u._id;
        }
      } catch (e) {
        console.warn('[memos/by-user] handle resolution failed:', e?.message || e);
      }
    }
    if (!resolvedUserId && asOid) resolvedUserId = asOid;

    // -------- 1) Primary: look in the Memo collection (your new schema) ------
    const FIELDS = [
      'userId',
      'contentOwnerId',
      'ownerId',
      'accountId',
      'subjectUserId',
      'createdForUserId',
      'createdFor',
      'contentOwner',
      'contentOwner._id',
      'contentOwner.id',
      'user',
      'user._id',
      'user.id',
    ];

    const or = [];
    if (raw) {
      for (const f of FIELDS) or.push({ [f]: raw });
    }
    if (resolvedUserId) {
      for (const f of FIELDS) or.push({ [f]: resolvedUserId });
    }

    let memos = [];
    if (or.length) {
      memos = await Memo.find({ $or: or }).sort({ createdAt: -1 }).lean();
    }

    // Normalize cgviCodes for UI
    const normalizedCollection = (Array.isArray(memos) ? memos : []).map(m => {
      const cgviCodes =
        Array.isArray(m.cgviCodes) ? m.cgviCodes :
        Array.isArray(m.cgvi) ? m.cgvi.map(x => (typeof x === 'string' ? x : x?.code)).filter(Boolean) :
        undefined;
      return cgviCodes ? { ...m, cgviCodes } : m;
    });

    if (normalizedCollection.length > 0) {
      console.log('[memos/by-user] collection hit →', normalizedCollection.length);
      return res.json(normalizedCollection);
    }

    // -------- 2) Fallback: read embedded memos on User.memos ------------------
    if (!User || !resolvedUserId) {
      console.log('[memos/by-user] no collection results and no resolvable user');
      return res.json([]);
    }

    const user = await User.findById(resolvedUserId).select('memos').lean();
    if (!user || !Array.isArray(user.memos) || user.memos.length === 0) {
      console.log('[memos/by-user] embedded fallback found 0');
      return res.json([]);
    }

    // Map embedded memo shape → the renderer’s expectations
    const mapped = user.memos.map(m => {
      // Expose cgviCodes as an array if you store a single string cgvi on embedded memo
      const cgviCodes = Array.isArray(m.cgviCodes) ? m.cgviCodes
                      : m.cgvi ? [String(m.cgvi)] : [];

      return {
        _id: m._id,
        createdAt: m.createdAt,
        leftByUsername: m.leftByUsername || null,

        // The renderer checks these keys in normalizeMemo()
        descriptionOfContent: m.descriptionOfContent || m.note || '',
        reasonForAction: m.reasonForAction || m.action || '',
        note: m.note || '',
        action: m.action || '',

        cgviCodes,
        reportId: m.reportId || null,
        // keep raw around for modal if you like:
        raw: m,
      };
    }).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    console.log('[memos/by-user] embedded fallback →', mapped.length);
    return res.json(mapped);
  } catch (err) {
    console.error('GET /api/memos/by-user error:', err?.message || err);
    return res.json([]);
  }
});

/**
 * POST /api/memos
 * Create memo with CMO + flags; requires ACR when non-admin CGVIs are present.
 * (Kept as-is, with tiny robustness tweaks so it can also accept `cgviCodes`.)
 */
router.post('/', async (req, res) => {
  try {
    const {
      contentOwnerId, reportId, content,
      irn, irnNote,
      cgvi = [], cgviCodes, // accept cgviCodes too
      acr = "",
      title = "", body = "", flags = []
    } = req.body;

    if (!contentOwnerId) return res.status(400).json({ error: "contentOwnerId is required" });
    if (!irn)             return res.status(400).json({ error: "irn is required" });

    // Accept either cgvi: ["101.1"] | [{code}] OR cgviCodes: ["101.1"]
    const rawCodes = Array.isArray(cgviCodes) && cgviCodes.length
      ? cgviCodes
      : cgvi;

    const codes = rawCodes
      .map(c => (typeof c === "string" ? c : c?.code))
      .filter(Boolean);

    // Require ACR only when a non-admin CGVI is present
    const hasNonAdmin = codes.some(c => !ADMIN_CODES.has(String(c)));
    if (hasNonAdmin && !String(acr || '').trim()) {
      return res.status(400).json({ error: "ACR (rationale) is required when CGVIs are applied." });
    }

    const cmo = computeCMO(codes);
    const escalationInbox = defaultEscalation({ irn, cmo, codes });

    // Auto-flags for admin cases (handy for UI filtering)
    if (codes.includes("998") && !flags.includes("test_case")) flags.push("test_case");
    if (codes.includes("997") && !flags.includes("reporter_abuse")) flags.push("reporter_abuse");
    if (codes.includes("999") && !flags.includes("no_action_needed")) flags.push("no_action_needed");

    const memo = await Memo.create({
      contentOwnerId, reportId, content,
      irn, irnNote,
      cgvi: codes.map(code => ({ code })), // persist as objects; GET normalizes for UI
      acr: acr || null,
      cmo,
      title: title || (hasNonAdmin ? "Enforcement" : "Administrative"),
      body,
      flags,
      status: escalationInbox ? "pending_escalation" : "open",
      escalationInbox,
      createdBy: req.user?._id || null
    });

    res.status(201).json(memo);
  } catch (e) {
    console.error("Create memo failed:", e);
    res.status(400).json({ error: e.message || "Create memo failed" });
  }
});

module.exports = router;