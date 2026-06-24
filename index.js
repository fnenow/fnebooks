const crypto = require('crypto');
const path = require('path');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
require('dotenv').config();

const { pool } = require('./db');
const lookupRoutes = require('./routes/lookups');
const categoryRoutes = require('./routes/categories');
const accountRoutes = require('./routes/accounts');
const receiptRoutes = require('./routes/receipts');
const receiptProcessingRoutes = require('./routes/receiptProcessing');
const receiptItemRoutes = require('./routes/receiptItems');
const settingsRoutes = require('./routes/settings');
const paymentMethodRoutes = require('./routes/paymentMethods');
const balanceSheetRoutes = require('./routes/balanceSheet');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const allowPublicUpload = process.env.ALLOW_PUBLIC_UPLOAD === 'true';

function assertConfiguration() {
  const missing = [];
  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
  if (!process.env.ADMIN_PASSWORD) missing.push('ADMIN_PASSWORD');
  if (!process.env.SESSION_SECRET) missing.push('SESSION_SECRET');
  if (missing.length) throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  if (isProduction && process.env.SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters in production');
  }
}
assertConfiguration();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(), microphone=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  next();
});
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.use(session({
  store: new pgSession({ pool, tableName: 'user_sessions', createTableIfMissing: false }),
  name: 'fnebooks.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction
  }
}));

function requireAdmin(req, res, next) {
  if (req.session?.isAdmin) return next();
  return res.status(401).json({ error: 'Admin login required' });
}

function requireUploader(req, res, next) {
  if (allowPublicUpload || req.session?.isAdmin || req.session?.canUpload) return next();
  return res.status(401).json({ error: 'Worker upload login required' });
}

function secureEqual(value, expected) {
  const left = Buffer.from(String(value || ''));
  const right = Buffer.from(String(expected || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

const loginAttempts = new Map();
function checkLoginLimit(type, req, res) {
  const key = `${type}:${req.ip}`;
  const now = Date.now();
  const record = loginAttempts.get(key);
  if (!record || record.resetAt <= now) {
    loginAttempts.set(key, { count: 0, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  if (record.count >= 8) {
    const retryMinutes = Math.max(1, Math.ceil((record.resetAt - now) / 60000));
    res.status(429).json({ error: `Too many login attempts. Try again in ${retryMinutes} minute(s).` });
    return false;
  }
  return true;
}
function recordLoginFailure(type, req) {
  const key = `${type}:${req.ip}`;
  const record = loginAttempts.get(key) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
  record.count += 1;
  loginAttempts.set(key, record);
}
function clearLoginFailures(type, req) {
  loginAttempts.delete(`${type}:${req.ip}`);
}

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, app: 'FNEBooks', version: '1.3.1', database: 'connected' });
  } catch (err) {
    console.error(err);
    res.status(503).json({ ok: false, app: 'FNEBooks', database: 'unavailable' });
  }
});

app.post('/api/login', (req, res) => {
  if (!checkLoginLimit('admin', req, res)) return;
  if (secureEqual(req.body.password, process.env.ADMIN_PASSWORD)) {
    clearLoginFailures('admin', req);
    req.session.isAdmin = true;
    req.session.canUpload = true;
    return req.session.save(() => res.json({ ok: true }));
  }
  recordLoginFailure('admin', req);
  return res.status(401).json({ error: 'Wrong password' });
});

app.post('/api/upload-login', (req, res) => {
  if (allowPublicUpload) {
    req.session.canUpload = true;
    return req.session.save(() => res.json({ ok: true }));
  }
  if (!process.env.WORKER_UPLOAD_PASSWORD) {
    return res.status(503).json({ error: 'Worker upload access is not configured. An admin can still upload after admin login.' });
  }
  if (!checkLoginLimit('upload', req, res)) return;
  if (secureEqual(req.body.password, process.env.WORKER_UPLOAD_PASSWORD)) {
    clearLoginFailures('upload', req);
    req.session.canUpload = true;
    return req.session.save(() => res.json({ ok: true }));
  }
  recordLoginFailure('upload', req);
  return res.status(401).json({ error: 'Wrong upload password' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('fnebooks.sid');
    res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  res.json({
    isAdmin: Boolean(req.session?.isAdmin),
    canUpload: Boolean(allowPublicUpload || req.session?.isAdmin || req.session?.canUpload)
  });
});

app.use('/api/lookups', requireUploader, lookupRoutes);
app.use('/api/categories', requireAdmin, categoryRoutes);
app.use('/api/accounts', requireAdmin, accountRoutes);
app.use('/api/receipts', receiptProcessingRoutes({ requireUploader }));
app.use('/api/receipts', receiptRoutes({ requireAdmin }));
app.use('/api/receipt-items', requireAdmin, receiptItemRoutes);
app.use('/api/settings', requireAdmin, settingsRoutes);
app.use('/api/payment-methods', requireAdmin, paymentMethodRoutes);
app.use('/api/balance-sheet', requireAdmin, balanceSheetRoutes);

app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: isProduction ? '1h' : 0
}));

app.get('/', (req, res) => res.redirect('/login.html'));
app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found' }));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  return res.status(err.statusCode || 500).json({ error: err.message || 'Unexpected server error' });
});

app.listen(PORT, () => {
  console.log(`FNEBooks v1.3.1 running on port ${PORT}`);
});
