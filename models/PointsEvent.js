const mongoose = require('mongoose');

const PointsEventSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  reportId: { type: String, default: null },
  violations: [{
    code: Number,
    severity: Number
  }],
  points: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now } // <-- remove `index: true` here
});

// TTL index (30 days). Only define it ONCE:
PointsEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

module.exports = mongoose.model('PointsEvent', PointsEventSchema);