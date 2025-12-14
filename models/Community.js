// models/Community.js
const mongoose = require("mongoose");

const CommunitySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },

    // ⭐ Rich details & tagging
    detailsHtml: {
      type: String,
      default: "",
    },
    category: {
      type: String,
      default: "",
      index: true,
    },
    // Final merged tags used for search / recommendations
    tags: [
      {
        type: String,
        index: true,
      },
    ],
    // Tags chosen by the community founder / admins
    adminTags: [
      {
        type: String,
      },
    ],
    // Tags suggested by AI
    aiTags: [
      {
        type: String,
      },
    ],
    aiTagConfidence: {
      type: Number,
      default: 0,
    },

    // ⬇️ everything you already had
    communityPicture: {
      type: String,
      default: "",
    },
    administrator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    moderators: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    bannerColor: {
      type: String,
      default: "#6B21A8",
    },
    backgroundColor: {
      type: String,
      default: "#000000",
    },
    textColor: {
      type: String,
      default: "#FFFFFF",
    },
    backgroundImage: {
      type: String,
      default: "",
    },
    fontUrl: {
      type: String,
      default: "",
    },
    backgroundStyle: {
      type: String,
      default: "stretch", // or "repeat"
    },
    rules: [
      {
        title: {
          type: String,
          required: true,
        },
        description: {
          type: String,
          default: "",
        },
      },
    ],
    customHtmlCard: {
      type: String,
      default: "",
    },

    // ✅ Require mod approval for all bulletins
    requireApproval: {
      type: Boolean,
      default: false,
    },

    // ✅ Require mod approval for new members
    requireMemberApproval: {
      type: Boolean,
      default: false,
    },

    // Member question field
    requireMemberQuestion: { type: Boolean, default: false },

    // ✅ Optional: ask a question new members must answer
    membershipQuestionText: {
      type: String,
      default: "Why do you want to join this community?",
    },

    memberQuestionText: {
      type: String,
      default: "",
    },

    // ✅ Member Requests
    memberRequests: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    memberRequestAnswers: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        answer: { type: String, required: true },
      },
    ],

    // ✅ Track pending bulletin count
    pendingBulletins: {
      type: Number,
      default: 0,
    },

    // ✅ Reports linked to this community
    reports: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Report",
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Community", CommunitySchema);
