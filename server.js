/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║          PARAMOUNT E-STORE — Production Server                      ║
 * ║          Built for 30+ years of reliable operation                  ║
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║  Start:   node server.js                                            ║
 * ║  Port:    3000  (override: PORT=8080 node server.js)               ║
 * ║  Zero dependencies — pure Node.js built-ins only                   ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * WHAT THIS SERVER DOES
 * ─────────────────────
 *  1. FILE SERVER       — serves every .html/.js/.css/.png etc with
 *                         gzip compression, ETag caching, and MIME types.
 *                         No separate web server (Apache/Nginx) needed.
 *
 *  2. KEY INJECTION     — writes API keys into the JS files so ALL
 *                         visitors on ALL devices get live keys permanently.
 *
 *  3. DATA PERSISTENCE  — saves products, categories, orders, shipments,
 *                         customers, reviews, wholesale data and settings
 *                         to JSON files on disk. localStorage can be cleared
 *                         by browsers; the server files never disappear.
 *
 *  4. AUTO BACKUPS      — every 24 hours a timestamped snapshot of all
 *                         data is created. Keeps the last 30 backups.
 *                         Also backs up before any import/remart operation.
 *
 *  5. ANALYTICS         — logs page views, orders, and revenue daily.
 *                         No third parties — your data stays on your server.
 *
 *  6. RATE LIMITING     — protects against spam and brute-force attacks.
 *
 *  7. HEALTH ENDPOINT   — /api/health returns uptime, version, data stats.
 *                         Use this for monitoring at any time in the future.
 *
 *  8. SELF-HEALING      — if a JSON file becomes corrupted it is detected
 *                         and automatically remartd from the latest backup.
 *
 *  9. EXPORT / IMPORT   — full data export and import via admin panel.
 *                         One JSON file containing everything.
 *
 * 10. GRACEFUL SHUTDOWN — on SIGTERM/SIGINT, creates a final backup and
 *                         flushes all pending log writes before exiting.
 *                         Safe with PM2, systemd, or any process manager.
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const zlib   = require('zlib');
const url    = require('url');

// ── Express (with graceful fallback message if not installed) ─
let express, compression, corsMiddleware;
try {
  express     = require('express');
  compression = require('compression');
  corsMiddleware = require('cors');
} catch(e) {
  console.error('\n❌  Missing dependencies. Run:  npm install\n');
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════

const ROOT = __dirname; // declared here so loadDotEnv can use it

// ── .env reader (no external packages needed) ──────────────
(function loadDotEnv() {
  const envFile = path.join(ROOT, '.env');
  if (!fs.existsSync(envFile)) return;
  try {
    fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eq = trimmed.indexOf('=');
      if (eq === -1) return;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (key && val && !process.env[key]) process.env[key] = val;
    });
  } catch (e) { /* .env parse errors are non-fatal */ }
})();

const VERSION    = '4.5.0';
const PORT       = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR   = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const LOGS_DIR   = path.join(ROOT, 'logs');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const BACKUP_KEEP = parseInt(process.env.BACKUP_KEEP || '30', 10);
const BACKUP_INTERVAL_MS = (parseFloat(process.env.BACKUP_INTERVAL_HOURS || '24')) * 3600000;

const FILES = {
  keys:       path.join(DATA_DIR, 'keys.json'),
  products:   path.join(DATA_DIR, 'products.json'),
  categories: path.join(DATA_DIR, 'categories.json'),
  orders:     path.join(DATA_DIR, 'orders.json'),
  shipments:  path.join(DATA_DIR, 'shipments.json'),
  customers:  path.join(DATA_DIR, 'customers.json'),
  reviews:    path.join(DATA_DIR, 'reviews.json'),
  settings:   path.join(DATA_DIR, 'settings.json'),
  analytics:  path.join(DATA_DIR, 'analytics.json'),
  wholesale:  path.join(DATA_DIR, 'wholesale.json'),
  promoCodes: path.join(DATA_DIR, 'promo-codes.json'),
};

const SRC = {
  store:  path.join(ROOT, 'js', 'store.js'),
  shared: path.join(ROOT, 'js', 'shared.js'),
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.otf':  'font/otf',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.pdf':  'application/pdf',
  '.txt':  'text/plain; charset=utf-8',
  '.xml':  'application/xml; charset=utf-8',
  '.map':  'application/json',
  '.md':   'text/plain; charset=utf-8',
};


const SECURITY_HEADERS = {
  // Prevent clickjacking
  'X-Frame-Options': 'SAMEORIGIN',
  // Prevent MIME sniffing
  'X-Content-Type-Options': 'nosniff',
  // XSS protection (legacy browsers)
  'X-XSS-Protection': '1; mode=block',
  // Referrer policy — don't leak full URL to third parties
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // Restrict powerful browser features
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=(self)',
  // HSTS — enforce HTTPS for 1 year (only effective when served over HTTPS)
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  // Content Security Policy — tight but compatible with Paystack/Flutterwave/PayPal/Google
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://checkout.flutterwave.com https://cdn.jsdelivr.net https://unpkg.com https://cdn.emailjs.com https://accounts.google.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "frame-src https://checkout.flutterwave.com https://www.google.com https://accounts.google.com",
    "connect-src 'self' https://api.flutterwave.com https://cdn.jsdelivr.net https://open.er-api.com https://api.exchangerate-api.com https://api.emailjs.com https://oauth2.googleapis.com https://nominatim.openstreetmap.org",
    "worker-src 'self'",
    "manifest-src 'self'",
  ].join('; '),
};

const RATE_LIMITS = {
  '/api/inject-keys':  { max: 60,  window: 60000 },
  '/api/admin-login':  { max: 10,  window: 300000 }, // 10 attempts per 5 min
  '/api/admin-verify': { max: 10,  window: 300000 }, // 10 attempts per 5 min
  '/api/forgot-password': { max: 5, window: 3600000 }, // 5 per hour
  '/api/order':       { max: 120, window: 60000 },
  '/api/orders':      { max: 120, window: 60000 },
  default:            { max: 300, window: 60000 },
};

// Directories that must never be served to the browser
const BLOCKED_PATHS = [DATA_DIR, LOGS_DIR, path.join(ROOT, 'server.js')];

const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || null; // null = same-origin only
// Build CORS headers dynamically — only set Allow-Origin if explicitly configured
function getCORS(req) {
  const origin = req && req.headers && req.headers['origin'];
  const allowed = ALLOWED_ORIGIN || origin; // reflect origin only if no explicit config
  return {
    'Access-Control-Allow-Origin':  allowed || 'null',
    'Access-Control-Allow-Headers': 'Content-Type, X-PDS-Admin, X-PDS-Session',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
  };
}
// Static CORS for places that don't have req available
const CORS = {
  'Access-Control-Allow-Origin':  ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-PDS-Admin, X-PDS-Session',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

// ═══════════════════════════════════════════════════════════
//  STARTUP
// ═══════════════════════════════════════════════════════════

function ensureDirs() {
  const IMAGES_PRODUCTS_DIR = path.join(ROOT, 'images', 'products');
  [DATA_DIR, LOGS_DIR, BACKUP_DIR, IMAGES_PRODUCTS_DIR].forEach(d => {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
    }
  });
}

function ensureFile(p, def) {
  if (!fs.existsSync(p)) fs.writeFileSync(p, def, 'utf8');
}

