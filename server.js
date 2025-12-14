// server.js

// 1️⃣ path + dotenv first
const path = require("path");
const dotenv = require("dotenv");

// Load .env before anything that uses env vars
dotenv.config({
  path: path.join(__dirname, ".env"),
});

// 2️⃣ Core libs
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const fs = require("fs");
const http = require("http");
const { Server } = require("socket.io");

// 3️⃣ Routes
const aiRoutes = require("./routes/ai");
const authRoutes = require("./routes/auth");
const quikmodUsers = require("./routes/quikmodUsers");      // Watchtower
const mainframeUsers = require("./routes/mainframe-users"); // Mainframe

console.log("Cloudinary env check:", {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  hasKey: !!process.env.CLOUDINARY_API_KEY,
  hasSecret: !!process.env.CLOUDINARY_API_SECRET,
});

const app = express();

// ---- Network config
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || "0.0.0.0";

app.set("trust proxy", 1);

// ---- Core middleware
app.use(express.json());
app.use(cookieParser());

// ============================================================================
// CORS configuration
// ============================================================================
const allowedOrigins = [
  "null",

  // MyTop6 React dev
  "http://localhost:3000",
  "http://127.0.0.1:3000",

  // Netlify production
  "https://mytop6.netlify.app",
  // future custom domains
  "https://mytop6.app",
  "https://www.mytop6.app",

  // Watchtower (5173)
  "http://localhost:5173",
  "http://127.0.0.1:5173",

  // Mainframe (5174/5175/5176)
  "http://localhost:5174",
  "http://127.0.0.1:5174",
  "http://localhost:5175",
  "http://127.0.0.1:5175",
  "http://localhost:5176",
  "http://127.0.0.1:5176",

  // LAN dev (optional)
  "http://192.168.2.2:5173",
  "http://192.168.2.2:5174",
];

const corsOriginCheck = (origin, cb) => {
  // Allow tools like curl/Postman (no Origin header)
  if (!origin) return cb(null, true);

  if (allowedOrigins.includes(origin)) {
    return cb(null, true);
  }

  console.log("❌ CORS blocked origin:", origin);
  return cb(new Error("Not allowed by CORS"));
};

const corsOptions = {
  origin: corsOriginCheck,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "x-session-id",
    "x-watchtower-session-id",
    "x-mainframe-session-id",
  ],
};

// expose custom headers
app.use((req, res, next) => {
  res.header(
    "Access-Control-Expose-Headers",
    "x-watchtower-session-id,x-mainframe-session-id"
  );
  next();
});

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

// ---- TEMP request logger
app.use((req, res, next) => {
  const origin = req.headers.origin || "(no origin)";
  console.log(`[${req.method}] ${req.originalUrl}  Origin:${origin}`);
  res.on("finish", () => {
    console.log(` -> ${res.statusCode} ${req.originalUrl}`);
  });
  next();
});

// ---- Static uploads
const uploadsDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });
app.use("/uploads", express.static(uploadsDir));

// ---- Health check
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ---- Route imports
const notificationsRoutes = require("./routes/notifications");
const moderationRoutes = require("./routes/moderation");
const quikmodUsersRoutes = require("./routes/quikmodUsers");
const usersPublicRouter = require("./routes/users.public");
const usersRouter = require("./routes/users");
const warningLevelRouter = require("./routes/warningLevel");
const uploadRoutes = require("./routes/upload");
const locationsRoutes = require("./routes/locations");
const threadsRoutes = require("./routes/threads");

const cgviModule = require("./routes/cgvi");
const cgviRouter =
  cgviModule && cgviModule.default ? cgviModule.default : cgviModule;

console.log("✅ Mongo URI present:", !!process.env.MONGODB_URI);

const requireAuth = require("./middleware/auth");

// ============================================================================
// SOCKET.IO SETUP (for instant messaging)
// ============================================================================
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: corsOriginCheck,
    credentials: true,
    methods: ["GET", "POST"],
  },
});

// Make io available in routes via req.app.get("io")
app.set("io", io);

io.on("connection", (socket) => {
  const userId = socket.handshake.query?.userId;
  if (userId) {
    socket.join(`user:${userId}`);
    console.log(`📡 Socket connected for user ${userId} (${socket.id})`);
  } else {
    console.log(`📡 Socket connected without userId (${socket.id})`);
  }

  socket.on("disconnect", () => {
    console.log(`📴 Socket disconnected: ${socket.id}`);
  });
});

// ============================================================================
// CONNECT DB, THEN MOUNT ROUTES
// ============================================================================
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("✅ Connected to MongoDB Atlas!");

    // Public routes
    app.use("/api/cgvi", cgviRouter);
    app.use("/api/upload", uploadRoutes);
    app.use("/api/ama", require("./routes/ama"));
    app.use("/api/friendships", require("./routes/friendships"));
    app.use("/api/notifications", notificationsRoutes);
    app.use("/api/quikmod-users", quikmodUsersRoutes);
    app.use("/api/locations", locationsRoutes);

    // MyTop6 Auth
    app.use("/api/auth", authRoutes);

    // User routes
    app.use("/api/users", usersPublicRouter);
    app.use("/api/users", usersRouter);

    app.use("/api/ai", aiRoutes);

    // Feature routes
    app.use("/api/bulletins", require("./routes/bulletins"));
    app.use("/api/messages", require("./routes/messages"));
    app.use("/api/communities", require("./routes/communities"));
    app.use("/api/questions", require("./routes/questions"));
    app.use("/api/status", require("./routes/status"));
    app.use("/api", threadsRoutes);

    // Internal
    app.use("/api/moderation", requireAuth, moderationRoutes);
    app.use("/api/reports", requireAuth, require("./routes/reports"));
    app.use("/api/memos", requireAuth, require("./routes/memos"));

    // =====================================================================
    // SPA STATIC CLIENT (OPTIONAL)
    // =====================================================================
    const clientBuildPath = path.join(__dirname, "client", "build");

    if (fs.existsSync(clientBuildPath)) {
      console.log("✅ Serving MyTop6 client from:", clientBuildPath);

      app.use(express.static(clientBuildPath));

      app.get(/^\/(?!api\/).*/, (req, res) => {
        res.sendFile(path.join(clientBuildPath, "index.html"));
      });
    } else {
      console.log("ℹ️ No client build found:", clientBuildPath);
    }

    // Start server (NOTE: server.listen, not app.listen)
    server.listen(PORT, HOST, () => {
      console.log(`🚀 Server running on http://${HOST}:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ MongoDB error:", err);
  });

module.exports = { app, server, io };
