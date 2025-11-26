// routes/moderation.js
const express = require("express");
const router = express.Router();
const Community = require("../models/Community");
const CommunityReport = require("../models/CommunityReport");

router.get("/:userId/status", async (req, res) => {
  const { userId } = req.params;

  try {
    const communities = await Community.find({
      $or: [{ administrator: userId }, { moderators: userId }]
    });

    if (!communities.length) {
      return res.json({
        hasPendingMembers: false,
        hasPendingBulletins: false,
        hasReports: false
      });
    }

    const communityIds = communities.map((c) => c._id);

    const hasPendingMembers = communities.some(
      (c) => c.memberRequests?.length > 0
    );

    const hasPendingBulletins = communities.some(
      (c) => c.requireApproval && c.pendingBulletins?.length > 0
    );

    const reportCount = await CommunityReport.countDocuments({
      community: { $in: communityIds },
      status: "pending"
    });
    const hasReports = reportCount > 0;

    res.json({
      hasPendingMembers,
      hasPendingBulletins,
      hasReports
    });
  } catch (err) {
    console.error("Moderation status error:", err);
    res.status(500).json({ error: "Failed to check moderation status" });
  }
});

module.exports = router;