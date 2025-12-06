// routes/upload.js
const express = require("express");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

const router = express.Router();

// Configure Cloudinary storage for multer
const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    return {
      folder: "mytop6",      // folder name inside your Cloudinary Media Library
      resource_type: "auto", // images + videos
    };
  },
});

const upload = multer({ storage });

// ✅ Upload endpoint – expects field name "file"
router.post("/", (req, res) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      console.error("Cloudinary upload error:", err);
      return res.status(500).json({ error: "Upload failed" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const url = req.file.path; // secure Cloudinary URL
    const publicId = req.file.filename || req.file.public_id;

    return res.json({ url, publicId });
  });
});

module.exports = router;