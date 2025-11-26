const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const MainframeUserSchema = new mongoose.Schema({
  // Human-friendly name shown in UI (e.g., "Kaguya Otsutsuki")
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },

  // Admin ID / username used to sign in
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },

  passwordHash: { type: String, required: true },

  role: { type: String, enum: ["admin","lead","analyst","viewer"], default: "analyst" },

  createdAt: { type: Date, default: Date.now },
});

MainframeUserSchema.methods.verifyPassword = function (password) {
  return bcrypt.compare(password, this.passwordHash);
};

module.exports = mongoose.model("MainframeUser", MainframeUserSchema);