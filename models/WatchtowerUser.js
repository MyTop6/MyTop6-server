const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const WatchtowerUserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["admin","supervisor","moderator","trainee"], default: "moderator" },
  },
  { timestamps: true }
);

WatchtowerUserSchema.methods.setPassword = async function (password) {
  this.passwordHash = await bcrypt.hash(password, 10);
};

WatchtowerUserSchema.methods.verifyPassword = function (password) {
  return bcrypt.compare(password, this.passwordHash);
};

module.exports = mongoose.model("WatchtowerUser", WatchtowerUserSchema);