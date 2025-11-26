// server.js
const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const quikmodUsers   = require("./routes/quikmodUsers");      // Watchtower
const mainframeUsers = require("./routes/mainframe-users");   // Mainframe

dotenv.config();

const app = express();

// ---- Network config
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';

app.set('trust proxy', 1);

// ---- Core middleware
app.use(express.json());
app.use(cookieParser());

// ============================================================================
// CORS CONFIGURATION
// ============================================================================

// 〰️ ADDED: Allow production frontend (Netlify, custom domain, etc.)
const deployedOrigins = [
  process.env.CLIENT_ORIGIN,       // e.g. https://mytop6.netlify.app
  process.env.CLIENT_ORIGIN_2,     // optional fallback
].filter(Boolean);

const allowedOrigins = [
  "null",

  // MyTop6 React dev
  "http://localhost:3000",
  "http://127.0.0.1:3000",

  // Watchtower
  "http://localhost:5173",
  "http://127.0.0.1:5173",

  // Mainframe
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:5176",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:5175",
  "http://127.0.0.1:5176",

  // LAN dev
  "http://192.168.2.2:5173",
  "http://192.168.2.2:5174",

  // 〰️ ADDED: Deployment origins
  ...deployedOrigins
];

const corsOptions = {
  origin(origin, cb) {
    // Allow tools like curl or server-side requests
    if (!origin) return cb(null, true);

    // Allow explicitly whitelisted origins
    if (allowedOrigins.includes(origin)) {
      return cb(null, true);
    }

    // Special LAN pattern
    if (/^http:\/\/192\.168\.2\.\d+:517[4-6]$/.test(origin)) {
      return cb(null, true);
    }

    return cb(new Error(`Origin not allowed by CORS: ${origin}`));
  },
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
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// ---- Health check
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ---- Route imports
const notificationsRoutes = require('./routes/notifications');
const moderationRoutes    = require('./routes/moderation');
const quikmodUsersRoutes  = require('./routes/quikmodUsers');
const usersPublicRouter   = require('./routes/users.public');
const usersRouter         = require('./routes/users');
const warningLevelRouter  = require('./routes/warningLevel');
const uploadRoutes        = require('./routes/upload');
const locationsRoutes     = require('./routes/locations');
const threadsRoutes       = require('./routes/threads');

const cgviModule = require('./routes/cgvi');
const cgviRouter = (cgviModule && cgviModule.default) ? cgviModule.default : cgviModule;

console.log('✅ Mongo URI present:', !!process.env.MONGODB_URI);

const requireAuth = require("./middleware/auth");

// ============================================================================
// CONNECT DB, THEN MOUNT ROUTES
// ============================================================================
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB Atlas!');

    // Public routes
    app.use('/api/cgvi', cgviRouter);
    app.use('/api/upload', uploadRoutes);
    app.use('/api/ama', require('./routes/ama'));
    app.use('/api/friendships', require('./routes/friendships'));
    app.use('/api/notifications', notificationsRoutes);
    app.use('/api/quikmod-users', quikmodUsersRoutes);
    app.use('/api/locations', locationsRoutes);

    // MyTop6 Auth
    app.use('/api/auth', require('./routes/auth'));

    // User routes
    app.use('/api/users', usersPublicRouter);
    app.use('/api/users', usersRouter);

    // Feature routes
    app.use('/api/bulletins', require('./routes/bulletins'));
    app.use('/api/messages', require('./routes/messages'));
    app.use('/api/communities', require('./routes/communities'));
    app.use('/api/questions', require('./routes/questions'));
    app.use('/api/status', require('./routes/status'));
    app.use('/api', threadsRoutes);

    // Internal
    app.use('/api/moderation', requireAuth, moderationRoutes);
    app.use('/api/reports', requireAuth, require('./routes/reports'));
    app.use('/api/memos', requireAuth, require('./routes/memos'));

    // =====================================================================
    // SPA STATIC CLIENT (OPTIONAL)
    // =====================================================================
    const clientBuildPath = path.join(__dirname, 'client', 'build');

    if (fs.existsSync(clientBuildPath)) {
      console.log('✅ Serving MyTop6 client from:', clientBuildPath);

      app.use(express.static(clientBuildPath));

      app.get(/^\/(?!api\/).*/, (req, res) => {
        res.sendFile(path.join(clientBuildPath, 'index.html'));
      });
    } else {
      console.log('ℹ️ No client build found:', clientBuildPath);
    }

    // Start server
    app.listen(PORT, HOST, () => {
      console.log(`🚀 Server running on http://${HOST}:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ MongoDB error:', err);
  });

module.exports = { app };