// routes/upload.js
const express = require("express");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

const router = express.Router();

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const isAudio = file.mimetype?.startsWith("audio/");
    return {
      folder: "mytop6",
      resource_type: isAudio ? "video" : "auto", // ✅ audio goes under "video" on Cloudinary
    };
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // ✅ 25MB (raise if you want)
  fileFilter: (req, file, cb) => {
    const ok =
      file.mimetype.startsWith("image/") ||
      file.mimetype.startsWith("video/") ||
      file.mimetype.startsWith("audio/");
    cb(ok ? null : new Error("Unsupported file type"), ok);
  },
});

router.post("/", (req, res) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      console.error("Cloudinary upload error:", err);
      return res.status(500).json({ error: err.message || "Upload failed" });
    }

    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const url = req.file.path; // secure URL
    const publicId = req.file.filename || req.file.public_id;

    return res.json({ url, publicId });
  });
});

module.exports = router;
