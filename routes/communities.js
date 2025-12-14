const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const Community = require("../models/Community");
const Bulletin = require("../models/Bulletin");
const User = require("../models/User");

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage });

// ✅ Get all communities
router.get("/", async (req, res) => {
  try {
    const search = req.query.search || "";
    const communities = await Community.find({
      name: { $regex: search, $options: "i" },
    });
    res.json(communities);
  } catch (err) {
    console.error("Fetch communities error:", err);
    res.status(500).json({ error: err.message || "Failed to fetch communities." });
  }
});

// ✅ Popular Today — top 6 by bulletin activity in last 24h
router.get("/top", async (req, res) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const communities = await Community.aggregate([
      {
        $lookup: {
          from: "bulletins",
          localField: "_id",
          foreignField: "communityId",
          as: "bulletins",
        },
      },
      {
        $addFields: {
          recentActivityCount: {
            $size: {
              $filter: {
                input: "$bulletins",
                as: "b",
                cond: { $gte: ["$$b.createdAt", since] },
              },
            },
          },
        },
      },
      { $sort: { recentActivityCount: -1, _id: 1 } },
      { $limit: 6 },
      {
        $project: {
          _id: 1,
          name: 1,
          communityPicture: 1,
          recentActivityCount: 1,
        },
      },
    ]);

    res.json(communities);
  } catch (err) {
    console.error("Top communities error:", err);
    res.status(500).json({ error: err.message || "Failed to fetch top communities." });
  }
});

// ✅ Trending — top 6 by (likes in past 36h / member count)
router.get("/trending", async (req, res) => {
  try {
    const since = new Date(Date.now() - 36 * 60 * 60 * 1000);
    const allCommunities = await Community.find();

    const trending = await Promise.all(
      allCommunities.map(async (community) => {
        const bulletins = await Bulletin.find({
          communityId: community._id,
          createdAt: { $gte: since },
        });

        const totalLikes = bulletins.reduce((sum, b) => sum + (b.likes?.length || 0), 0);
        const memberCount = community.members?.length || 1; // prevent division by zero

        const score = totalLikes / memberCount;

        return {
          _id: community._id,
          name: community.name,
          communityPicture: community.communityPicture,
          trendingScore: score,
        };
      })
    );

    const topTrending = trending
      .sort((a, b) => b.trendingScore - a.trendingScore)
      .slice(0, 6);

    res.json(topTrending);
  } catch (err) {
    console.error("Trending communities error:", err);
    res.status(500).json({ error: err.message || "Failed to fetch trending communities." });
  }
});

// Create a new community
router.post("/", async (req, res) => {
  try {
    const {
      name,
      description,
      coverImageUrl,
      creatorId,
      bannerColor,
      backgroundColor,
      textColor,
      backgroundImage,
      fontUrl,
      backgroundStyle,
      rules = [],
      detailsHtml = "",
      category = "",
      tags = [],
      adminTags = [],
      aiTags = [],
      aiTagConfidence = 0,
    } = req.body;

    if (!/^[a-zA-Z0-9]+$/.test(name)) {
      return res.status(400).json({
        error: "Community name must only contain letters and numbers — no spaces or special characters.",
      });
    }

    const existing = await Community.findOne({ name });
    if (existing)
      return res.status(400).json({ error: "Community already exists." });

    const newCommunity = new Community({
      name,
      description,
      communityPicture: coverImageUrl || "",
      administrator: creatorId,
      administratorSince: new Date(),
      members: [creatorId],
      bannerColor: bannerColor || "#6B21A8",
      backgroundColor: backgroundColor || "#000000",
      textColor: textColor || "#FFFFFF",
      backgroundImage: backgroundImage || "",
      fontUrl: fontUrl || "",
      backgroundStyle: backgroundStyle || "stretch",
      rules,
      detailsHtml,
      category,
      tags,
      adminTags,
      aiTags,
      aiTagConfidence,
    });

    await newCommunity.save();
    res.status(201).json(newCommunity);
  } catch (err) {
    console.error("Community creation error:", err);
    res.status(500).json({ error: err.message || "Failed to create community." });
  }
});

