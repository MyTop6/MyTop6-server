const mongoose = require('mongoose');

// ✅ Define reply schema separately with _id enabled
const replySchema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  replies: [], // Will be defined recursively later
  isNewComment: { type: Boolean, default: false }
});

// ✅ Enable recursive replies
replySchema.add({ replies: [replySchema] });

const commentSchema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  reposts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  replies: [replySchema],
  isNewComment: { type: Boolean, default: false }
});

const bulletinSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['text', 'image', 'video', 'ama'],
    required: true
  },
  content: {
    type: String // HTML or caption
  },
  mediaUrl: {
    type: String // for image/video posts
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  likes: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  ],
  reposts: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bulletin'
    }
  ],
  repostOf: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bulletin',
    default: null
  },
  repostedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  comments: [commentSchema],
  communityId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Community',
    default: null
  },
  approved: {
    type: Boolean,
    default: true // Or false if you want to manually approve by default
  },
  // 🔄 Replacing `reported` with two distinct fields
  reportedToMods: {
    type: Boolean,
    default: false
  },
  reportedToQuikMod: {
    type: Boolean,
    default: false
  },
  isAmaAnswer: {
    type: Boolean,
    default: false
  },
  amaQuestionUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  amaAnswerUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  amaQuestionText: {
    type: String,
    default: ''
  },
  amaAnswerText: {
    type: String,
    default: ''
  },
  tags: [
  {
    type: String,
    index: true
  }
],
aiTagConfidence: {
  type: Number,
  default: 0
},
});

// ✅ Suggested indexes for optimization
bulletinSchema.index({ userId: 1, createdAt: -1 });
bulletinSchema.index({ communityId: 1 });
bulletinSchema.index({ communityId: 1, approved: 1 });
bulletinSchema.index({ communityId: 1, reportedToMods: 1 });      // updated
bulletinSchema.index({ communityId: 1, reportedToQuikMod: 1 });   // new
bulletinSchema.index({ repostOf: 1 });
bulletinSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Bulletin', bulletinSchema);