// routes/ai.js
const express = require("express");
const router = express.Router();

const { getFreeformTagsForBulletin } = require("../utils/aiTagger");

/**
 * POST /api/ai/community-tags
 * body: { name, description, detailsHtml, category, tags: adminTags }
 * returns: { aiTags, aiTagConfidence }
 */
router.post("/community-tags", async (req, res) => {
  try {
    const {
      name = "",
      description = "",
      detailsHtml = "",
      category = "",
      tags: adminTags = [],
    } = req.body || {};

    // We can reuse your existing bulletin tagger:
    const { tags } = await getFreeformTagsForBulletin({
      content: description || "",
      caption: detailsHtml || "",
      communityName: name || "",
    });

    const normalizedAdmin = (adminTags || [])
      .map((t) => String(t).trim().toLowerCase())
      .filter(Boolean);

    // Filter out tags the admin already added
    const aiTags = (tags || [])
      .map((t) => String(t).trim().toLowerCase())
      .filter((t) => t && !normalizedAdmin.includes(t));

    // Simple confidence placeholder – you can tune this later
    const aiTagConfidence = aiTags.length > 0 ? 0.8 : 0;

    return res.json({ aiTags, aiTagConfidence });
  } catch (err) {
    console.error("community-tags AI error:", err);
    return res.status(500).json({ error: "Failed to generate AI tags." });
  }
});

module.exports = router;
