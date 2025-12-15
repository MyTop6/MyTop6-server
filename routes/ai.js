// routes/ai.js
const express = require("express");
const router = express.Router();

const { getFreeformTagsForBulletin } = require("../utils/aiTagger");
const { getRandomTheme } = require("../utils/aiThemeRandomizer");

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

    const { tags } = await getFreeformTagsForBulletin({
      content: description || "",
      caption: detailsHtml || "",
      communityName: name || "",
    });

    const normalizedAdmin = (adminTags || [])
      .map((t) => String(t).trim().toLowerCase())
      .filter(Boolean);

    const aiTags = (tags || [])
      .map((t) => String(t).trim().toLowerCase())
      .filter((t) => t && !normalizedAdmin.includes(t));

    const aiTagConfidence = aiTags.length > 0 ? 0.8 : 0;

    return res.json({ aiTags, aiTagConfidence });
  } catch (err) {
    console.error("community-tags AI error:", err);
    return res.status(500).json({ error: "Failed to generate AI tags." });
  }
});

/**
 * POST /api/ai/randomize-theme
 * body: { vibe?: string, currentTheme?: object }
 * returns: { theme: { bannerColor, backgroundColor, boxColor, contactButtonColor, textColor } }
 */
router.post("/randomize-theme", async (req, res) => {
  try {
    const { vibe, currentTheme } = req.body || {};

    const result = await getRandomTheme({ vibe, currentTheme });

    return res.json(result); // { theme, vibeUsed }
  } catch (err) {
    console.error("AI randomize-theme error:", err);
    return res.status(500).json({
      error: err.message || "Failed to randomize theme.",
    });
  }
});

module.exports = router;
