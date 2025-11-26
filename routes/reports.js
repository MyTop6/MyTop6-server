const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const Report = require('../models/Report');
const Bulletin = require('../models/Bulletin');
const User = require('../models/User');
const Question = require('../models/Question');
const { computePriorityFromType } = require("../helpers/priority");

/* Reason code helpers ------------------------------------------------------*/
const CODE_TO_LONG = {
  SP: "spam",
  HH: "harassment",
  NU: "porn",
  GG: "violence",
  CSM: "csam",
  OT: "other",
};
const LONG_TO_CODE = Object.fromEntries(Object.entries(CODE_TO_LONG).map(([k, v]) => [v, k]));
const LABEL_TO_CODE = {
  "spam or misleading": "SP",
  "harassment or hate speech": "HH",
  "pornography or nudity": "NU",
  "graphic violence or gore": "GG",
  "child sexual abuse material": "CSM",
  "csam": "CSM",
  "other": "OT",
  spam: "SP",
  harassment: "HH",
  "hate speech": "HH",
  hate: "HH",
  nudity: "NU",
  porn: "NU",
  pornographic: "NU",
  violence: "GG",
  violent: "GG",
  gore: "GG",
  "graphic violence": "GG",
};
const REASON_CODE_SET = new Set(Object.keys(CODE_TO_LONG));
const DEBUG = process.env.REPORTS_DEBUG === '1';

function tryParseAny(val) {
  if (val == null) return null;
  const raw = String(val).trim();
  if (!raw) return null;

  const upper = raw.toUpperCase();
  if (REASON_CODE_SET.has(upper)) return upper;

  const lower = raw.toLowerCase();
  if (LABEL_TO_CODE[lower]) return LABEL_TO_CODE[lower];
  if (LONG_TO_CODE[lower])  return LONG_TO_CODE[lower];
  return null;
}

function deepFindReasonCode(obj) {
  const seen = new Set();
  const q = [[obj, '$']];
  while (q.length) {
    const [node, path] = q.shift();
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node)) continue;
    seen.add(node);

    for (const [k, v] of Object.entries(node)) {
      const p = `${path}.${k}`;
      if (typeof v === 'string') {
        const parsed = tryParseAny(v);
        if (parsed) {
          if (DEBUG) console.log(`[reports] reason parsed (deep) ${parsed} from ${p}:`, v);
          return parsed;
        }
        continue;
      }
      if (v && typeof v === 'object') {
        if (/reason|report/i.test(k)) {
          const candidates = [
            v.code, v.shortCode, v.reportReasonCode, v.reasonCode,
            v.value, v.id, v.key, v.label, v.text, v.selection, v.choice,
          ];
          for (const c of candidates) {
            const parsed = tryParseAny(c);
            if (parsed) {
              if (DEBUG) console.log(`[reports] reason parsed (nested) ${parsed} from ${p}`, { c });
              return parsed;
            }
          }
        }
        q.push([v, p]);
      }
    }
  }
  return null;
}

function pickReasonCode(body = {}) {
  const KEYS = [
    "reasonCode", "reportReasonCode", "code", "shortCode",
    "reasonLabel", "reportReasonLabel", "label", "reason_text",
    "reportReason", "reason",
  ];
  for (const k of KEYS) {
    if (k in body) {
      const parsed = tryParseAny(body[k]);
      if (parsed) {
        if (DEBUG) console.log(`[reports] reason parsed (top) ${parsed} from key '${k}':`, body[k]);
        return parsed;
      }
    }
  }
  if (body.reason && typeof body.reason === 'object') {
    const nested = tryParseAny(body.reason.code) ||
                   tryParseAny(body.reason.shortCode) ||
                   tryParseAny(body.reason.reportReasonCode) ||
                   tryParseAny(body.reason.label) ||
                   tryParseAny(body.reason.value) ||
                   tryParseAny(body.reason.text);
    if (nested) {
      if (DEBUG) console.log(`[reports] reason parsed (nested.reason) ${nested}:`, body.reason);
      return nested;
    }
  }
  const deep = deepFindReasonCode(body);
  if (deep) return deep;

  if (DEBUG) console.log(`[reports] reason not found in payload; defaulting to OT. Body keys:`, Object.keys(body));
  return "OT";
}

function toLongReason(code) {
  return CODE_TO_LONG[code] || "other";
}

/* Friendly daily counters ---------------------------------------------------*/
const CounterSchema = new mongoose.Schema(
  { _id: String, seq: { type: Number, default: 0 } },
  { versionKey: false, collection: 'report_counters' }
);
const ReportCounter = mongoose.models.ReportCounter || mongoose.model('ReportCounter', CounterSchema);

function dayKeyFrom(date = new Date()) {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  return `${mm}${dd}${yy}`;
}

async function nextDailySeq(date = new Date()) {
  const key = dayKeyFrom(date);
  const doc = await ReportCounter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return { key, seq: doc.seq };
}

function buildReportId(date, seq, reasonCode) {
  const key = dayKeyFrom(date);
  const seq10 = String(seq).padStart(10, '0');
  return `${key}-${seq10}-${reasonCode}`;
}

