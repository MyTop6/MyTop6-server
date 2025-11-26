// models/Memo.js
const mongoose = require('mongoose');

const MemoSchema = new mongoose.Schema(
  {
    contentOwnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    reportId: { type: mongoose.Schema.Types.ObjectId, ref: 'Report' },
    content: {
      type: { type: String, enum: ['bulletin', 'comment', 'profile', 'dm', 'other'] },
      id: mongoose.Schema.Types.ObjectId
    },

    // Snapshot of reporter’s reason (IRN)
    irn: { type: String, required: true },
    irnNote: String,

    // Adjudication
    cgvi: [{ code: String, label: String, severity: Number }],
    acr: String,
    cmo: {
      action: String,
      durationHours: Number,
      reason: String,
      computedAt: Date
    },

    // Memo text
    title: String,
    body: String,

    // Flags & workflow
    flags: [String],
    status: { type: String, enum: ['open', 'pending_escalation', 'escalated', 'resolved', 'closed'], default: 'open' },
    escalationInbox: String,
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Addenda
    parentMemoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Memo' },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

MemoSchema.index({ contentOwnerId: 1, createdAt: -1 });

module.exports = mongoose.model('Memo', MemoSchema);