function ensureDataFiles() {
  ensureFile(FILES.keys,       '{}');
  ensureFile(FILES.products,   '[]');
  ensureFile(FILES.categories, '[]');
  ensureFile(FILES.orders,     '[]');
  ensureFile(FILES.shipments,  '[]');
  ensureFile(FILES.customers,  '[]');
  ensureFile(FILES.reviews,    '{}');
  ensureFile(FILES.wholesale,  '{}');
  ensureFile(FILES.analytics,  '{}');
  ensureFile(FILES.settings,   JSON.stringify({
    siteName:  'Paramount E-mart',
    location:  'Uyo, Akwa Ibom State, Nigeria',
    currency:  'NGN',
    version:   VERSION,
    createdAt: new Date().toISOString(),
  }, null, 2));
  // Patch version on every start so it stays current
  try {
    const s = readData(FILES.settings, {});
    if (s.version !== VERSION) { s.version = VERSION; writeData(FILES.settings, s); }
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════════
//  LOGGING
// ═══════════════════════════════════════════════════════════

const _logBuf = [];
let   _logTimer = null;

function log(level, msg, meta) {
  const ts   = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase().padEnd(5)}] ${msg}${meta ? ' ' + JSON.stringify(meta) : ''}`;
  if (level === 'error') console.error(line);
  else                   console.log(line);
  _logBuf.push(line);
  if (!_logTimer) _logTimer = setTimeout(flushLogs, 2000);
}

function flushLogs() {
  _logTimer = null;
  if (!_logBuf.length) return;
  const date = new Date().toISOString().split('T')[0];
  const file = path.join(LOGS_DIR, `${date}.log`);
  const text = _logBuf.splice(0).join('\n') + '\n';
  fs.appendFile(file, text, () => {});
}

// ═══════════════════════════════════════════════════════════
//  DATA ACCESS — atomic writes + self-healing
// ═══════════════════════════════════════════════════════════

function readData(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    log('error', `Read failed ${path.basename(file)}: ${e.message} — trying backup`);
    const remartd = remartFromBackup(file);
    if (remartd !== null) return remartd;
    const def = fallback !== undefined ? fallback : (file.endsWith('.json') ? {} : []);
    writeData(file, def);
    return def;
  }
}

// ── Per-file write queue — prevents concurrent write corruption ──
const _writeQueues = new Map();

function writeData(file, data) {
  // Serialise all writes to the same file through a promise chain
  const prev = _writeQueues.get(file) || Promise.resolve();
  const next  = prev.then(() => _doWrite(file, data));
  // Keep only the latest pending write in the queue (don't pile up)
  _writeQueues.set(file, next.catch(() => {}));
  return next;
}

function _doWrite(file, data) {
  try {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file); // atomic rename — safe on crash
    return true;
  } catch (e) {
    log('error', `Write failed ${path.basename(file)}: ${e.message}`);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════
//  BACKUPS
// ═══════════════════════════════════════════════════════════

function createBackup() {
  const ts  = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_');
  const dir = path.join(BACKUP_DIR, ts);
  fs.mkdirSync(dir, { recursive: true });

  let n = 0;
  Object.entries(FILES).forEach(([name, src]) => {
    if (name === 'analytics') return;
    try {
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(dir, path.basename(src)));
        n++;
      }
    } catch (e) {
      log('error', `Backup copy failed for ${name}: ${e.message}`);
    }
  });

  log('info', `Backup created: ${ts} (${n} files)`);
  pruneBackups(30);
  return ts;
}

function pruneBackups(keep) {
  try {
    const k = keep || BACKUP_KEEP;
    const dirs = fs.readdirSync(BACKUP_DIR)
      .filter(d => fs.statSync(path.join(BACKUP_DIR, d)).isDirectory())
      .sort();
    while (dirs.length > k) {
      fs.rmSync(path.join(BACKUP_DIR, dirs.shift()), { recursive: true, force: true });
    }
  } catch (e) {
    log('error', `Prune failed: ${e.message}`);
  }
}

function remartFromBackup(file) {
  try {
    const fname = path.basename(file);
    const dirs  = fs.readdirSync(BACKUP_DIR)
      .filter(d => fs.statSync(path.join(BACKUP_DIR, d)).isDirectory())
      .sort().reverse();
    for (const d of dirs) {
      const src = path.join(BACKUP_DIR, d, fname);
      if (fs.existsSync(src)) {
        const data = JSON.parse(fs.readFileSync(src, 'utf8'));
        writeData(file, data);
        log('info', `Remartd ${fname} from ${d}`);
        return data;
      }
    }
  } catch (e) {
    log('error', `Remart failed: ${e.message}`);
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
//  RATE LIMITING
// ═══════════════════════════════════════════════════════════

const _buckets = new Map();

function rateCheck(ip, endpoint) {
  const rule   = RATE_LIMITS[endpoint] || RATE_LIMITS.default;
  const key    = ip + ':' + endpoint;
  const now    = Date.now();
  const bucket = _buckets.get(key) || { n: 0, reset: now + rule.window };
  if (now > bucket.reset) { bucket.n = 0; bucket.reset = now + rule.window; }
  bucket.n++;
  _buckets.set(key, bucket);
  return bucket.n <= rule.max;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of _buckets.entries()) {
    if (now > b.reset) _buckets.delete(k);
  }
}, 300000);

// ═══════════════════════════════════════════════════════════
//  HTTP HELPERS
// ═══════════════════════════════════════════════════════════

function json(res, status, data) {
  // Works with both raw http.ServerResponse and Express Response
  if (typeof res.status === 'function') {
    return res.status(status).json(data);
  }
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS });
  res.end(body);
}

function readBody(req) {
  // If express.json() already parsed the body, use it directly
  if (req.body !== undefined) return Promise.resolve(req.body);
  // Fallback: stream and parse manually (handles multipart and raw requests)
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 20 * 1024 * 1024) { req.destroy(); return reject(new Error('Body too large')); }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const getIP  = r => ((r.headers['x-forwarded-for'] || '').split(',')[0].trim() || r.socket.remoteAddress || 'unknown');

// ── Secure Admin Session Store ───────────────────────────────
// IP binding disabled — works on Render, Railway, and all proxied platforms.
// Sessions use rolling expiry: each valid request extends the 8-hour window.
const _sessions = new Map(); // token -> { expires }
const SESSION_TTL_MS = 8 * 3600 * 1000; // 8 hours rolling

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  _sessions.set(token, { expires: Date.now() + SESSION_TTL_MS });
  return token;
}

function validateSession(token) {
  const sess = _sessions.get(token);
  if (!sess) return false;
  if (Date.now() > sess.expires) { _sessions.delete(token); return false; }
  sess.expires = Date.now() + SESSION_TTL_MS; // rolling window
  return true;
}

function destroySession(token) { _sessions.delete(token); }

setInterval(() => {
  const now = Date.now();
  for (const [t, s] of _sessions.entries()) { if (now > s.expires) _sessions.delete(t); }
}, 3600000);

const isAdmin = r => {
  const token = r.headers['x-pds-session'];
  if (!token) return false;
  return validateSession(token);
};

// ── Password Reset Token Store ───────────────────────────────
const _resetTokens = new Map();
const RESET_TTL_MS = 30 * 60 * 1000;

function createResetToken() {
  const token = crypto.randomBytes(24).toString('hex');
  _resetTokens.set(token, { expires: Date.now() + RESET_TTL_MS });
  return token;
}

function validateResetToken(token) {
  const entry = _resetTokens.get(token);
  if (!entry) return false;
  if (Date.now() > entry.expires) { _resetTokens.delete(token); return false; }
  return true;
}

function consumeResetToken(token) {
  const valid = validateResetToken(token);
  if (valid) _resetTokens.delete(token);
  return valid;
}

// ═══════════════════════════════════════════════════════════
//  STATIC FILE SERVER
// ═══════════════════════════════════════════════════════════

function serveFile(req, res, filePath) {
  // With Express, use sendFile for cleaner handling
  if (typeof res.sendFile === 'function') {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      const idx = path.join(ROOT, 'index.html');
      if (fs.existsSync(idx)) return res.sendFile(idx);
      return res.status(404).send('Not Found');
    }
    return res.sendFile(filePath);
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA fallback — serve index.html for any unknown path
      const idx = path.join(ROOT, 'index.html');
      return fs.existsSync(idx) ? serveFile(req, res, idx) : (res.writeHead(404), res.end('Not Found'));
    }

    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    const etag = '"' + stat.mtime.getTime().toString(16) + '-' + stat.size.toString(16) + '"';

    if (req.headers['if-none-match'] === etag) { res.writeHead(304); return res.end(); }

    const headers = { 'Content-Type': mime, 'ETag': etag, 'Last-Modified': stat.mtime.toUTCString(), 'Vary': 'Accept-Encoding', ...CORS, ...SECURITY_HEADERS };

    if (['.html'].includes(ext)) {
      headers['Cache-Control'] = 'no-cache, must-revalidate';
    } else if (['.js', '.css'].includes(ext)) {
      headers['Cache-Control'] = 'public, max-age=3600';
    } else if (['.png','.jpg','.jpeg','.webp','.gif','.svg','.ico','.woff','.woff2'].includes(ext)) {
      headers['Cache-Control'] = 'public, max-age=2592000';
    }

    const ae = req.headers['accept-encoding'] || '';
    if (ae.includes('gzip') && ['.html','.css','.js','.json','.svg','.xml'].includes(ext)) {
      headers['Content-Encoding'] = 'gzip';
      res.writeHead(200, headers);
      fs.createReadStream(filePath).pipe(zlib.createGzip()).pipe(res);
    } else {
      headers['Content-Length'] = stat.size;
      res.writeHead(200, headers);
      fs.createReadStream(filePath).pipe(res);
    }
  });
}

// ═══════════════════════════════════════════════════════════
//  API KEY INJECTION
// ═══════════════════════════════════════════════════════════

function patch(file, pattern, replacement) {
  try {
    const src = fs.readFileSync(file, 'utf8');
    const out = src.replace(pattern, replacement);
    if (out !== src) {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, out, 'utf8');
      fs.renameSync(tmp, file);
    }
    return true;
  } catch (e) {
    log('error', `Patch failed ${path.basename(file)}: ${e.message}`);
    return false;
  }
}

const PATCHES = {
  paystack:    k => true, // Paystack removed — no-op
  flutterwave: k => patch(SRC.store,  /localStorage\.getItem\('pes_flutterwave_key'\)\s*\|\|\s*'[^']*'/, `localStorage.getItem('pes_flutterwave_key') || '${k}'`),
  paypal:      k => patch(SRC.store,  /localStorage\.getItem\('pes_paypal_client_id'\)\s*\|\|\s*'[^']*'/, `localStorage.getItem('pes_paypal_client_id') || '${k}'`),
  gsheet:      k => patch(SRC.shared, /const GOOGLE_SCRIPT_URL\s*=\s*localStorage\.getItem\('pes_gsheet_url'\)\s*\|\|\s*'[^']*'/, `const GOOGLE_SCRIPT_URL = localStorage.getItem('pes_gsheet_url') || '${k}'`),
  maps:        k => patch(SRC.shared, /var KEY\s*=\s*'[^']*';\s*\/\/ set your Maps Embed API key here/, `var KEY = '${k}';  // set your Maps Embed API key here`),
};

// ═══════════════════════════════════════════════════════════
//  ANALYTICS
// ═══════════════════════════════════════════════════════════

function track(type, meta) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const a     = readData(FILES.analytics, {});
    if (!a[today]) a[today] = { pageviews: 0, orders: 0, revenue: 0, events: [] };
    const d = a[today];
    if (type === 'pageview') d.pageviews++;
    if (type === 'order')    { d.orders++; d.revenue += (meta && meta.total) || 0; }
    d.events.push({ type, ts: Date.now(), ...(meta || {}) });
    if (d.events.length > 100) d.events = d.events.slice(-100);
    const keys = Object.keys(a).sort();
    if (keys.length > 365) delete a[keys[0]];
    writeData(FILES.analytics, a);
  } catch (e) { /* analytics must never crash the server */ }
}


// ═══════════════════════════════════════════════════════════
//  INPUT SANITISATION
// ═══════════════════════════════════════════════════════════

