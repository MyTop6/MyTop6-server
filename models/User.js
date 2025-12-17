// models/User.js
const mongoose = require('mongoose');

/* ================== Embedded sub-schemas ================== */

// Each addendum that is attached to an existing memo
const AddendumSchema = new mongoose.Schema(
  {
    text: { type: String, default: '' },                 // freeform addendum text
    cgvi: { type: String, default: null },               // optional: CGVI update made in this addendum (e.g., "101.1")
    reportId: { type: mongoose.Schema.Types.ObjectId, ref: 'Report', default: null },
    leftByUsername: { type: String, default: null },     // moderator username/display name
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// Tracks the evolution of the memo's CGVI over time
const CgviHistorySchema = new mongoose.Schema(
  {
    cgvi: { type: String, required: true },              // e.g. "102.1"
    by:   { type: String, default: null },               // moderator username/display name
    at:   { type: Date, default: Date.now },
  },
  { _id: false }
);

/* ================== Memo schema (embedded on User) ================== */

// ✅ Define addendum schema (nested under a memo)
const addendumSchema = new mongoose.Schema({
  text: { type: String },
  cgvi: { type: String }, // optional CGVI override supplied by the addendum
  reportId: { type: mongoose.Schema.Types.ObjectId, ref: 'Report' },
  leftByUsername: { type: String },
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

// ✅ Define memo schema
const memoSchema = new mongoose.Schema({
  // Newer style fields
  descriptionOfContent: { type: String },
  reasonForAction: { type: String },

  // Legacy fields
  action: { type: String },
  note:   { type: String },

  // Optional metadata on the memo itself
  leftByUsername: { type: String },
  reportId: { type: mongoose.Schema.Types.ObjectId, ref: 'Report' },

  // Current CGVI for this memo (will be updated if an addendum includes cgvi)
  cgvi: { type: String },

  // Array of addenda attached to this memo
  addenda: [addendumSchema],

  createdAt: { type: Date, default: Date.now }
});

// Require either (descriptionOfContent + reasonForAction) or (action + note)
memoSchema.pre('validate', function(next) {
  const hasNew = this.descriptionOfContent && this.reasonForAction;
  const hasOld = this.action && this.note;
  if (!hasNew && !hasOld) {
    return next(new Error('Either (descriptionOfContent + reasonForAction) or (action + note) must be provided.'));
  }
  next();
});

/* ================== User schema ================== */

const userSchema = new mongoose.Schema(
  {
    // 🔐 Auth / identity
    phoneNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    phoneVerified: {
      type: Boolean,
      default: false,
    },

    // Display name (not unique)
    username: {
      type: String,
      required: true,
    },

    handle: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      match: /^[a-zA-Z0-9_]+$/, // letters, numbers, underscores only
    },

    // Store ONLY the hash, never the raw password
    passwordHash: {
      type: String,
      required: true,
    },

    // 🚫 Ban status
    banned: {
      type: Boolean,
      default: false,
    },

    // 🎂 Date of birth (for 13+ checks)
    dob: {
      type: Date,
    },

    // (Optional) legacy / display age
    age: Number,

    bio: String,
    location: String,
    profilePicture: {
      type: String,
      default: '/nophoto.png',   // served from /public/nophoto.png
    },
    aboutMeHtml: String,

    // 📣 Bulletin posts (text, image, or video)
    bulletins: [
      {
        type: {
          type: String, // "text", "image", or "video"
          required: true,
          enum: ['text', 'image', 'video'],
        },
        content: String,
        caption: String,
        timestamp: { type: Date, default: Date.now },
      },
    ],

    // Current status (mood + blurblet)
    statusMood: {
      type: String,
      maxlength: 80,
      default: "",
    },

    statusBlip: {
      type: String,
      maxlength: 100,
      default: "",
    },

    statusUpdatedAt: {
      type: Date,
    },

    // 👥 Friend system
    topFriends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    // 🎵 Music
    profileMusicUrl: { type: String, default: "" },
    profileMusicPublicId: { type: String, default: "" },

    // Optional display metadata for the profile player UI
    profileMusicTitle: { type: String, default: "" },
    profileMusicArtist: { type: String, default: "" },

    // 🎨 Profile customization theme
    theme: {
      bannerColor: { type: String, default: '#033399' },
      backgroundColor: { type: String, default: '#ebebeb' },
      backgroundImage: { type: String, default: '' },
      backgroundStyle: { type: String, default: 'stretch' },
      boxColor: { type: String, default: '#ffffff' },
      contactButtonColor: { type: String, default: '#649AC8' },
      bulletinButtonColor: { type: String, default: '#033399' },
      floatingMessageIconColor: { type: String, default: '#3B82F6' },
      boxCornerStyle: { type: String, default: 'rounded' },
      textColor: { type: String, default: '#000000' },
      fontUrl: { type: String, default: '' },
      boxBackgroundImage: { type: String, default: '' },
      boxOpacity: { type: Number, default: 1 },
      boxBorderEnabled: { type: Boolean, default: false },
      boxBorderColor: { type: String, default: '#FFFFFF' },
    },

    // ✅ Dashboard data (new comments count, etc.)
    dashboardData: {
      newComments: { type: Number, default: 0 },
      newNotes: { type: Number, default: 0 },
      unreadMessages: { type: Number, default: 0 },
    },

    // 🔮 AI personalization: tag interest profile
    interestTags: {
      type: Map,
      of: Number,
      default: {},
    },

    // ✅ Ask Me Anything feature
    askMeAnythingEnabled: { type: Boolean, default: false },
    allowAnonymousQuestions: { type: Boolean, default: false },

    // ✅ Moderator memos attached to user (with addenda + CGVI history)
    memos: [memoSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);