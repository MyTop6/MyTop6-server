const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const communityReportSchema = new Schema(
  {
    community: {
      type: Schema.Types.ObjectId,
      ref: "Community",
      required: true,
    },
    contentId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    contentType: {
      type: String,
      required: true, // e.g., "bulletin", "comment", "custom-card"
    },
    contentText: {
      type: String,
    },
    reportedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    reason: {
      type: String,
    },
    status: {
      type: String,
      enum: ["pending", "reviewed", "dismissed", "removed"],
      default: "pending",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CommunityReport", communityReportSchema);