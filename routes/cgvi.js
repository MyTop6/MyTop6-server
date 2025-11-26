// routes/cgvi.js (CommonJS, preserves { ok, count, data })
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const router = express.Router();
const filePath = path.join(process.cwd(), 'server', 'data', 'cgvi.json');

function loadMaster() {
  const raw = fs.readFileSync(filePath, 'utf8');
  const arr = JSON.parse(raw);
  return arr.map(x => ({ ...x, code: String(x.code).toUpperCase() }));
}
let MASTER = loadMaster();

function computeETag(payload) {
  return crypto.createHash('sha1').update(payload).digest('hex');
}

// GET /api/cgvi  -> { ok, count, data: [...] }
router.get('/', (req, res) => {
  const payload = JSON.stringify(MASTER);
  const etag = computeETag(payload);

  res.set('ETag', etag);
  res.set('Cache-Control', 'public, max-age=300');

  if (req.headers['if-none-match'] === etag) {
    return res.status(304).end();
  }
  res.json({ ok: true, count: MASTER.length, data: MASTER });
});

// GET /api/cgvi/:code -> single item or 404
router.get('/:code', (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  const item = MASTER.find(x => x.code === code);
  if (!item) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, data: item });
});

// Optional: hot-reload without restarting (protect in prod)
// router.post('/reload', (_req, res) => {
//   MASTER = loadMaster();
//   res.json({ ok: true, reloaded: MASTER.length });
// });

module.exports = router;