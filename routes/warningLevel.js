// routes/warningLevel.js
const express = require('express');
const mongoose = require('mongoose');
const PointsEvent = require('../models/PointsEvent');

const router = express.Router();

// Map severity -> points
const POINTS_MAP = { 1: 5, 2: 10, 3: 30, 4: 0 };

// POST /api/users/:id/points-events
// body: { reportId, violations: [{code, severity}] }
router.post('/:id/points-events', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const { reportId = null, violations = [] } = req.body || {};

    const total = (violations || []).reduce((sum, v) => {
      const sev = Number(v?.severity) || 0;
      return sum + (POINTS_MAP[sev] || 0);
    }, 0);

    if (total <= 0) {
      return res.json({ ok: true, added: 0 });
    }

    await PointsEvent.create({
      userId: id,
      reportId,
      violations,
      points: total,
    });

    res.json({ ok: true, added: total });
  } catch (err) {
    console.error('points-event error:', err);
    res.status(500).json({ error: 'Failed to add points event' });
  }
});

// GET /api/users/:id/score30d
router.get('/:id/score30d', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const agg = await PointsEvent.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(id) } },
      { $group: { _id: '$userId', score: { $sum: '$points' } } },
    ]);

    res.json({ score: agg[0]?.score ?? 0 });
  } catch (err) {
    console.error('score30d error:', err);
    res.status(500).json({ error: 'Failed to fetch score' });
  }
});

module.exports = router;