/** Strip characters that could cause XSS in JSON→HTML contexts */
function sanitiseStr(v, maxLen) {
  if (typeof v !== 'string') return v;
  return v.replace(/[<>"'`]/g, c => ({'<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;'}[c]))
          .slice(0, maxLen || 2000);
}

/** Recursively sanitise all string fields in an object/array */
function sanitiseDeep(obj, maxLen) {
  if (Array.isArray(obj))       return obj.map(v => sanitiseDeep(v, maxLen));
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = sanitiseDeep(v, maxLen);
    return out;
  }
  if (typeof obj === 'string')  return sanitiseStr(obj, maxLen);
  return obj;
}

/** Validate and sanitise an order body */
function sanitiseOrder(body) {
  return {
    ...sanitiseDeep(body, 500),
    total:    typeof body.total    === 'number' ? body.total    : 0,
    rawTotal: typeof body.rawTotal === 'number' ? body.rawTotal : 0,
    items:    Array.isArray(body.items) ? body.items.map(i => ({
      ...sanitiseDeep(i, 200),
      price: typeof i.price === 'number' ? i.price : 0,
      qty:   typeof i.qty   === 'number' ? Math.min(Math.max(1, Math.floor(i.qty)), 9999) : 1,
    })) : [],
  };
}

// ═══════════════════════════════════════════════════════════
//  ROUTE HANDLERS
// ═══════════════════════════════════════════════════════════

function handleHealth(req, res) {
  const orders    = readData(FILES.orders, []);
  const uptime    = process.uptime();
  const revenue   = orders.filter(o => o.status === 'paid').reduce((a, o) => a + (o.total || 0), 0);
  json(res, 200, {
    ok: true, version: VERSION,
    uptime: Math.floor(uptime),
    uptimeHuman: Math.floor(uptime / 3600) + 'h ' + Math.floor((uptime % 3600) / 60) + 'm',
    data: {
      products:   readData(FILES.products,  []).length,
      categories: readData(FILES.categories,[]).length,
      orders:     orders.length,
      shipments:  readData(FILES.shipments, []).length,
      customers:  readData(FILES.customers, []).length,
      revenue,
    },
    node: process.version,
    ts:   new Date().toISOString(),
  });
}

function handleGetKeys(req, res) {
  const k = readData(FILES.keys, {});
  const m = v => (!v || v.length < 10) ? (v || '') : v.slice(0, 4) + '••••••••' + v.slice(-4);
  json(res, 200, {
    ok:   true,
    keys: {
      paystackKey: m(k.paystackKey), paystackMode: k.paystackMode || '',
      flutterwaveKey: m(k.flutterwaveKey), flutterwaveCurrency: k.flutterwaveCurrency || '',
      paypalClientId: m(k.paypalClientId), paypalCurrency: k.paypalCurrency || '',
      gsheetUrl: k.gsheetUrl || '', gsheetCustomers: k.gsheetCustomers || '', gsheetOrders: k.gsheetOrders || '',
      mapsKey: m(k.mapsKey),
      ejsServiceId: k.ejsServiceId || '', ejsTemplateId: k.ejsTemplateId || '', ejsPublicKey: m(k.ejsPublicKey),
      deliveryEmail: k.deliveryEmail || '', businessEmail: k.businessEmail || '',
    },
    seed: {
      // Paystack removed
      pes_flutterwave_key: k.flutterwaveKey || '', pes_flutterwave_currency: k.flutterwaveCurrency || 'NGN',
      pes_paypal_client_id: k.paypalClientId || '', pes_paypal_currency: k.paypalCurrency || 'USD',
      pes_gsheet_url: k.gsheetUrl || '', pes_gsheet_customers: k.gsheetCustomers || '', pes_gsheet_orders: k.gsheetOrders || '',
      pes_maps_key: k.mapsKey || '',
      pes_emailjs_service: k.ejsServiceId || '', pes_emailjs_template: k.ejsTemplateId || '', pes_emailjs_key: k.ejsPublicKey || '',
      pes_delivery_email: k.deliveryEmail || '', pes_business_email: k.businessEmail || '',
    },
  });
}

async function handleAdminPanel(req, res) {
  // Serve admin.html (canonical) with GOOGLE_CLIENT_ID injected.
  // Falls back to pds-control-panel.html for backwards compatibility.
  const adminPath   = path.join(ROOT, 'admin.html');
  const legacyPath  = path.join(ROOT, 'pds-control-panel.html');
  const filePath    = fs.existsSync(adminPath) ? adminPath : legacyPath;
  try {
    let html = fs.readFileSync(filePath, 'utf8');
    const gcid = process.env.GOOGLE_CLIENT_ID || '';
    // Inject the client ID as a JS variable
    html = html.replace(
      '</head>',
      `<script>window.__GOOGLE_CLIENT_ID__ = ${JSON.stringify(gcid)};</script>
</head>`
    );
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...CORS, ...SECURITY_HEADERS });
    res.end(html);
  } catch(e) {
    json(res, 500, { ok: false, error: 'Could not serve admin panel' });
  }
}

async function handleInjectKeys(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  const k = readData(FILES.keys, {});
  const patched = [];
  if (body.paystackKey    && body.paystackKey.startsWith('pk_'))       { PATCHES.paystack(body.paystackKey);       k.paystackKey = body.paystackKey;       k.paystackMode = body.paystackMode || 'live';       patched.push('Paystack'); }
  if (body.flutterwaveKey && body.flutterwaveKey.startsWith('FLWPUBK')){ PATCHES.flutterwave(body.flutterwaveKey); k.flutterwaveKey = body.flutterwaveKey; k.flutterwaveCurrency = body.flutterwaveCurrency || 'NGN'; patched.push('Flutterwave'); }
  if (body.paypalClientId)                                              { PATCHES.paypal(body.paypalClientId);      k.paypalClientId = body.paypalClientId; k.paypalCurrency = body.paypalCurrency || 'USD';     patched.push('PayPal'); }
  if (body.gsheetUrl && body.gsheetUrl.includes('script.google.com'))  { PATCHES.gsheet(body.gsheetUrl);           k.gsheetUrl = body.gsheetUrl;           k.gsheetCustomers = body.gsheetCustomers || '';     k.gsheetOrders = body.gsheetOrders || ''; patched.push('Google Sheets'); }
  if (body.mapsKey   && body.mapsKey.startsWith('AIza'))               { PATCHES.maps(body.mapsKey);               k.mapsKey = body.mapsKey;               patched.push('Maps'); }
  if (body.ejsServiceId)  { k.ejsServiceId  = body.ejsServiceId;  patched.push('EmailJS-Service'); }
  if (body.ejsTemplateId) { k.ejsTemplateId = body.ejsTemplateId; patched.push('EmailJS-Template'); }
  if (body.ejsPublicKey)  { k.ejsPublicKey  = body.ejsPublicKey;  patched.push('EmailJS-Key'); }
  if (body.deliveryEmail) { k.deliveryEmail = body.deliveryEmail; }
  if (body.businessEmail) { k.businessEmail = body.businessEmail; }
  writeData(FILES.keys, k);
  log('info', 'Keys injected: ' + patched.join(', '));
  json(res, 200, { ok: true, patched });
}

// ── Products ──────────────────────────────────────────────

