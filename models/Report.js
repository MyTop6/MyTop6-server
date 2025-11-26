// models/Report.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const ALLOWED_REPORT_REASONS = [
  'spam',       // Spam or misleading
  'harassment', // Harassment or hate speech
  'porn',       // Pornography or nudity
  'violence',   // Graphic violence or gore
  'csam',       // Child sexual abuse material
  'other'
];

const ALLOWED_REASON_CODES = ['SP', 'HH', 'NU', 'GG', 'CSM', 'OT'];

const ReportSchema = new Schema({
  // ✅ Friendly ID minted at creation time (e.g. "082125-0000000255-SP")
  reportId: { type: String, index: true, unique: true, sparse: true },

  // Content being reported
  contentId: { type: Schema.Types.ObjectId, required: true },
  contentType: { type: String, required: true }, // 'bulletin' | 'ask' | etc.
  contentText: { type: String },

  // Who wrote the content / who reported it
  userId: { type: Schema.Types.ObjectId, ref: 'User' },      // author of content
  reportedBy: { type: Schema.Types.ObjectId, ref: 'User' },  // reporter

  // Legacy/extra tagging
  type: { type: String },   // 'Bulletin' | 'Question' | ...

  // Moderation state
  status: { type: String, default: 'pending', index: true },

  // Priority is computed server-side
  priority: {
    type: String,
    enum: ['medium', 'high', 'urgent'],
    default: 'medium',
    index: true
  },

  // ✅ Reporter-selected reason (long form)
  reportReason: {
    type: String,
    enum: ALLOWED_REPORT_REASONS,
    default: 'other',
    set: v => (typeof v === 'string' ? v.trim().toLowerCase() : v)
  },

  // ✅ Short code we derive/persist (SP, HH, NU, GG, CSM, OT)
  reportReasonCode: {
    type: String,
    enum: ALLOWED_REASON_CODES,
    default: 'OT'
  },

  // Optional freeform note (used when reason is "other")
  reportReasonNote: {
    type: String,
    default: '',
    maxlength: 2000,
    set: v => (typeof v === 'string' ? v.trim() : v)
  }
}, { timestamps: true });

// Helpful indexes
ReportSchema.index({ status: 1, priority: 1, createdAt: 1 });
ReportSchema.index({ reportedBy: 1, createdAt: -1 });
ReportSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.models.Report || mongoose.model('Report', ReportSchema);