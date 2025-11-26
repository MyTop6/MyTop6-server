// routes/_makeAuthRouter.js
const express = require("express");
const { v4: uuid } = require("uuid");

module.exports = function makeAuthRouter({ Model, cookieName, headerName }) {
  const router = express.Router();
  const sessions = new Map(); // swap for Redis/Mongo later

  router.post("/", async (req, res) => {
    try {
      const { username, password, role } = req.body || {};
      if (!username || !password) return res.status(400).json({ error: "username and password required" });
      const user = new Model({ username, role });
      await user.setPassword(password);
      await user.save();
      res.status(201).json({ _id: user._id, username: user.username, role: user.role });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  router.post("/login", async (req, res) => {
    const { username, password } = req.body || {};
    const user = await Model.findOne({ username: String(username || "").toLowerCase().trim() });
    if (!user || !(await user.verifyPassword(password))) return res.status(401).json({ error: "Invalid credentials" });
    const sid = uuid();
    sessions.set(sid, { userId: user._id, at: Date.now() });
    res.cookie(cookieName, sid, { httpOnly: true, sameSite: "lax" });
    res.json({ sid, user: { _id: user._id, username: user.username, role: user.role } });
  });

  router.get("/me", async (req, res) => {
    const sid = req.get(headerName) || req.cookies?.[cookieName];
    const s = sid && sessions.get(sid);
    if (!s) return res.status(401).json({ error: "Not signed in" });
    const user = await Model.findById(s.userId).lean();
    if (!user) return res.status(401).json({ error: "Session invalid" });
    res.json({ _id: user._id, username: user.username, role: user.role });
  });

  router.post("/logout", (req, res) => {
    const sid = req.get(headerName) || req.cookies?.[cookieName];
    if (sid) sessions.delete(sid);
    res.json({ ok: true });
  });

  // optional middleware export
  router.requireAuth = (req, res, next) => {
    const sid = req.get(headerName) || req.cookies?.[cookieName];
    const s = sid && sessions.get(sid);
    if (!s) return res.status(401).json({ error: "Not signed in" });
    req.session = s;
    next();
  };

  return router;
};