// ✅ Upload or change community picture
router.put("/:id/picture", upload.single("picture"), async (req, res) => {
  try {
    const community = await Community.findById(req.params.id);
    if (!community) return res.status(404).json({ error: "Community not found." });

    const { adminId } = req.body;
    if (community.administrator.toString() !== adminId) {
      return res.status(403).json({ error: "Only the administrator can update the picture." });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    console.log("File uploaded:", req.file);

    community.communityPicture = `/uploads/${req.file.filename}`;
    await community.save();

    console.log("Updated communityPicture URL:", community.communityPicture);

    res.json(community);
  } catch (err) {
    console.error("Upload picture error:", err);
    res.status(500).json({ error: err.message || "Failed to upload picture." });
  }
});

// ✅ Remove community picture
router.put("/:id/picture/remove", async (req, res) => {
  try {
    const community = await Community.findById(req.params.id);
    if (!community) return res.status(404).json({ error: "Community not found." });

    const { adminId } = req.body;
    if (community.administrator.toString() !== adminId) {
      return res.status(403).json({ error: "Only the administrator can remove the picture." });
    }

    community.communityPicture = "";
    await community.save();

    res.json({ message: "Picture removed successfully." });
  } catch (err) {
    console.error("Remove picture error:", err);
    res.status(500).json({ error: err.message || "Failed to remove picture." });
  }
});

// Join a community (with optional mod approval and question)
router.post("/:id/join", async (req, res) => {
  console.log("Join request received with body:", req.body);
  try {
    const { userId, answer } = req.body;
    const community = await Community.findById(req.params.id);
    if (!community) return res.status(404).json({ error: "Community not found." });

    // Already a member
    if (community.members.includes(userId)) {
      return res.status(400).json({ error: "User is already a member." });
    }

    // Already requested to join
    if (community.memberRequests?.some((id) => id.toString() === userId)) {
      return res.status(400).json({ error: "Join request already submitted." });
    }

    if (community.requireMemberApproval) {
      // If question is required but no answer given
      if (community.requireMemberQuestion && (!answer || answer.trim() === "")) {
        return res.status(400).json({ error: "Answer is required to join this community." });
      }

      // Check if request already exists
      if (community.memberRequests?.some((id) => id.toString() === userId)) {
        return res.status(400).json({ error: "Join request already submitted." });
      }

      // Sync to both arrays
      community.memberRequests.push(userId);
      if (answer) {
        community.memberRequestAnswers.push({ user: userId, answer: answer.trim() });
      }
    } else {
      // No approval required, add user directly
      community.members.push(userId);
    }

    await community.save();
    res.json({ message: "Join request processed.", community });
  } catch (err) {
    console.error("Join community error:", err);
    console.error(err.stack); // Add this line to get full trace
    res.status(500).json({ error: err.message || "Failed to join community." });
  }
});

// Leave a community
router.post("/:id/leave", async (req, res) => {
  try {
    const community = await Community.findById(req.params.id);
    const userId = req.body.userId;

    community.members = community.members.filter(
      (id) => id.toString() !== userId
    );
    await community.save();

    res.json(community);
  } catch (err) {
    console.error("Leave community error:", err);
    res.status(500).json({ error: err.message || "Failed to leave community." });
  }
});

// Promote a member to moderator
router.post("/:id/promote", async (req, res) => {
  try {
    const { userId, adminId } = req.body;
    const community = await Community.findById(req.params.id);

    if (community.administrator.toString() !== adminId) {
      return res.status(403).json({ error: "Only the administrator can promote moderators." });
    }

    if (!community.moderators.includes(userId)) {
      community.moderators.push(userId);
      await community.save();
    }

    res.json(community);
  } catch (err) {
    console.error("Promote error:", err);
    res.status(500).json({ error: err.message || "Failed to promote moderator." });
  }
});

// Remove a moderator
router.post("/:id/demote", async (req, res) => {
  try {
    const { userId, adminId } = req.body;
    const community = await Community.findById(req.params.id);

    if (community.administrator.toString() !== adminId) {
      return res.status(403).json({ error: "Only the administrator can remove moderators." });
    }

    community.moderators = community.moderators.filter(
      (modId) => modId.toString() !== userId
    );
    await community.save();

    res.json(community);
  } catch (err) {
    console.error("Demote error:", err);
    res.status(500).json({ error: err.message || "Failed to remove moderator." });
  }
});

// Transfer ownership
router.post("/:id/transfer", async (req, res) => {
  try {
    const { newAdminId, currentAdminId } = req.body;
    const community = await Community.findById(req.params.id);

    if (!community) return res.status(404).json({ error: "Community not found." });

    if (community.administrator.toString() !== currentAdminId) {
      return res.status(403).json({ error: "Only the current administrator can transfer ownership." });
    }

    community.administrator = newAdminId;
    community.administratorSince = new Date();
    await community.save();

    res.json(community);
  } catch (err) {
    console.error("Transfer ownership error:", err);
    res.status(500).json({ error: err.message || "Failed to transfer ownership." });
  }
});

// Update rules
router.put("/:id/rules", async (req, res) => {
  try {
    const { adminId, rules } = req.body;
    const community = await Community.findById(req.params.id);

    if (!community) return res.status(404).json({ error: "Community not found." });

    if (community.administrator.toString() !== adminId) {
      return res.status(403).json({ error: "Only the administrator can update rules." });
    }

    community.rules = rules;
    await community.save();

    res.json(community);
  } catch (err) {
    console.error("Update rules error:", err);
    res.status(500).json({ error: err.message || "Failed to update rules." });
  }
});

// Update custom HTML
router.put("/:id/custom-html", async (req, res) => {
  try {
    const { adminId, htmlContent } = req.body;
    const community = await Community.findById(req.params.id);

    if (!community) return res.status(404).json({ error: "Community not found." });

    if (community.administrator.toString() !== adminId) {
      return res.status(403).json({ error: "Only the administrator can update custom HTML." });
    }

    community.customHtmlCard = htmlContent;
    await community.save();

    res.json(community);
  } catch (err) {
    console.error("Update custom HTML error:", err);
    res.status(500).json({ error: err.message || "Failed to update custom HTML." });
  }
});

// ✅ Update requireApproval setting
router.put("/:id/require-approval", async (req, res) => {
  try {
    const { adminId, requireApproval } = req.body;
    const community = await Community.findById(req.params.id);

    if (!community) return res.status(404).json({ error: "Community not found." });

    if (community.administrator.toString() !== adminId) {
      return res.status(403).json({ error: "Only the administrator can update this setting." });
    }

    community.requireApproval = requireApproval;
    await community.save();

    res.json({ message: "Approval setting updated.", requireApproval: community.requireApproval });
  } catch (err) {
    console.error("Update requireApproval error:", err);
    res.status(500).json({ error: err.message || "Failed to update approval setting." });
  }
});

// ✅ Update requireMemberApproval setting
router.put("/:id/require-member-approval", async (req, res) => {
  try {
    const { adminId, requireMemberApproval } = req.body;
    const community = await Community.findById(req.params.id);

    if (!community) return res.status(404).json({ error: "Community not found." });

    if (community.administrator.toString() !== adminId) {
      return res.status(403).json({ error: "Only the administrator can update this setting." });
    }

    community.requireMemberApproval = requireMemberApproval;
    await community.save();

    res.json({
      message: "Member approval setting updated.",
      requireMemberApproval: community.requireMemberApproval,
    });
  } catch (err) {
    console.error("Update requireMemberApproval error:", err);
    res.status(500).json({
      error: err.message || "Failed to update member approval setting.",
    });
  }
});

// ✅ Update requireMemberQuestion and memberQuestionText
router.put("/:id/member-question", async (req, res) => {
  try {
    const { adminId, requireMemberQuestion, memberQuestionText } = req.body;
    const community = await Community.findById(req.params.id);

    if (!community) return res.status(404).json({ error: "Community not found." });

    if (community.administrator.toString() !== adminId) {
      return res.status(403).json({ error: "Only the administrator can update this setting." });
    }

    console.log("✅ Incoming to member-question route:", {
      requireMemberQuestion,
      memberQuestionText,
    });

    console.log("📌 Before saving:");
    console.log("  community.requireMemberQuestion =", community.requireMemberQuestion);
    console.log("  typeof requireMemberQuestion =", typeof requireMemberQuestion);

    console.log("API called with:", {
      requireMemberQuestion,
      memberQuestionText,
    });

    // 🔧 Set both values explicitly
    community.requireMemberQuestion = requireMemberQuestion;
    community.memberQuestionText = memberQuestionText;

    await community.save();

    console.log("✅ After saving:");
    console.log("  community.requireMemberQuestion =", community.requireMemberQuestion);

    res.json({
      message: "Member question settings updated.",
      requireMemberQuestion: community.requireMemberQuestion,
      memberQuestionText: community.memberQuestionText
    });
  } catch (err) {
    console.error("Update requireMemberQuestion error:", err);
    res.status(500).json({ error: err.message || "Failed to update member question setting." });
  }
});

// ✅ Get a specific community (ensures all keys are returned)
router.get("/:id", async (req, res) => {
  try {
    const communityDoc = await Community.findById(req.params.id)
      .populate("members", "username profilePicture")
      .populate("administrator", "username profilePicture handle")
      .populate("moderators", "username profilePicture handle");

    if (!communityDoc) {
      return res.status(404).json({ error: "Community not found." });
    }

    const community = communityDoc.toObject();

    // Explicitly include requireMemberQuestion even if false
    if (community.requireMemberQuestion === undefined) {
      community.requireMemberQuestion = false;
    }

    res.json(community);
  } catch (err) {
    console.error("Fetch community error:", err);
    res.status(500).json({ error: err.message || "Failed to fetch community." });
  }
});

// ✅ Get pending member requests for a community
router.get("/:id/pending-members", async (req, res) => {
  try {
    const community = await Community.findById(req.params.id)
      .populate("memberRequests.user", "username handle profilePicture location");

    if (!community) return res.status(404).json({ error: "Community not found." });

    res.json(community.memberRequests || []);
  } catch (err) {
    console.error("Fetch pending members error:", err);
    res.status(500).json({ error: "Failed to fetch pending members." });
  }
});

// ✅ Approve or deny a pending member request
router.post("/:id/respond-member", async (req, res) => {
  try {
    const { adminId, userId, approve } = req.body;
    const community = await Community.findById(req.params.id);

    if (!community) return res.status(404).json({ error: "Community not found." });

    const isMod = community.administrator.toString() === adminId ||
      community.moderators.includes(adminId);
    if (!isMod) {
      return res.status(403).json({ error: "Only admins or moderators can approve members." });
    }

    const requestExists = community.memberRequests.some(
      (id) => id.toString() === userId
    );
    if (!requestExists) {
      return res.status(404).json({ error: "Join request not found." });
    }

    if (approve) {
      community.members.push(userId);
    }

    community.memberRequests = community.memberRequests.filter(
      (id) => id.toString() !== userId
    );

    community.memberRequestAnswers = community.memberRequestAnswers.filter(
      (entry) => entry.user.toString() !== userId
    );

    await community.save();

    res.json({
      message: approve ? "Member approved." : "Member denied.",
      members: community.members,
    });
  } catch (err) {
    console.error("Respond to member request error:", err);
    res.status(500).json({ error: "Failed to respond to member request." });
  }
});

// GET /api/communities/:id/member-requests
router.get("/:id/member-requests", async (req, res) => {
  try {
    const community = await Community.findById(req.params.id)
      .populate("memberRequests", "username handle profilePicture location")
      .lean();

    if (!community) return res.status(404).json({ error: "Community not found" });

    const question = community.memberQuestionText;

    const results = community.memberRequests.map((user) => {
      const answerEntry = community.memberRequestAnswers?.find(
        (entry) => entry.user.toString() === user._id.toString()
      );

      return {
        user,
        answer: answerEntry?.answer || null,
        question: community.requireMemberQuestion ? question : null,
      };
    });

    res.json(results);
  } catch (err) {
    console.error("Error getting member requests:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// 🔰  GET  /api/communities/mod-summary/:userId
//      Returns every community the user admins/moderates
//      plus three moderation-queue counts for each one.
router.get("/mod-summary/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // all communities the user owns OR moderates
    const communities = await Community.find({
      $or: [
        { administrator: userId },
        { moderators: userId }
      ]
    }).lean();                                // lean = plain JS objects

    // grab counts for every community in parallel
    const enriched = await Promise.all(
      communities.map(async (c) => {
        // 1️⃣  bulletins awaiting approval
        const pendingBulletins = await Bulletin.countDocuments({
          communityId: c._id,
          approved: false,                     // you probably have this flag already
        });

        // 2️⃣  member requests awaiting approval
        const pendingMembers  = (c.memberRequests || []).length; // adjust to match your schema

        // 3️⃣  content reported *to mods* (not QuikMod)
        const reported = await Bulletin.countDocuments({
          communityId: c._id,
          reportedToMods: true
        });

        // 👇 Get admin display name
        const admin = await User.findById(c.administrator).select("username");

        return {
          _id:                 c._id,
          name:                c.name,
          communityPicture:    c.communityPicture,
          administrator:       admin?.username || "Unknown",
          pendingBulletins,
          pendingMembers,
          reported
        };
      })
    );

    res.json(enriched);
  } catch (err) {
    console.error("mod-summary error:", err);
    res.status(500).json({ error: "Failed to fetch moderation summary." });
  }
});

module.exports = router;