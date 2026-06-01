const path = require('path');
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
require('dotenv').config();

const { pool } = require('./db');
const lookupRoutes = require('./routes/lookups');
const categoryRoutes = require('./routes/categories');
const receiptRoutes = require('./routes/receipts');
const receiptItemRoutes = require('./routes/receiptItems');
const settingsRoutes = require('./routes/settings');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(session({
  store: new pgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  name: 'fnebooks.sid',
  secret: process.env.SESSION_SECRET || 'temporary-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: 'Login required' });
}

app.get('/health', (req, res) => res.json({ ok: true, app: 'FNEBooks' }));

app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD is not set' });
  }
  if (password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Wrong password' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

// Worker upload is open for now. Admin pages and admin updates require login.
app.use('/api/lookups', lookupRoutes);
app.use('/api/categories', requireAdmin, categoryRoutes);
app.use('/api/receipts', receiptRoutes({ requireAdmin }));
app.use('/api/receipt-items', requireAdmin, receiptItemRoutes);
app.use('/api/settings', requireAdmin, settingsRoutes);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.redirect('/receipts.html');
});

app.listen(PORT, () => {
  console.log(`FNEBooks running on port ${PORT}`);
});