/* POST /api/reports ---------------------------------------------------------*/
router.post('/', async (req, res) => {
  try {
    const {
      contentId,
      contentType,
      contentText,
      userId,
      reportedBy,
      note,
      reportReasonNote,
      type,
    } = req.body || {};

    const priority = computePriorityFromType(type || "");

    const reasonCode = pickReasonCode(req.body);
    const reasonLong = toLongReason(reasonCode);
    const safeNote =
      typeof (reportReasonNote ?? note) === "string"
        ? (reportReasonNote ?? note).trim().slice(0, 2000)
        : "";

    const now = new Date();
    const { seq } = await nextDailySeq(now);
    const reportId = buildReportId(now, seq, reasonCode);

    const doc = await Report.create({
      reportId,
      contentId,
      contentType: contentType || (type === "Question" ? "ask" : "bulletin"),
      contentText,
      userId,
      reportedBy,
      status: "pending",
      type,
      priority,
      reportReason: reasonLong,
      reportReasonCode: reasonCode,
      reportReasonNote: safeNote,
    });

    res.status(201).json({
      message: "Report submitted successfully.",
      id: doc._id,
      reportId: doc.reportId,
      reportReason: reasonLong,
      reportReasonCode: reasonCode,
    });
  } catch (err) {
    console.error("Failed to submit report:", err);
    res.status(500).json({ error: "Failed to submit report." });
  }
});

/* GET /api/reports (pending only) ------------------------------------------*/
router.get('/', async (req, res) => {
  try {
    const reports = await Report.find({ status: "pending" }).sort({ createdAt: 1 });

    const formatted = await Promise.all(
      reports.map(async (r) => {
        try {
          const safePriority = r.priority || computePriorityFromType(r.type || "");
          const reasonLong = (r.reportReason || "other").toLowerCase();
          const reasonCode = (r.reportReasonCode && r.reportReasonCode.toUpperCase()) || LONG_TO_CODE[reasonLong] || "OT";

          if (r.type === "Bulletin") {
            const bulletin = await Bulletin.findById(r.contentId).populate("userId");
            if (!bulletin || !bulletin.userId) return null;

            const user = bulletin.userId;
            const userViolationCount = await Report.countDocuments({
              userId: user._id,
              status: "resolved",
            });

            const summary = bulletin.content
              ? bulletin.content.substring(0, 30)
              : bulletin.type === "image"
              ? "📷 Image Bulletin"
              : bulletin.type === "video"
              ? "🎥 Video Bulletin"
              : "Bulletin";

            return {
              id: r._id.toString(),
              reportId: r.reportId || null,
              type: r.type,
              contentId: String(r.contentId || ""),
              content: bulletin.content || "",
              mediaUrl: bulletin.mediaUrl || "",
              bulletinType: bulletin.type || "text",
              user: {
                id: String(user._id),          // ✅ stringified for renderer
                _id: String(user._id),         // ✅ provide _id too (fallback)
                name: user.displayName || user.username || "Unknown",
                handle: user.handle || "unknown",
                pic: user.profilePicture || "https://via.placeholder.com/100",
                memberSince: user.createdAt
                  ? new Date(user.createdAt).toLocaleDateString()
                  : "Unknown",
                violations: userViolationCount || 0,
              },
              priority: safePriority,
              summary,
              reportReason: reasonLong,
              reportReasonCode: reasonCode,
              createdAt: r.createdAt,
              reportedAt: r.createdAt,
              postedAt: bulletin.createdAt,
            };
          }

          if (r.type === "Question") {
            const question = await Question.findById(r.contentId).populate("fromUserId");
            if (!question) return null;

            const questionUser = question.fromUserId;
            const summary = question.text ? question.text.substring(0, 30) : "Question";

            return {
              id: r._id.toString(),
              reportId: r.reportId || null,
              type: r.type,
              contentId: String(r.contentId || ""),
              content: question.text || "",
              user: questionUser
                ? {
                    id: String(questionUser._id),  // ✅ stringified for renderer
                    _id: String(questionUser._id), // ✅ provide _id too
                    name: questionUser.displayName || questionUser.username || "Anonymous",
                    handle: questionUser.handle || "anonymous",
                    pic: questionUser.profilePicture || "/nophoto.png",
                    memberSince: questionUser.createdAt
                      ? new Date(questionUser.createdAt).toLocaleDateString()
                      : "Unknown",
                  }
                : {
                    name: "Anonymous",
                    handle: "anonymous",
                    pic: "/nophoto.png",
                  },
              priority: safePriority,
              summary,
              reportReason: reasonLong,
              reportReasonCode: reasonCode,
              createdAt: r.createdAt,
              reportedAt: r.createdAt,
              postedAt: question.createdAt,
            };
          }

          return null;
        } catch (innerErr) {
          console.error("⚠️ Error formatting individual report:", innerErr);
          return null;
        }
      })
    );

    res.json(formatted.filter(Boolean));
  } catch (err) {
    console.error("❌ Failed to fetch reports:", err);
    res.status(500).json({ error: "Failed to fetch reports." });
  }
});

/* Resolve / Delete ----------------------------------------------------------*/
router.post('/:id/resolve', async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ error: "Report not found" });

    report.status = "resolved";
    await report.save();

    res.json({ message: "Report marked as resolved." });
  } catch (err) {
    console.error("Failed to resolve report:", err);
    res.status(500).json({ error: "Failed to resolve report." });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await Report.findByIdAndDelete(req.params.id);
    res.json({ message: "Report deleted successfully." });
  } catch (err) {
    console.error("Failed to delete report:", err);
    res.status(500).json({ error: "Failed to delete report." });
  }
});

module.exports = router;