// Default products/categories — seeded if data files are empty
const DEFAULT_PRODUCTS_SEED = [{"id": 13, "name": "1.5HP Inverter Split AC", "category": "Air Conditioners", "price": 320000, "image": "images/logo.png", "images": ["images/logo.png"], "badge": "BESTSELLER", "description": "1.5HP inverter split air conditioner with R32 refrigerant, 5-star energy rating, auto-restart, sleep mode, self-cleaning, anti-bacterial filter and 4-way air distribution.", "stock": "in-stock", "stockQty": 24, "featured": true}, {"id": 5, "name": "4-Burner Gas Cooker with Oven", "category": "Home Appliances", "price": 185000, "image": "images/logo.png", "images": ["images/logo.png"], "badge": null, "description": "Stainless steel 4-burner gas cooker with full glass oven, auto-ignition, flame failure device, rotisserie grill and tempered glass lid. 60cm freestanding design.", "stock": "in-stock", "stockQty": 6, "featured": false}, {"id": 1, "name": "55\" 4K UHD Smart TV", "category": "Electronics", "price": 420000, "image": "images/logo.png", "images": ["images/logo.png"], "badge": "BESTSELLER", "description": "55-inch 4K Ultra HD Smart TV with HDR10, built-in Wi-Fi, Netflix & YouTube access, 3 HDMI ports and Dolby Audio surround sound. Energy-saving LED backlit display.", "stock": "in-stock", "stockQty": 16, "featured": true}, {"id": 15, "name": "2.5KVA Pure Sine Wave Inverter", "category": "Generators & Power", "price": 195000, "image": "images/logo.png", "images": ["images/logo.png"], "badge": null, "description": "2500VA pure sine wave inverter with 24V input, built-in MPPT solar charge controller, USB charging port, LCD display and battery protection system.", "stock": "in-stock", "stockQty": 38, "featured": false}, {"id": 14, "name": "5KVA Silent Generator", "category": "Generators & Power", "price": 620000, "image": "images/logo.png", "images": ["images/logo.png"], "badge": "PREMIUM", "description": "5KVA soundproof diesel generator with electric start, ATS compatibility, 12-hour run time on full tank, AVR voltage regulation and 4 outlets. Industrial-grade build.", "stock": "in-stock", "stockQty": 31, "featured": true}, {"id": 18, "name": "CCTV 8-Camera Security Kit", "category": "Security Systems", "price": 280000, "image": "images/logo.png", "images": ["images/logo.png"], "badge": "HOT", "description": "Complete 8-camera 5MP CCTV system with 2TB NVR, night vision up to 40m, weatherproof cameras, motion detection alerts and remote viewing via mobile app.", "stock": "in-stock", "stockQty": 21, "featured": false}, {"id": 16, "name": "DC Ceiling Fan with LED Light", "category": "Fans & Cooling", "price": 85000, "image": "images/logo.png", "images": ["images/logo.png"], "badge": "NEW", "description": "56-inch DC motor ceiling fan with 18W integrated LED light, remote control, 6-speed settings, silent operation, reversible motor and energy-saving technology.", "stock": "in-stock", "stockQty": 7, "featured": false}, {"id": 4, "name": "Front Load Washing Machine 8kg", "category": "Home Appliances", "price": 430000, "image": "images/logo.png", "images": ["images/logo.png"], "badge": "NEW", "description": "8kg front-loading washing machine with 15 wash programs, quick-wash 30-min cycle, steam clean function, and anti-vibration technology. Quiet and energy efficient.", "stock": "in-stock", "stockQty": 37, "featured": false}, {"id": 9, "name": "HP LaserJet Pro Printer", "category": "Computers & Laptops", "price": 145000, "image": "images/logo.png", "images": ["images/logo.png"], "badge": null, "description": "Monochrome laser printer with wireless printing, automatic two-sided printing, 35-page ADF, mobile printing via HP Smart app. Up to 30ppm print speed.", "stock": "in-stock", "stockQty": 34, "featured": false}, {"id": 12, "name": "High-Speed Blender 2L", "category": "Kitchen Appliances", "price": 55000, "image": "images/logo.png", "images": ["images/logo.png"], "badge": "HOT", "description": "Professional 2-litre blender with 1500W motor, 6-blade stainless steel assembly, 5-speed settings + pulse, BPA-free Tritan jar, and self-cleaning function.", "stock": "in-stock", "stockQty": 17, "featured": false}, {"id": 6, "name": "iPhone 15 Pro Max 256GB", "category": "Phones & Tablets", "price": 1150000, "image": "images/logo.png", "images": ["images/logo.png"], "badge": "PREMIUM", "description": "Apple iPhone 15 Pro Max with A17 Pro chip, 48MP triple camera system with 5x optical zoom, titanium design, Action Button, USB-C and up to 29 hours video playback.", "stock": "in-stock", "stockQty": 13, "featured": true}, {"id": 17, "name": "L-Shape Sectional Sofa", "category": "Furniture & Decor", "price": 480000, "image": "images/logo.png", "images": ["images/logo.png"], "badge": null, "description": "Modern L-shaped sectional sofa in premium leatherette upholstery, high-density foam cushions, solid hardwood frame and 6-seater capacity. Available in black and grey.", "stock": "in-stock", "stockQty": 14, "featured": false}, {"id": 8, "name": "MacBook Air M2 13\" 256GB", "category": "Computers & Laptops", "price": 1250000, "image": "images/logo.png", "images": ["images/logo.png"], "badge": "BESTSELLER", "description": "Apple MacBook Air with M2 chip, 8GB RAM, 256GB SSD, 13.6-inch Liquid Retina display, MagSafe charging, up to 18-hour battery life and fanless silent design.", "stock": "in-stock", "stockQty": 27, "featured": true}, {"id": 11, "name": "Microwave Oven 30L", "category": "Kitchen Appliances", "price": 98000, "image": "images/logo.png", "images": ["images/logo.png"], "badge": null, "description": "30-litre microwave with grill function, convection cooking, 8 auto-cook menus, child safety lock, LED interior light and stainless steel cavity for easy cleaning.", "stock": "in-stock", "stockQty": 10, "featured": false}, {"id": 7, "name": "Samsung Galaxy Tab S9", "category": "Phones & Tablets", "price": 590000, "image": "images/logo.png", "images": ["images/logo.png"], "badge": null, "description": "11-inch AMOLED display tablet with Snapdragon 8 Gen 2, 128GB storage, IP68 water resistance, S Pen included, DeX mode for desktop experience and 8000mAh battery.", "stock": "limited", "stockQty": 5, "featured": false}, {"id": 3, "name": "Side-by-Side Refrigerator 600L", "category": "Home Appliances", "price": 890000, "image": "images/logo.png", "images": ["images/logo.png"], "badge": "PREMIUM", "description": "600-litre side-by-side refrigerator with water & ice dispenser, multi-flow cooling, inverter compressor, frost-free technology and LED interior lighting. A+ energy rating.", "stock": "in-stock", "stockQty": 30, "featured": true}, {"id": 10, "name": "Stand Mixer 6.5L Professional", "category": "Kitchen Appliances", "price": 215000, "image": "images/logo.png", "images": ["images/logo.png"], "badge": "NEW", "description": "6.5-litre professional stand mixer with 10-speed settings, stainless steel bowl, dough hook, flat beater and wire whip attachments. 800W powerful motor with planetary mixing.", "stock": "in-stock", "stockQty": 41, "featured": false}, {"id": 2, "name": "Wireless Bluetooth Speaker", "category": "Electronics", "price": 38500, "image": "images/logo.png", "images": ["images/logo.png"], "badge": "HOT", "description": "360\u00b0 surround sound portable speaker with 24-hour battery life, IPX7 waterproof rating, dual pairing mode and deep bass. Perfect for indoor and outdoor use.", "stock": "in-stock", "stockQty": 23, "featured": false}];
const DEFAULT_CATEGORIES_SEED = [{"id": 1, "name": "Accessories", "image": "images/logo.png", "description": "Cables, chargers & gadget accessories"}, {"id": 2, "name": "Adult Items", "image": "images/logo.png", "description": "Age-restricted products \u2014 18+ only", "ageRestricted": true}, {"id": 3, "name": "Air Conditioners", "image": "images/logo.png", "description": "Split units, standing & portable ACs"}, {"id": 4, "name": "Baby & Kids", "image": "images/logo.png", "description": "Baby gear, toys & nursery items"}, {"id": 5, "name": "Computers & Laptops", "image": "images/logo.png", "description": "Laptops, desktops & peripherals"}, {"id": 6, "name": "Electronics", "image": "images/logo.png", "description": "TVs, audio, cameras & more"}, {"id": 7, "name": "Fans & Cooling", "image": "images/logo.png", "description": "Ceiling fans, standing & desk fans"}, {"id": 8, "name": "Furniture & Decor", "image": "images/logo.png", "description": "Sofas, beds & home d\u00e9cor"}, {"id": 9, "name": "Generators & Power", "image": "images/logo.png", "description": "Generators, inverters & solar"}, {"id": 10, "name": "Home Appliances", "image": "images/logo.png", "description": "Fridges, washing machines & cookers"}, {"id": 11, "name": "Kitchen Appliances", "image": "images/logo.png", "description": "Blenders, microwaves & ovens"}, {"id": 12, "name": "Lighting", "image": "images/logo.png", "description": "Bulbs, lamps & outdoor lighting"}, {"id": 13, "name": "Personal Care", "image": "images/logo.png", "description": "Grooming, skincare & health devices"}, {"id": 14, "name": "Phones & Tablets", "image": "images/logo.png", "description": "Smartphones, tablets & accessories"}, {"id": 15, "name": "Security Systems", "image": "images/logo.png", "description": "CCTV, alarms & smart locks"}, {"id": 16, "name": "Sports & Fitness", "image": "images/logo.png", "description": "Exercise equipment & accessories"}];

function handleGetProducts(req, res) {
  let products = readData(FILES.products, []);
  if (!Array.isArray(products) || products.length === 0) {
    // Seed from defaults and save so future reads are fast
    products = DEFAULT_PRODUCTS_SEED;
    writeData(FILES.products, products);
    log('info', 'products.json seeded from defaults (' + products.length + ' products)');
  }
  json(res, 200, { ok: true, products });
}

async function handleSaveProducts(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  const products = Array.isArray(body.products) ? body.products : (Array.isArray(body) ? body : []);
  writeData(FILES.products, products);
  json(res, 200, { ok: true, count: products.length });
}

// ── Categories ─────────────────────────────────────────────

function handleGetCategories(req, res) {
  let categories = readData(FILES.categories, []);
  if (!Array.isArray(categories) || categories.length === 0) {
    categories = DEFAULT_CATEGORIES_SEED;
    writeData(FILES.categories, categories);
    log('info', 'categories.json seeded from defaults (' + categories.length + ' categories)');
  }
  json(res, 200, { ok: true, categories });
}

async function handleSaveCategories(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  const cats = Array.isArray(body.categories) ? body.categories : (Array.isArray(body) ? body : []);
  writeData(FILES.categories, cats);
  json(res, 200, { ok: true, count: cats.length });
}

// ── Orders ─────────────────────────────────────────────────

function handleGetOrders(req, res) {
  if (!isAdmin(req)) return json(res, 403, { ok: false, error: 'Admin only' });
  json(res, 200, { ok: true, orders: readData(FILES.orders, []) });
}

