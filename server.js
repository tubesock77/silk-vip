// Silk Head Spa — VIP list signup + password-protected admin
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(1); }
if (!ADMIN_PASSWORD) { console.error('ADMIN_PASSWORD is not set'); process.exit(1); }

const isLocalDb = /localhost|127\.0\.0\.1|\/var\/run/.test(DATABASE_URL);
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: isLocalDb ? false : { rejectUnauthorized: false },
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vip_signups (
      id SERIAL PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      consent BOOLEAN NOT NULL DEFAULT FALSE,
      source TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query('ALTER TABLE vip_signups ADD COLUMN IF NOT EXISTS comments TEXT');
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  next();
});

// ---------- helpers ----------
const clean = (s, max = 100) => String(s || '').trim().replace(/\s+/g, ' ').slice(0, max);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function normPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10) return null;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

// simple in-memory rate limit: 8 submissions / 10 min per IP
const hits = new Map();
function rateLimited(ip, limit = 8, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < windowMs);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > limit;
}
setInterval(() => hits.clear(), 60 * 60 * 1000).unref();

// signed-cookie sessions (no extra deps)
function sign(val) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(val).digest('hex');
}
function makeToken() {
  const exp = Date.now() + 12 * 60 * 60 * 1000; // 12 hours
  const payload = `${ADMIN_USER}|${exp}`;
  return Buffer.from(`${payload}|${sign(payload)}`).toString('base64url');
}
function validToken(tok) {
  try {
    const [user, exp, sig] = Buffer.from(tok, 'base64url').toString().split('|');
    const expected = sign(`${user}|${exp}`);
    if (!sig || sig.length !== expected.length) return false;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
    return user === ADMIN_USER && Number(exp) > Date.now();
  } catch { return false; }
}
function getCookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function requireAdmin(req, res, next) {
  const tok = getCookie(req, 'silk_admin');
  if (tok && validToken(tok)) return next();
  if (req.originalUrl.startsWith('/admin/api/')) return res.status(401).json({ error: 'Not logged in' });
  return res.redirect('/admin/login');
}

// ---------- public ----------
const pub = path.join(__dirname, 'public');
app.get(['/', '/vip'], (req, res) => res.sendFile(path.join(pub, 'index.html')));
app.get('/admin/login', (req, res) => res.sendFile(path.join(pub, 'login.html')));
app.use('/static', express.static(pub, { maxAge: '1h' }));
app.get('/healthz', (req, res) => res.send('ok'));

app.post('/api/signup', async (req, res) => {
  try {
    if (rateLimited(req.ip)) return res.status(429).json({ error: 'Too many attempts. Please try again in a few minutes.' });
    const b = req.body || {};
    if (b.website) return res.json({ ok: true }); // honeypot: bots fill hidden field

    const first = clean(b.firstName, 60);
    const last = clean(b.lastName, 60);
    const email = clean(b.email, 120).toLowerCase();
    const phone = normPhone(b.phone);
    const consent = true; // agreement is by submitting (disclosure shown under the button)
    const comments = String(b.comments || '').trim().slice(0, 500) || null;
    const source = clean(b.source, 60) || null;

    const errors = {};
    if (!first) errors.firstName = 'Please enter your first name';
    if (!last) errors.lastName = 'Please enter your last name';
    if (!phone) errors.phone = 'Please enter a 10-digit phone number';
    if (!EMAIL_RE.test(email)) errors.email = 'Please enter a valid email';
    if (Object.keys(errors).length) return res.status(400).json({ error: 'Please fix the highlighted fields.', errors });

    const r = await pool.query(
      `INSERT INTO vip_signups (first_name, last_name, phone, email, consent, source, comments)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (email) DO UPDATE SET
         first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
         phone = EXCLUDED.phone, consent = EXCLUDED.consent,
         comments = COALESCE(EXCLUDED.comments, vip_signups.comments), updated_at = NOW()
       RETURNING (xmax = 0) AS inserted`,
      [first, last, phone, email, consent, source, comments]
    );
    res.json({ ok: true, returning: !r.rows[0].inserted, firstName: first });
  } catch (e) {
    console.error('signup error', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------- admin ----------
app.post('/admin/login', (req, res) => {
  if (rateLimited('login:' + req.ip, 10, 15 * 60 * 1000)) {
    return res.redirect('/admin/login?e=locked');
  }
  const { username, password } = req.body || {};
  if (safeEqual(username || '', ADMIN_USER) && safeEqual(password || '', ADMIN_PASSWORD)) {
    const secure = req.secure ? '; Secure' : '';
    res.set('Set-Cookie', `silk_admin=${makeToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`);
    return res.redirect('/admin');
  }
  res.redirect('/admin/login?e=bad');
});
app.post('/admin/logout', (req, res) => {
  res.set('Set-Cookie', 'silk_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.redirect('/admin/login');
});

app.get('/admin', requireAdmin, (req, res) => res.sendFile(path.join(pub, 'admin.html')));

app.get('/admin/api/signups', requireAdmin, async (req, res) => {
  const r = await pool.query(
    `SELECT id, first_name, last_name, phone, email, consent, source, comments, created_at
     FROM vip_signups ORDER BY created_at DESC`);
  res.json(r.rows);
});

app.delete('/admin/api/signups/:id', requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM vip_signups WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
});

app.get('/admin/export.csv', requireAdmin, async (req, res) => {
  const r = await pool.query(
    `SELECT first_name, last_name, phone, email, consent, source, comments, created_at
     FROM vip_signups ORDER BY created_at ASC`);
  const esc = v => {
    let s = v instanceof Date ? v.toISOString() : String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s; // prevent spreadsheet formula injection
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [['First Name', 'Last Name', 'Phone', 'Email', 'Opted In', 'Source', 'Comments', 'Signed Up (UTC)']]
    .concat(r.rows.map(x => [x.first_name, x.last_name, x.phone, x.email, x.consent ? 'Yes' : 'No', x.source, x.comments, x.created_at]));
  const stamp = new Date().toISOString().slice(0, 10);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="silk-vip-list-${stamp}.csv"`);
  res.send('﻿' + rows.map(row => row.map(esc).join(',')).join('\r\n'));
});

app.use((req, res) => res.redirect('/'));

// Retry DB connection (a fresh Render database can take a minute to accept connections)
async function initDbWithRetry(attempts = 20, delayMs = 5000) {
  for (let i = 1; i <= attempts; i++) {
    try { await initDb(); return; }
    catch (e) {
      console.warn(`DB not ready (attempt ${i}/${attempts}): ${e.code || e.message}`);
      if (i === attempts) throw e;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

initDbWithRetry()
  .then(() => app.listen(PORT, () => console.log(`Silk VIP running on :${PORT}`)))
  .catch(e => { console.error('DB init failed', e); process.exit(1); });
