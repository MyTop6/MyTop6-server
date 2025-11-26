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
  },
  { timestamps: true }
);
    //Reports
    reports: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Report"
      }
    ]

module.exports = mongoose.model("Community", CommunitySchema);