async function handleSaveOrder(req, res) {
  let rawBody;
  try { rawBody = await readBody(req); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  const body = sanitiseOrder(rawBody);
  const orders = readData(FILES.orders, []);
  const idx    = orders.findIndex(o => o.id === body.id);
  if (idx !== -1) orders[idx] = body; else orders.unshift(body);
  writeData(FILES.orders, orders);

  // Save customer record
  if (body.email) {
    const customers = readData(FILES.customers, []);
    const ci = customers.findIndex(c => c.email === body.email);
    const record = { email: body.email, name: body.customer || '', phone: body.phone || '', address: body.address || '', lastOrder: body.id, updatedAt: new Date().toISOString() };
    if (ci !== -1) customers[ci] = { ...customers[ci], ...record }; else customers.unshift(record);
    writeData(FILES.customers, customers);
  }

  track('order', { orderId: body.id, total: body.total });
  log('info', 'Order saved: ' + body.id);
  json(res, 200, { ok: true, id: body.id });
}

async function handleSaveAllOrders(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  const orders = Array.isArray(body.orders) ? body.orders : (Array.isArray(body) ? body : []);
  writeData(FILES.orders, orders);
  json(res, 200, { ok: true, count: orders.length });
}

// ── Shipments ──────────────────────────────────────────────

function handleGetShipments(req, res) {
  json(res, 200, { ok: true, shipments: readData(FILES.shipments, []) });
}

async function handleSaveShipment(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  const ships = readData(FILES.shipments, []);
  const idx   = ships.findIndex(s => s.id === body.id);
  if (idx !== -1) ships[idx] = body; else ships.unshift(body);
  writeData(FILES.shipments, ships);
  log('info', 'Shipment saved: ' + body.id);
  json(res, 200, { ok: true, id: body.id });
}

async function handleSaveAllShipments(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  const ships = Array.isArray(body.shipments) ? body.shipments : (Array.isArray(body) ? body : []);
  writeData(FILES.shipments, ships);
  json(res, 200, { ok: true, count: ships.length });
}

function handleTrackShipment(req, res, id) {
  const ships    = readData(FILES.shipments, []);
  const shipment = ships.find(s => s.id === id);
  if (!shipment) return json(res, 404, { ok: false, error: 'Tracking ID not found' });
  track('track', { id });
  json(res, 200, { ok: true, shipment });
}

// ── Customers ──────────────────────────────────────────────

function handleGetCustomers(req, res) {
  if (!isAdmin(req)) return json(res, 403, { ok: false, error: 'Admin only' });
  json(res, 200, { ok: true, customers: readData(FILES.customers, []) });
}

// ── Reviews ────────────────────────────────────────────────

function handleGetReviews(req, res, productId) {
  const all = readData(FILES.reviews, {});
  json(res, 200, { ok: true, reviews: productId ? (all[productId] || []) : all });
}

async function handleSaveReview(req, res, productId) {
  let body;
  try { body = await readBody(req); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  const all = readData(FILES.reviews, {});
  if (!all[productId]) all[productId] = [];
  const review = {
    id:        crypto.randomBytes(6).toString('hex'),
    author:    body.author  || 'Anonymous',
    rating:    Math.min(5, Math.max(1, parseInt(body.rating) || 5)),
    text:      body.text    || '',
    verified:  !!body.verified,
    createdAt: new Date().toISOString(),
  };
  all[productId].unshift(review);
  if (all[productId].length > 50) all[productId] = all[productId].slice(0, 50);
  writeData(FILES.reviews, all);
  json(res, 200, { ok: true, review });
}

// ── Settings ───────────────────────────────────────────────

function handleGetSettings(req, res) {
  json(res, 200, { ok: true, settings: readData(FILES.settings, {}) });
}

async function handleSaveSettings(req, res) {
  if (!isAdmin(req)) return json(res, 403, { ok: false, error: 'Admin only' });
  let body;
  try { body = await readBody(req); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  const settings = { ...readData(FILES.settings, {}), ...body, updatedAt: new Date().toISOString() };
  writeData(FILES.settings, settings);
  json(res, 200, { ok: true, settings });
}

// ── Site Settings (store hero, marquee, trust strip etc.) ──
// Public GET so the store can read admin-saved settings on load.
// POST is admin-only.

function handleGetSiteSettings(req, res) {
  const s = readData(FILES.settings, {});
  // Return the subset that the store pages need
  json(res, 200, { ok: true, settings: {
    marquee:      s.marquee      || '',
    storeHero:    s.storeHero    || null,
    trustStrip:   s.trustStrip   || null,
    footerConfig: s.footerConfig || null,
    seo:          s.seo          || null,
    banner:       s.banner       || null,
    trackingText: s.trackingText || null,
    sectionLabels:s.sectionLabels|| null,
    bulkTiers:    s.bulkTiers    || null,
    promoCodes:   s.promoCodes   || null,
  }});
}

async function handleSaveSiteSettings(req, res) {
  if (!isAdmin(req)) return json(res, 403, { ok: false, error: 'Admin only' });
  let body;
  try { body = await readBody(req); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  const current = readData(FILES.settings, {});
  const payload  = body.settings || body;
  // Merge site-level keys into settings file
  const merged = { ...current, ...payload, updatedAt: new Date().toISOString() };
  writeData(FILES.settings, merged);
  log('info', 'Site settings saved');
  json(res, 200, { ok: true });
}

// ── Promo Codes ────────────────────────────────────────────

function handleGetPromoCodes(req, res) {
  const codes = readData(FILES.promoCodes, {});
  // Also read from settings if saved there by admin panel
  const s = readData(FILES.settings, {});
  const fromSettings = s.promoCodes;
  if (Array.isArray(fromSettings)) {
    // Admin panel format: array
    json(res, 200, { ok: true, promoCodes: fromSettings });
    return;
  }
  // Legacy object format
  json(res, 200, { ok: true, promoCodes: codes });
}

async function handleSavePromoCodes(req, res) {
  if (!isAdmin(req)) return json(res, 403, { ok: false, error: 'Admin only' });
  let body;
  try { body = await readBody(req); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  const codes = body.promoCodes || body;
  writeData(FILES.promoCodes, codes);
  // Also persist into settings so site-settings endpoint returns it
  const s = readData(FILES.settings, {});
  s.promoCodes = codes;
  writeData(FILES.settings, s);
  log('info', 'Promo codes saved');
  json(res, 200, { ok: true });
}

// ── Bulk Tiers ─────────────────────────────────────────────

function handleGetBulkTiers(req, res) {
  const s = readData(FILES.settings, {});
  const tiers = s.bulkTiers || [
    { minQty:5,   maxQty:9,    discount:5,  label:'Starter',    active:true },
    { minQty:10,  maxQty:24,   discount:10, label:'Silver',     active:true },
    { minQty:25,  maxQty:49,   discount:15, label:'Gold',       active:true },
    { minQty:50,  maxQty:99,   discount:20, label:'Platinum',   active:true },
    { minQty:100, maxQty:null, discount:28, label:'Enterprise', active:true },
  ];
  json(res, 200, { ok: true, tiers });
}

async function handleSaveBulkTiers(req, res) {
  if (!isAdmin(req)) return json(res, 403, { ok: false, error: 'Admin only' });
  let body;
  try { body = await readBody(req); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  const tiers = body.tiers || body;
  const s = readData(FILES.settings, {});
  s.bulkTiers = tiers;
  writeData(FILES.settings, s);
  log('info', 'Bulk tiers saved: ' + (Array.isArray(tiers) ? tiers.length : '?') + ' tiers');
  json(res, 200, { ok: true });
}

// ── Wholesale ──────────────────────────────────────────────

function handleGetWholesale(req, res) {
  json(res, 200, { ok: true, wholesale: readData(FILES.wholesale, {}) });
}

async function handleSaveWholesale(req, res) {
  if (!isAdmin(req)) return json(res, 403, { ok: false, error: 'Admin only' });
  let body;
  try { body = await readBody(req); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  writeData(FILES.wholesale, body);
  json(res, 200, { ok: true });
}

// ── Analytics ──────────────────────────────────────────────

function handleGetAnalytics(req, res) {
  if (!isAdmin(req)) return json(res, 403, { ok: false, error: 'Admin only' });
  const a    = readData(FILES.analytics, {});
  const days = Object.keys(a).sort().slice(-30);
  const out  = {};
  days.forEach(d => { out[d] = { pageviews: a[d].pageviews || 0, orders: a[d].orders || 0, revenue: a[d].revenue || 0 }; });
  json(res, 200, { ok: true, analytics: out });
}

async function handlePageview(req, res) {
  let body;
  try { body = await readBody(req); } catch (e) { body = {}; }
  track('pageview', { page: body.page || '/', ref: body.ref || '' });
  json(res, 200, { ok: true });
}

// ── Backup / Export / Import ───────────────────────────────

function handleBackup(req, res) {
  if (!isAdmin(req)) return json(res, 403, { ok: false, error: 'Admin only' });
  json(res, 200, { ok: true, backup: createBackup() });
}

function handleListBackups(req, res) {
  if (!isAdmin(req)) return json(res, 403, { ok: false, error: 'Admin only' });
  try {
    const dirs = fs.readdirSync(BACKUP_DIR)
      .filter(d => fs.statSync(path.join(BACKUP_DIR, d)).isDirectory())
      .sort().reverse();
    json(res, 200, { ok: true, backups: dirs });
  } catch (e) { json(res, 200, { ok: true, backups: [] }); }
}

function handleExport(req, res) {
  if (!isAdmin(req)) return json(res, 403, { ok: false, error: 'Admin only' });
  const data = JSON.stringify({
    exportedAt: new Date().toISOString(), version: VERSION,
    products:   readData(FILES.products,   []),
    categories: readData(FILES.categories, []),
    orders:     readData(FILES.orders,     []),
    shipments:  readData(FILES.shipments,  []),
    customers:  readData(FILES.customers,  []),
    reviews:    readData(FILES.reviews,    {}),
    settings:   readData(FILES.settings,   {}),
    wholesale:  readData(FILES.wholesale,  {}),
  }, null, 2);
  res.writeHead(200, {
    'Content-Type':        'application/json',
    'Content-Disposition': `attachment; filename="pes-export-${Date.now()}.json"`,
    'Content-Length':      Buffer.byteLength(data),
    ...CORS,
  });
  res.end(data);
  log('info', 'Full data export served');
}

async function handleImport(req, res) {
  if (!isAdmin(req)) return json(res, 403, { ok: false, error: 'Admin only' });
  let body;
  try { body = await readBody(req); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  createBackup(); // always backup before restoring
  const remartd = [];
  if (Array.isArray(body.products))              { writeData(FILES.products,   body.products);   remartd.push('products'); }
  if (Array.isArray(body.categories))            { writeData(FILES.categories, body.categories); remartd.push('categories'); }
  if (Array.isArray(body.orders))                { writeData(FILES.orders,     body.orders);     remartd.push('orders'); }
  if (Array.isArray(body.shipments))             { writeData(FILES.shipments,  body.shipments);  remartd.push('shipments'); }
  if (Array.isArray(body.customers))             { writeData(FILES.customers,  body.customers);  remartd.push('customers'); }
  if (body.reviews  && typeof body.reviews  === 'object') { writeData(FILES.reviews,  body.reviews);  remartd.push('reviews'); }
  if (body.settings && typeof body.settings === 'object') { writeData(FILES.settings, body.settings); remartd.push('settings'); }
  if (body.wholesale&& typeof body.wholesale=== 'object') { writeData(FILES.wholesale,body.wholesale);remartd.push('wholesale'); }
  log('info', 'Import remartd: ' + remartd.join(', '));
  json(res, 200, { ok: true, remartd });
}


// ── Dynamic Sitemap ────────────────────────────────────────
function handleSitemap(req, res) {
  const products   = readData(FILES.products, []);
  const categories = readData(FILES.categories, []);
  const base       = 'https://www.paramountdigitalservices.com';
  const today      = new Date().toISOString().split('T')[0];

  const staticUrls = [
    { loc: base + '/',              priority: '1.0', changefreq: 'daily'  },
    { loc: base + '/tracking.html', priority: '0.7', changefreq: 'weekly' },
  ];

  const productUrls = products.map(p => ({
    loc:        base + '/?p=PES-' + String(p.id).padStart(5,'0'),
    priority:   p.featured ? '0.9' : '0.8',
    changefreq: 'weekly',
    lastmod:    today,
  }));

  const catUrls = categories.map(c => ({
    loc:        base + '/?catalogue=' + encodeURIComponent(c.name),
    priority:   '0.7',
    changefreq: 'weekly',
    lastmod:    today,
  }));

  const allUrls = [...staticUrls, ...productUrls, ...catUrls];
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
    ...allUrls.map(u => [
      '  <url>',
      '    <loc>' + u.loc + '</loc>',
      u.lastmod    ? '    <lastmod>' + u.lastmod + '</lastmod>' : '',
      u.changefreq ? '    <changefreq>' + u.changefreq + '</changefreq>' : '',
      u.priority   ? '    <priority>' + u.priority + '</priority>' : '',
      '  </url>',
    ].filter(Boolean).join('\n')),
    '</urlset>',
  ].join('\n');

  res.writeHead(200, {
    'Content-Type': 'application/xml; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
    ...CORS,
  });
  res.end(xml);
}

// ── Full Sync ──────────────────────────────────────────────

async function handleSync(req, res) {
  if (!isAdmin(req)) return json(res, 403, { ok: false, error: 'Admin only' });
  let body;
  try { body = await readBody(req); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
  const saved = [];
  if (Array.isArray(body.products))              { writeData(FILES.products,   body.products);   saved.push('products'); }
  if (Array.isArray(body.categories))            { writeData(FILES.categories, body.categories); saved.push('categories'); }
  if (Array.isArray(body.orders))                { writeData(FILES.orders,     body.orders);     saved.push('orders'); }
  if (Array.isArray(body.shipments))             { writeData(FILES.shipments,  body.shipments);  saved.push('shipments'); }
  if (body.settings && typeof body.settings === 'object') { writeData(FILES.settings, body.settings); saved.push('settings'); }
  if (body.wholesale&& typeof body.wholesale=== 'object') { writeData(FILES.wholesale,body.wholesale);saved.push('wholesale'); }
  log('info', 'Sync: ' + saved.join(', '));
  json(res, 200, { ok: true, saved });
}


// ── Admin credential check (env-override support) ──────────
// If ADMIN_USERNAME / ADMIN_PASSWORD are set in .env, the server
// verifies credentials server-side using PBKDF2-stretched hashes.
// If neither env nor a stored PBKDF2 hash exists, the server uses
// the known default SHA-256 hashes (admin/admin123) — still verified
// server-side, never trusted blindly.

const crypto_node = require('crypto');

// ── PBKDF2 helpers ──────────────────────────────────────────
// Stored format: "pbkdf2$<iterations>$<salt_hex>$<hash_hex>"
const PBKDF2_ITERS = 100000;
const PBKDF2_LEN   = 64;
const PBKDF2_ALGO  = 'sha512';

function pbkdf2Hash(password, salt) {
  const s = salt || crypto_node.randomBytes(32).toString('hex');
  const h = crypto_node.pbkdf2Sync(password, s, PBKDF2_ITERS, PBKDF2_LEN, PBKDF2_ALGO).toString('hex');
  return `pbkdf2$${PBKDF2_ITERS}$${s}$${h}`;
}

function pbkdf2Verify(password, stored) {
  try {
    const [, iters, salt, hash] = stored.split('$');
    const h = crypto_node.pbkdf2Sync(password, salt, parseInt(iters, 10), PBKDF2_LEN, PBKDF2_ALGO).toString('hex');
    // Constant-time comparison
    return crypto_node.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hash, 'hex'));
  } catch { return false; }
}

// Default credentials (admin / admin123) — SHA-256 of plaintext sent by client
// These are the same hashes embedded in admin.js for the default account.
// Override by setting ADMIN_USERNAME + ADMIN_PASSWORD in .env
const DEFAULT_USERNAME_HASH = '2a9d6f592f38a64350c8cc07d8d1d65cc56cce7ea47d5131aaf4c4b04f18965b';
const DEFAULT_PASSWORD_HASH = 'ad7584ae5e41144c853b80b5d94f99c8cf89d742ba5e91aec3c7b9eef1d4522e';

function getAdminHashesFromEnv() {
  const u = process.env.ADMIN_USERNAME;
  const p = process.env.ADMIN_PASSWORD;
  if (!u || !p) return null;
  return {
    usernameHash: crypto_node.createHash('sha256').update(u).digest('hex'),
    passwordHash: crypto_node.createHash('sha256').update(p).digest('hex'),
  };
}

async function handleAdminVerify(req, res) {
  // Legacy endpoint kept for backwards compatibility.
  // New logins use /api/admin-login which issues a proper session token.
  let body;
  try { body = await readBody(req); } catch (e) { return json(res, 400, { ok: false, error: 'Invalid body' }); }
  if (await _verifyAdminCredentials(body.usernameHash, body.passwordHash)) {
    return json(res, 200, { ok: true, mode: 'server' });
  }
  log('warn', 'Failed admin verify from ' + getIP(req));
  return json(res, 401, { ok: false, error: 'Invalid credentials' });
}

// ── Central credential verification ─────────────────────────
// Priority: 1) .env credentials  2) PBKDF2 stored hash  3) legacy SHA-256  4) defaults
async function _verifyAdminCredentials(usernameHash, passwordHash) {
  if (!usernameHash || !passwordHash) return false;

  // 1. Env-based credentials (highest priority)
  const envHashes = getAdminHashesFromEnv();
  if (envHashes) {
    return usernameHash === envHashes.usernameHash && passwordHash === envHashes.passwordHash;
  }

  const settings = readData(FILES.settings, {});

  // 2. PBKDF2 stored hash (set after first password change via reset flow)
  if (settings.adminPasswordHashPbkdf2) {
    return pbkdf2Verify(passwordHash, settings.adminPasswordHashPbkdf2);
  }

  // 3. Legacy plain SHA-256 stored hash — accept but auto-upgrade to PBKDF2
  if (settings.adminPasswordHash) {
    const legacyMatch = passwordHash === settings.adminPasswordHash;
    if (legacyMatch) {
      settings.adminPasswordHashPbkdf2 = pbkdf2Hash(passwordHash);
      delete settings.adminPasswordHash;
      writeData(FILES.settings, settings);
      log('info', 'Admin password hash auto-upgraded to PBKDF2');
    }
    return legacyMatch;
  }

  // 3b. Check stored username hash (from admin-set-username)
  if (settings.adminUsernameHash && usernameHash !== settings.adminUsernameHash) {
    return false; // username doesn't match stored one
  }

  // 4. Default credentials — always verified, never trusted blindly
  return usernameHash === DEFAULT_USERNAME_HASH && passwordHash === DEFAULT_PASSWORD_HASH;
}


// ── Crypto Payment Verification ────────────────────────────────
async function handleCryptoVerify(req, res) {
  let body;
  try { body = await readBody(req); } catch(e) { return json(res, 400, { ok: false, error: 'Invalid body' }); }
  const { orderId, txHash, coin, coinAmount, totalUSD, totalNGN, name, email } = body;
  if (!orderId || !txHash) return json(res, 400, { ok: false, error: 'orderId and txHash required' });

  // Log verification to a dedicated file
  const verifyEntry = {
    orderId, txHash, coin, coinAmount, totalUSD, totalNGN, name, email,
    submittedAt: new Date().toISOString(),
    ip: getIP(req),
    status: 'pending'
  };
  log('info', `Crypto verify request: ${orderId} — ${coin} ${coinAmount} — txHash: ${txHash}`);

  // Persist to crypto-verifications.json
  const vFile = path.join(DATA_DIR, 'crypto-verifications.json');
  try {
    const existing = fs.existsSync(vFile) ? JSON.parse(fs.readFileSync(vFile,'utf8')) : [];
    existing.unshift(verifyEntry);
    fs.writeFileSync(vFile + '.tmp', JSON.stringify(existing, null, 2), 'utf8');
    fs.renameSync(vFile + '.tmp', vFile);
  } catch(e) { log('error', 'Failed to save crypto verification: ' + e.message); }

  // Send admin email notification if email is configured
  try {
    const nodemailer = require('nodemailer');
    if (process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASSWORD) {
      const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: parseInt(process.env.EMAIL_PORT || '587'),
        secure: process.env.EMAIL_SECURE === 'true',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD },
      });
      const ADMIN_EMAIL = process.env.ADMIN_EMAIL || process.env.EMAIL_USER;
      await transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to: ADMIN_EMAIL,
        subject: `🔐 Crypto Payment Verification — ${orderId}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:520px;background:#0a0a0a;color:#fff;padding:32px;border-radius:8px;">
            <h2 style="color:#F7931A;">Crypto Payment Submitted</h2>
            <table style="width:100%;border-collapse:collapse;margin-top:20px;">
              <tr><td style="color:#888;padding:8px 0;border-bottom:1px solid #222;">Order ID</td><td style="color:#fff;font-weight:700;">${orderId}</td></tr>
              <tr><td style="color:#888;padding:8px 0;border-bottom:1px solid #222;">Customer</td><td style="color:#fff;">${name || '—'}</td></tr>
              <tr><td style="color:#888;padding:8px 0;border-bottom:1px solid #222;">Email</td><td style="color:#fff;">${email || '—'}</td></tr>
              <tr><td style="color:#888;padding:8px 0;border-bottom:1px solid #222;">Coin</td><td style="color:#26A17B;font-weight:700;">${coin || '—'}</td></tr>
              <tr><td style="color:#888;padding:8px 0;border-bottom:1px solid #222;">Amount</td><td style="color:#fff;">${coinAmount || '—'} ≈ $${totalUSD} (₦${totalNGN})</td></tr>
              <tr><td style="color:#888;padding:8px 0;">TX Hash</td><td style="color:#F7931A;font-family:monospace;word-break:break-all;">${txHash}</td></tr>
            </table>
            <p style="margin-top:24px;color:#888;font-size:12px;">Please verify this transaction on the appropriate blockchain explorer and confirm the order in the admin panel.</p>
          </div>`,
      });
      log('info', 'Crypto verify email sent to ' + ADMIN_EMAIL);
    }
  } catch(e) { log('error', 'Crypto verify email failed: ' + e.message); }

  return json(res, 200, { ok: true, message: 'Verification received. We will confirm within 30 minutes.' });
}

// ── Admin Login (issues session token) ──────────────────────────
async function handleAdminLogin(req, res) {
  let body;
  try { body = await readBody(req); } catch(e) { return json(res, 400, { ok: false, error: 'Invalid body' }); }
  const ip = getIP(req);

  if (await _verifyAdminCredentials(body.usernameHash, body.passwordHash)) {
    const token = createSession();
    log('info', 'Admin login from ' + ip);
    return json(res, 200, { ok: true, token });
  }

  log('warn', 'Failed admin login from ' + ip);
  // Timing-safe: always wait a fixed delay to prevent timing attacks
  await new Promise(r => setTimeout(r, 400));
  return json(res, 401, { ok: false, error: 'Invalid credentials' });
}

// ── Admin Logout ─────────────────────────────────────────────
function handleAdminLogout(req, res) {
  const token = req.headers['x-pds-session'];
  if (token) destroySession(token);
  return json(res, 200, { ok: true });
}

// ── Google OAuth Admin Login ─────────────────────────────────
async function handleGoogleAdminLogin(req, res) {
  let body;
  try { body = await readBody(req); } catch(e) { return json(res, 400, { ok: false, error: 'Invalid body' }); }
  const { credential } = body;
  if (!credential) return json(res, 400, { ok: false, error: 'Missing Google credential' });

  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  if (!GOOGLE_CLIENT_ID) return json(res, 503, { ok: false, error: 'Google login not configured. Set GOOGLE_CLIENT_ID in .env' });

  const ALLOWED_EMAIL = process.env.ADMIN_GOOGLE_EMAIL;
  if (!ALLOWED_EMAIL) return json(res, 503, { ok: false, error: 'Google login not configured. Set ADMIN_GOOGLE_EMAIL in .env' });

  try {
    // Verify ID token with Google
    const verifyUrl = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential);
    const https = require('https');
    const googleData = await new Promise((resolve, reject) => {
      https.get(verifyUrl, r => {
        let data = '';
        r.on('data', c => data += c);
        r.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
      }).on('error', reject);
    });

    if (googleData.error) return json(res, 401, { ok: false, error: 'Invalid Google token' });
    if (googleData.aud !== GOOGLE_CLIENT_ID) return json(res, 401, { ok: false, error: 'Token client mismatch' });
    if (googleData.email !== ALLOWED_EMAIL) {
      log('warn', 'Google login rejected for: ' + googleData.email);
      return json(res, 403, { ok: false, error: 'This Google account is not authorised as admin' });
    }
    if (googleData.email_verified !== 'true') return json(res, 401, { ok: false, error: 'Google email not verified' });

    const ip = getIP(req);
    const token = createSession();
    log('info', 'Admin Google login: ' + googleData.email + ' from ' + ip);
    return json(res, 200, { ok: true, token, name: googleData.name, picture: googleData.picture });
  } catch(e) {
    log('error', 'Google token verify error: ' + e.message);
    return json(res, 500, { ok: false, error: 'Could not verify Google token' });
  }
}

