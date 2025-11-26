// models/Friendship.js
const mongoose = require('mongoose');

const FriendshipSchema = new mongoose.Schema({
  requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: {
    type: String,
    enum: ['pending', 'accepted'],
    default: 'pending',
  },
}, { timestamps: true });

FriendshipSchema.index({ requester: 1 });
FriendshipSchema.index({ recipient: 1 });

module.exports = mongoose.model('Friendship', FriendshipSchema);