// ── Forgot Password — Request Reset Link ─────────────────────
async function handleForgotPassword(req, res) {
  let body;
  try { body = await readBody(req); } catch(e) { return json(res, 400, { ok: false, error: 'Invalid body' }); }
  const { email } = body;
  // Always respond OK to prevent email enumeration
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
  if (!email || email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    return json(res, 200, { ok: true, message: 'If that email is registered, a reset link has been sent.' });
  }
  const token = createResetToken();
  const APP_URL = process.env.APP_URL || 'http://localhost:3000';
  const resetLink = APP_URL + '/admin.html?reset=' + token;
  log('info', 'Password reset requested for ' + email);
  // Send email if nodemailer is configured
  try {
    const nodemailer = require('nodemailer');
    if (process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASSWORD) {
      const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: parseInt(process.env.EMAIL_PORT || '587'),
        secure: process.env.EMAIL_SECURE === 'true',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD },
      });
      await transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to: email,
        subject: 'Paramount E-mart — Admin Password Reset',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#0a0a0a;color:#fff;padding:40px;border-radius:8px;">
            <h2 style="color:#c4a240;letter-spacing:0.15em;font-size:18px;">PARAMOUNT E-STORE</h2>
            <h3 style="color:#fff;margin-top:24px;">Admin Password Reset</h3>
            <p style="color:#aaa;line-height:1.6;">You requested a password reset for the admin control panel. Click the button below to set a new password. This link expires in 30 minutes.</p>
            <a href="${resetLink}" style="display:inline-block;margin:24px 0;padding:14px 32px;background:#c4a240;color:#000;text-decoration:none;font-weight:700;letter-spacing:0.1em;border-radius:4px;">RESET PASSWORD</a>
            <p style="color:#555;font-size:12px;">If you did not request this, ignore this email. Your password will not change.</p>
            <p style="color:#333;font-size:11px;margin-top:32px;border-top:1px solid #222;padding-top:16px;">Paramount E-mart · Uyo, Akwa Ibom, Nigeria</p>
          </div>`,
      });
      log('info', 'Password reset email sent to ' + email);
    } else {
      // No email configured — log the link so operator can use it
      log('info', 'RESET LINK (no email configured): ' + resetLink);
    }
  } catch(e) {
    log('error', 'Failed to send reset email: ' + e.message);
    log('info', 'RESET LINK (email failed): ' + resetLink);
  }
  return json(res, 200, { ok: true, message: 'If that email is registered, a reset link has been sent.' });
}

// ── Forgot Password — Validate Token ─────────────────────────
function handleValidateResetToken(req, res) {
  const { token } = url.parse(req.url, true).query;
  if (!token || !validateResetToken(token)) {
    return json(res, 400, { ok: false, error: 'Invalid or expired reset token' });
  }
  return json(res, 200, { ok: true });
}

// ── Forgot Password — Apply New Password ─────────────────────
async function handleApplyReset(req, res) {
  let body;
  try { body = await readBody(req); } catch(e) { return json(res, 400, { ok: false, error: 'Invalid body' }); }
  const { token, newPasswordHash } = body;
  if (!token || !newPasswordHash) return json(res, 400, { ok: false, error: 'Missing fields' });
  if (!consumeResetToken(token)) return json(res, 400, { ok: false, error: 'Invalid or expired reset token' });

  // Save the new hashed password in settings using PBKDF2 stretch
  // newPasswordHash is SHA-256(plaintext) from the client — we wrap it in PBKDF2
  const settings = readData(FILES.settings, {});
  settings.adminPasswordHashPbkdf2 = pbkdf2Hash(newPasswordHash);
  delete settings.adminPasswordHash; // remove any legacy SHA-256 stored hash
  writeData(FILES.settings, settings);
  log('info', 'Admin password reset applied (PBKDF2) from ' + getIP(req));
  return json(res, 200, { ok: true, message: 'Password updated successfully' });
}

// ── Admin Set Username (authenticated) ──────────────────────
async function handleAdminSetUsername(req, res) {
  if (!isAdmin(req)) return json(res, 403, { ok: false, error: 'Unauthorized' });
  let body;
  try { body = await readBody(req); } catch(e) { return json(res, 400, { ok: false, error: 'Invalid body' }); }
  const { usernameHash, username } = body;
  if (!usernameHash || !username || username.length < 3) return json(res, 400, { ok: false, error: 'Invalid username' });
  const settings = readData(FILES.settings, {});
  settings.adminUsernameHash = usernameHash;
  settings.adminUsername     = username; // store plain for display only
  writeData(FILES.settings, settings);
  log('info', 'Admin username changed to ' + username + ' from ' + getIP(req));
  return json(res, 200, { ok: true });
}

// ── Admin Set Password (authenticated) ──────────────────────
async function handleAdminSetPassword(req, res) {
  if (!isAdmin(req)) return json(res, 403, { ok: false, error: 'Unauthorized' });
  let body;
  try { body = await readBody(req); } catch(e) { return json(res, 400, { ok: false, error: 'Invalid body' }); }
  const { newPasswordHash } = body;
  if (!newPasswordHash || newPasswordHash.length < 40) return json(res, 400, { ok: false, error: 'Invalid password hash' });
  const settings = readData(FILES.settings, {});
  settings.adminPasswordHashPbkdf2 = pbkdf2Hash(newPasswordHash);
  delete settings.adminPasswordHash;
  writeData(FILES.settings, settings);
  log('info', 'Admin password changed by authenticated admin from ' + getIP(req));
  return json(res, 200, { ok: true, message: 'Password updated' });
}

// ── Image Upload ────────────────────────────────────────────
// Accepts multipart/form-data with a single file field named "image".
// Saves to ./images/products/ and returns the public URL.
// Max file size: 8MB. Accepted types: jpeg, png, webp, gif.

function handleUpload(req, res) {
  if (!isAdmin(req)) return json(res, 403, { ok: false, error: 'Admin only' });

  const uploadDir = path.join(ROOT, 'images', 'products');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    return json(res, 400, { ok: false, error: 'multipart/form-data required' });
  }

  const boundary = contentType.split('boundary=')[1];
  if (!boundary) return json(res, 400, { ok: false, error: 'No boundary' });

  const chunks = [];
  let size = 0;
  req.on('data', c => {
    size += c.length;
    if (size > 8 * 1024 * 1024) { req.destroy(); return json(res, 413, { ok: false, error: 'File too large (max 8MB)' }); }
    chunks.push(c);
  });
  req.on('end', () => {
    try {
      const body   = Buffer.concat(chunks);
      const sep    = Buffer.from('--' + boundary);
      const parts  = [];
      let   start  = 0;

      // Split body by boundary
      for (let i = 0; i <= body.length - sep.length; i++) {
        if (body.slice(i, i + sep.length).equals(sep)) {
          if (start > 0) parts.push(body.slice(start, i - 2)); // -2 for CRLF
          start = i + sep.length + 2; // skip CRLF after boundary
        }
      }

      // Find the file part
      const filePart = parts.find(p => p.toString('ascii', 0, 200).includes('filename='));
      if (!filePart) return json(res, 400, { ok: false, error: 'No file found in upload' });

      // Parse headers
      const headerEnd = filePart.indexOf('\n\n');
      if (headerEnd === -1) return json(res, 400, { ok: false, error: 'Malformed part' });
      const headerStr  = filePart.slice(0, headerEnd).toString('utf8');
      const fileBuffer = filePart.slice(headerEnd + 4);

      // Extract original filename
      const fnMatch = headerStr.match(/filename="([^"]+)"/);
      const origName = fnMatch ? fnMatch[1] : 'upload.jpg';
      const ext      = path.extname(origName).toLowerCase();
      const allowed  = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
      if (!allowed.includes(ext)) return json(res, 400, { ok: false, error: 'File type not allowed' });

      // Detect MIME from magic bytes
      const magic = fileBuffer.slice(0, 4);
      const isJpeg = magic[0] === 0xFF && magic[1] === 0xD8;
      const isPng  = magic[0] === 0x89 && magic[1] === 0x50;
      const isWebp = fileBuffer.slice(8, 12).toString('ascii') === 'WEBP';
      const isGif  = magic.toString('ascii', 0, 3) === 'GIF';
      if (!isJpeg && !isPng && !isWebp && !isGif) {
        return json(res, 400, { ok: false, error: 'File does not match declared type' });
      }

      // Save with timestamp-random name to prevent collisions
      const safeName = Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext;
      const filePath = path.join(uploadDir, safeName);
      fs.writeFileSync(filePath, fileBuffer);

      const publicUrl = '/images/products/' + safeName;
      log('info', 'Image uploaded: ' + safeName + ' (' + fileBuffer.length + ' bytes)');
      json(res, 200, { ok: true, url: publicUrl, filename: safeName });
    } catch (e) {
      log('error', 'Upload failed: ' + e.message);
      json(res, 500, { ok: false, error: 'Upload failed' });
    }
  });
  req.on('error', e => json(res, 500, { ok: false, error: e.message }));
}

// ═══════════════════════════════════════════════════════════
//  EXPRESS APP SETUP
// ═══════════════════════════════════════════════════════════

const app = express();

// ── Middleware ───────────────────────────────────────────────
app.use(compression());
app.use(corsMiddleware({
  origin: ALLOWED_ORIGIN || true,
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','X-PDS-Admin','X-PDS-Session'],
}));
// Security headers on every response
app.use((req, res, next) => {
  Object.entries(SECURITY_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
  next();
});
// Parse JSON bodies automatically (makes req.body available in all handlers)
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
// Handle preflight
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Helper: read JSON body via Express
async function readBodyExpress(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 20 * 1024 * 1024) { req.destroy(); return reject(new Error('Body too large')); }
      data += chunk;
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); } catch(e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// ── Rate limit middleware ────────────────────────────────────
app.use((req, res, next) => {
  const ip = getIP(req);
  if (!rateCheck(ip, req.path)) {
    return res.status(429).json({ ok: false, error: 'Too many requests' });
  }
  next();
});

// ── MAIN ROUTER ──────────────────────────────────────────────

// Health
app.get('/api/health', handleHealth);

// Sitemap
app.get('/sitemap.xml', handleSitemap);

// Well-known
app.get('/.well-known/security.txt', (req, res) => {
  const f = path.join(ROOT, '.well-known', 'security.txt');
  if (fs.existsSync(f)) { res.type('text/plain').send(fs.readFileSync(f,'utf8')); }
  else res.sendStatus(404);
});

// Admin auth
app.get('/api/admin-check',        (req, res) => res.status(isAdmin(req) ? 200 : 401).json({ ok: isAdmin(req) }));
app.post('/api/admin-verify',      handleAdminVerify);
app.post('/api/admin-login',       handleAdminLogin);
app.post('/api/admin-logout',      handleAdminLogout);
app.post('/api/admin-set-password',handleAdminSetPassword);
app.post('/api/admin-set-username',handleAdminSetUsername);
app.post('/api/admin-google-login',handleGoogleAdminLogin);
app.post('/api/forgot-password',   handleForgotPassword);
app.get('/api/validate-reset',     handleValidateResetToken);
app.post('/api/apply-reset',       handleApplyReset);
app.post('/api/crypto-verify',     handleCryptoVerify);

// Keys
app.get('/api/get-keys',    (req, res) => { if (!isAdmin(req)) return res.status(403).json({ok:false,error:'Admin only'}); handleGetKeys(req,res); });
app.post('/api/inject-keys',(req, res) => { if (!isAdmin(req)) return res.status(403).json({ok:false,error:'Admin only'}); handleInjectKeys(req,res); });

// Products
app.get('/api/products',  handleGetProducts);
app.post('/api/products', (req,res) => { if(!isAdmin(req)) return res.status(403).json({ok:false,error:'Admin only'}); handleSaveProducts(req,res); });

// Categories
app.get('/api/categories',  handleGetCategories);
app.post('/api/categories', (req,res) => { if(!isAdmin(req)) return res.status(403).json({ok:false,error:'Admin only'}); handleSaveCategories(req,res); });

// Orders
app.get('/api/orders',  handleGetOrders);
app.post('/api/order',  handleSaveOrder);
app.post('/api/orders', (req,res) => { if(!isAdmin(req)) return res.status(403).json({ok:false,error:'Admin only'}); handleSaveAllOrders(req,res); });

// Shipments
app.get('/api/shipments',  handleGetShipments);
app.post('/api/shipment',  handleSaveShipment);
app.post('/api/shipments', (req,res) => { if(!isAdmin(req)) return res.status(403).json({ok:false,error:'Admin only'}); handleSaveAllShipments(req,res); });
app.get('/api/track/:id',  (req,res) => handleTrackShipment(req,res,req.params.id));

// Customers
app.get('/api/customers', (req,res) => { if(!isAdmin(req)) return res.status(403).json({ok:false,error:'Admin only'}); handleGetCustomers(req,res); });

// Reviews
app.get('/api/reviews',         (req,res) => handleGetReviews(req,res,null));
app.get('/api/reviews/:id',     (req,res) => handleGetReviews(req,res,req.params.id));
app.post('/api/reviews/:id',    (req,res) => handleSaveReview(req,res,req.params.id));

// Settings
app.get('/api/settings',  handleGetSettings);
app.post('/api/settings', handleSaveSettings);

// Site settings
app.get('/api/site-settings',  handleGetSiteSettings);
app.post('/api/site-settings', handleSaveSiteSettings);

// Promo codes
app.get('/api/promo-codes',  handleGetPromoCodes);
app.post('/api/promo-codes', handleSavePromoCodes);

// Bulk tiers
app.get('/api/bulk-tiers',  handleGetBulkTiers);
app.post('/api/bulk-tiers', handleSaveBulkTiers);

// Wholesale
app.get('/api/wholesale',  handleGetWholesale);
app.post('/api/wholesale', handleSaveWholesale);

// Analytics + pageview
app.get('/api/analytics', (req,res) => { if(!isAdmin(req)) return res.status(403).json({ok:false,error:'Admin only'}); handleGetAnalytics(req,res); });
app.post('/api/pageview', handlePageview);

// Backup / export / import / sync
app.post('/api/backup',  (req,res) => { if(!isAdmin(req)) return res.status(403).json({ok:false,error:'Admin only'}); handleBackup(req,res); });
app.get('/api/backups',  (req,res) => { if(!isAdmin(req)) return res.status(403).json({ok:false,error:'Admin only'}); handleListBackups(req,res); });
app.get('/api/export',   (req,res) => { if(!isAdmin(req)) return res.status(403).json({ok:false,error:'Admin only'}); handleExport(req,res); });
app.post('/api/import',  (req,res) => { if(!isAdmin(req)) return res.status(403).json({ok:false,error:'Admin only'}); handleImport(req,res); });
app.post('/api/sync',    (req,res) => { if(!isAdmin(req)) return res.status(403).json({ok:false,error:'Admin only'}); handleSync(req,res); });

// Image upload
app.post('/api/upload', (req,res) => { if(!isAdmin(req)) return res.status(403).json({ok:false,error:'Admin only'}); handleUpload(req,res); });

// Catch unknown /api/* routes
app.all('/api/*', (req,res) => res.status(404).json({ ok:false, error:'Unknown API endpoint' }));

// ── Admin panel routes ───────────────────────────────────────
app.get(['/admin.html', '/admin', '/pds-control-panel.html'], handleAdminPanel);
// Legacy redirect
app.use((req, res, next) => {
  if (req.path === '/pds-control-panel.html') {
    return res.redirect(301, '/admin.html');
  }
  next();
});

// ── Static files ─────────────────────────────────────────────
// Block data/logs directories from direct access
app.use((req, res, next) => {
  const filePath = path.join(ROOT, path.normalize(req.path));
  if (BLOCKED_PATHS.some(b => filePath.startsWith(b))) {
    return res.status(403).json({ ok:false, error:'Access denied' });
  }
  next();
});

// Serve static files with ETags, gzip, and cache headers
app.use((req, res, next) => {
  track('pageview', { page: req.path });
  next();
});
app.use(express.static(ROOT, {
  etag:         true,
  lastModified: true,
  setHeaders:   (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.html') {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else if (['.js','.css'].includes(ext)) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    } else if (['.png','.jpg','.jpeg','.webp','.gif','.svg','.ico','.woff','.woff2'].includes(ext)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000');
    }
  }
}));

// SPA fallback — serve index.html for unknown paths
app.use((req, res) => {
  const idx = path.join(ROOT, 'index.html');
  if (fs.existsSync(idx)) res.sendFile(idx);
  else res.status(404).send('Not Found');
});

// ── Start server ─────────────────────────────────────────────
const srv = require('http').createServer(app);

srv.listen(PORT, () => {
  const L = '═'.repeat(54);
  console.log(`\n  ╔${L}╗`);
  console.log(`  ║       PARAMOUNT E-STORE  —  Production Server         ║`);
  console.log(`  ║       Version ${VERSION.padEnd(40)}║`);
  console.log(`  ╠${L}╣`);
  console.log(`  ║  🌐  Store    →  http://localhost:${PORT}/                    ║`);
  console.log(`  ║  🔐  Admin    →  http://localhost:${PORT}/admin.html               ║`);
  console.log(`  ║  📍  Tracking →  http://localhost:${PORT}/tracking.html            ║`);
  console.log(`  ║  ❤️   Health   →  http://localhost:${PORT}/api/health               ║`);
  console.log(`  ╠${L}╣`);
  console.log(`  ║  ✅  Express + compression + CORS              ║`);
  console.log(`  ║  ✅  Key injection  — bakes API keys into JS          ║`);
  console.log(`  ║  ✅  Data on disk   — all data persisted to JSON      ║`);
  console.log(`  ║  ✅  Auto backups   — every 24h, last 30 kept         ║`);
  console.log(`  ║  ✅  PBKDF2 auth    — password hashing (100k rounds)  ║`);
  console.log(`  ║  ✅  Dual-mode auth — works with or without server    ║`);
  console.log(`  ║  ✅  Graceful exit  — final backup on shutdown        ║`);
  console.log(`  ╠${L}╣`);
  console.log(`  ║  Node.js ${process.version.padEnd(44)}║`);
  console.log(`  ║  Data → ./data/    Logs → ./logs/    ${' '.repeat(17)}║`);
  console.log(`  ╚${L}╝\n`);
  log('info', `Server started on port ${PORT} — Node.js ${process.version}`);
  scheduleBackup();
});
