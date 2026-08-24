const express = require('express');
const https = require('https');
const path = require('path');
const url = require('url');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const PDFDocument = require('pdfkit');
const { Resend } = require('resend');
const cron = require('node-cron');
const Stripe = require('stripe');
const multer = require('multer');
const { pool, init, formatSupplier, calcRisk } = require('./db');
const payroll = require('./payroll');
const nemkonto = require('./nemkonto');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.SESSION_SECRET || 'chainguard-jwt-secret';
const stripe = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null;
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

// ── Middleware ──────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Auth helpers ────────────────────────────────────────────
function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
}

function getUser(req) {
  const token = req.cookies && req.cookies.cg_token;
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

function requireAuth(req, res, next) {
  const user = getUser(req);
  if (!user) return res.redirect('/login');
  req.user = user;
  next();
}

async function requireSubscription(req, res, next) {
  if (req.user.role === 'admin') return next();
  try {
    const result = await pool.query('SELECT subscription_status FROM users WHERE id=$1', [req.user.id]);
    const status = result.rows[0]?.subscription_status;
    if (status === 'active' || status === 'trialing') return next();
    return res.redirect('/pricing?upgrade=1');
  } catch (e) {
    return next();
  }
}

// ── Shared auth page styles ──────────────────────────────────
const AUTH_STYLES = `
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; background: #080C20; color: #fff; min-height: 100vh; display: flex; align-items: center; justify-content: center; -webkit-font-smoothing: antialiased; }
  .orb-layer { position:fixed;inset:0;pointer-events:none;overflow:hidden; }
  .orb { position:absolute;border-radius:50%; }
  .orb-1 { width:700px;height:500px;background:radial-gradient(ellipse,rgba(124,92,252,0.28) 0%,transparent 65%);top:-150px;left:-150px; }
  .orb-2 { width:500px;height:500px;background:radial-gradient(ellipse,rgba(99,91,255,0.18) 0%,transparent 70%);bottom:-100px;right:-100px; }
  .card { position:relative;z-index:1;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.09);border-radius:20px;padding:48px 44px;width:100%;max-width:420px;backdrop-filter:blur(24px); }
  .logo { display:flex;align-items:center;gap:12px;margin-bottom:36px; }
  .logo-icon { width:40px;height:40px;background:linear-gradient(140deg,#9270FF,#635BFF);border-radius:12px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(124,92,252,0.5);font-size:20px; }
  .logo-text { font-size:20px;font-weight:800;letter-spacing:-0.5px; }
  .logo-sub { font-size:11px;color:rgba(255,255,255,0.3);margin-top:1px; }
  h1 { font-size:22px;font-weight:700;margin-bottom:6px; }
  .subtitle { color:rgba(255,255,255,0.45);font-size:14px;margin-bottom:32px; }
  label { display:block;font-size:12.5px;font-weight:600;color:rgba(255,255,255,0.6);margin-bottom:7px; }
  input { width:100%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px 14px;color:#fff;font-size:14px;font-family:inherit;margin-bottom:18px;outline:none;transition:border-color 0.2s; }
  input:focus { border-color:rgba(124,92,252,0.6); }
  button { width:100%;background:linear-gradient(135deg,#7C5CFC,#635BFF);border:none;border-radius:10px;padding:13px;color:#fff;font-size:14.5px;font-weight:700;font-family:inherit;cursor:pointer;margin-top:4px;box-shadow:0 4px 20px rgba(124,92,252,0.4);transition:opacity 0.2s; }
  button:hover { opacity:0.88; }
  .error { background:rgba(255,77,106,0.12);border:1px solid rgba(255,77,106,0.28);color:#FF4D6A;border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:18px; }
  .switch-link { text-align:center;margin-top:22px;font-size:13px;color:rgba(255,255,255,0.35); }
  .switch-link a { color:rgba(124,92,252,0.9);text-decoration:none;font-weight:600; }
  .switch-link a:hover { color:#A78BFA; }
`;

// ── Login side ──────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (getUser(req)) return res.redirect('/');
  res.send(`<!DOCTYPE html>
<html lang="da">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ChainGuard — Log ind</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${AUTH_STYLES}</style>
</head>
<body>
<div class="orb-layer"><div class="orb orb-1"></div><div class="orb orb-2"></div></div>
<div class="card">
  <div class="logo">
    <div class="logo-icon">🛡</div>
    <div><div class="logo-text">ChainGuard</div><div class="logo-sub">Compliance Platform</div></div>
  </div>
  <h1>Log ind</h1>
  <p class="subtitle">Indtast dine adgangsoplysninger</p>
  ${req.query.error ? '<div class="error">Forkert email eller adgangskode</div>' : ''}
  <form method="POST" action="/login">
    <label>Email</label>
    <input type="email" name="email" required autofocus placeholder="din@email.dk">
    <label>Adgangskode</label>
    <input type="password" name="password" required placeholder="••••••••">
    <button type="submit">Log ind</button>
  </form>
  <div class="switch-link">Ny bruger? <a href="/register">Opret gratis konto →</a></div>
</div>
</body>
</html>`);
});

// ── Opret konto ─────────────────────────────────────────────
app.get('/register', (req, res) => {
  if (getUser(req)) return res.redirect('/');
  const errors = {
    exists: 'Der findes allerede en konto med denne email.',
    mismatch: 'Adgangskoderne stemmer ikke overens.',
    short: 'Adgangskoden skal være mindst 8 tegn.',
    fail: 'Noget gik galt — prøv igen.',
  };
  const err = req.query.error ? (errors[req.query.error] || errors.fail) : null;
  res.send(`<!DOCTYPE html>
<html lang="da">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ChainGuard — Opret konto</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${AUTH_STYLES}</style>
</head>
<body>
<div class="orb-layer"><div class="orb orb-1"></div><div class="orb orb-2"></div></div>
<div class="card">
  <div class="logo">
    <div class="logo-icon">🛡</div>
    <div><div class="logo-text">ChainGuard</div><div class="logo-sub">Compliance Platform</div></div>
  </div>
  <h1>Opret konto</h1>
  <p class="subtitle">Første 30 dage gratis — ingen binding</p>
  ${err ? `<div class="error">${err}</div>` : ''}
  <form method="POST" action="/register">
    <label>Navn</label>
    <input type="text" name="name" required autofocus placeholder="Dit fulde navn">
    <label>Email</label>
    <input type="email" name="email" required placeholder="din@email.dk">
    <label>Adgangskode</label>
    <input type="password" name="password" required placeholder="Mindst 8 tegn">
    <label>Bekræft adgangskode</label>
    <input type="password" name="confirm" required placeholder="Gentag adgangskode">
    <button type="submit">Opret konto og vælg plan</button>
  </form>
  <div class="switch-link">Har du allerede en konto? <a href="/login">Log ind →</a></div>
</div>
</body>
</html>`);
});

app.post('/register', async (req, res) => {
  const { name, email, password, confirm } = req.body;
  if (!password || password.length < 8) return res.redirect('/register?error=short');
  if (password !== confirm) return res.redirect('/register?error=mismatch');
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    if (existing.rows.length > 0) return res.redirect('/register?error=exists');
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (email, password, name, role) VALUES ($1,$2,$3,'user') RETURNING *`,
      [email.trim().toLowerCase(), hash, name.trim()]
    );
    const token = signToken(result.rows[0]);
    res.cookie('cg_token', token, { httpOnly: true, maxAge: 8 * 60 * 60 * 1000 });
    res.redirect('/pricing');
  } catch (e) {
    console.error('Register fejl:', e.message);
    res.redirect('/register?error=fail');
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  // Env var fallback
  const adminEmail = (process.env.ADMIN_EMAIL || '').trim();
  const adminPassword = (process.env.ADMIN_PASSWORD || '').trim();
  if (adminEmail && email === adminEmail && password === adminPassword) {
    const token = signToken({ id: 1, email: adminEmail, name: process.env.ADMIN_NAME || 'Admin', role: 'admin' });
    res.cookie('cg_token', token, { httpOnly: true, maxAge: 8 * 60 * 60 * 1000 });
    return res.redirect('/');
  }

  // Database auth
  try {
    const normalizedEmail = (email || '').trim().toLowerCase();
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
    const user = result.rows[0];
    if (!user) return res.redirect('/login?error=1');
    const match = await bcrypt.compare(password, user.password.trim());
    if (!match) return res.redirect('/login?error=1');
    const token = signToken(user);
    res.cookie('cg_token', token, { httpOnly: true, maxAge: 8 * 60 * 60 * 1000 });
    if (user.role === 'investor') return res.redirect('/investor');
    res.redirect('/');
  } catch (e) {
    console.error('Login fejl:', e.message);
    res.redirect('/login?error=1');
  }
});


app.get('/logout', (req, res) => {
  res.clearCookie('cg_token');
  res.redirect('/login');
});

// ── Auth JSON API (bruges af standalone HTML frontend) ────────

// POST /api/auth/login — returnerer JSON + sætter cookie
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email og adgangskode er påkrævet.' });

  // Env-var admin-konto — opret i DB hvis ikke eksisterer
  const adminEmail    = (process.env.ADMIN_EMAIL || '').trim();
  const adminPassword = (process.env.ADMIN_PASSWORD || '').trim();
  if (adminEmail && email.trim().toLowerCase() === adminEmail && password === adminPassword) {
    try {
      let adminRow = (await pool.query('SELECT * FROM users WHERE email=$1', [adminEmail])).rows[0];
      if (!adminRow) {
        const hash = await bcrypt.hash(adminPassword, 10);
        adminRow = (await pool.query(
          `INSERT INTO users (email, password, name, role, subscription_status)
           VALUES ($1,$2,$3,'admin','active') RETURNING *`,
          [adminEmail, hash, process.env.ADMIN_NAME || 'Admin']
        )).rows[0];
      }
      const token = signToken(adminRow);
      res.cookie('cg_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 });
      return res.json({ ok: true, name: adminRow.name, role: adminRow.role, email: adminRow.email });
    } catch (e) {
      // Hvis DB fejler, brug id=0 som fallback
      const user  = { id: 0, email: adminEmail, name: process.env.ADMIN_NAME || 'Admin', role: 'admin' };
      const token = signToken(user);
      res.cookie('cg_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 });
      return res.json({ ok: true, name: user.name, role: user.role, email: user.email });
    }
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
    const user   = result.rows[0];

    if (!user) return res.status(401).json({ error: 'Forkert email eller adgangskode.' });

    const match = await bcrypt.compare(password, user.password.trim());
    if (!match) return res.status(401).json({ error: 'Forkert email eller adgangskode.' });

    const token = signToken(user);
    res.cookie('cg_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 });
    return res.json({ ok: true, name: user.name, role: user.role, email: user.email });
  } catch (e) {
    console.error('API login fejl:', e.message);
    res.status(500).json({ error: 'Serverfejl — prøv igen.' });
  }
});

// GET /api/auth/me — returnerer den aktuelle bruger fra cookie/token
app.get('/api/auth/me', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Ikke logget ind.' });
  res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
});

// POST /api/auth/logout — rydder cookie (JSON-variant)
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('cg_token');
  res.json({ ok: true });
});

// ── CVR API (ingen auth krævet) ─────────────────────────────
function httpsGet(u) {
  return new Promise((resolve, reject) => {
    const r = https.get(
      { ...url.parse(u), headers: { 'User-Agent': 'ChainGuard/1.0' } },
      x => {
        let d = '';
        x.on('data', c => d += c);
        x.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
      }
    );
    r.on('error', reject);
    r.setTimeout(8000, () => { r.destroy(); reject(new Error('Timeout')); });
  });
}

function normalizeCVR(d) {
  return {
    name: d.name || '—',
    vat: String(d.vat || ''),
    address: [d.address, d.zipcode, d.city].filter(Boolean).join(', ') || '—',
    industrydesc: d.industrydesc || '—',
    industrycode: d.industrycode || '',
    companydesc: d.companydesc || '—',
    startdate: d.startdate || '',
    employees: d.employees ?? null,
    phone: d.phone || '—',
    enddate: d.enddate || null,
  };
}

app.get('/api/debug-db', async (req, res) => {
  const dbUrl = process.env.DATABASE_URL || '';
  const resendKey = process.env.RESEND_API_KEY || '';
  const stripeKey = process.env.STRIPE_SECRET_KEY || '';
  res.json({
    database_url_sat: !!dbUrl,
    resend_key_sat: !!resendKey,
    stripe_secret_sat: !!stripeKey,
    stripe_secret_prefix: stripeKey ? stripeKey.substring(0, 12) + '...' : 'IKKE SAT',
  });
});

app.get('/api/test-cvr', async (req, res) => {
  try {
    const d = await httpsGet('https://cvrapi.dk/api?search=10150817&country=dk');
    res.json({ ok: true, name: d.name });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.get('/api/cvr/:cvr', async (req, res) => {
  if (!/^\d{8}$/.test(req.params.cvr)) return res.status(400).json({ error: 'Ugyldigt CVR-nummer' });
  try {
    const d = await httpsGet('https://cvrapi.dk/api?search=' + req.params.cvr + '&country=dk');
    if (d.error) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json(normalizeCVR(d));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/cvr/search/:query', async (req, res) => {
  try {
    const q = decodeURIComponent(req.params.query);
    const d = await httpsGet('https://cvrapi.dk/api?search=' + encodeURIComponent(q) + '&country=dk');
    if (d.error || !d.name) return res.json([]);
    res.json([{ name: d.name, cvr: String(d.vat || ''), city: d.city || '' }]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Leverandør API ───────────────────────────────────────────

// GET /api/suppliers — alle leverandører for den loggede bruger
app.get('/api/suppliers', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM suppliers WHERE user_id = $1 ORDER BY score ASC, added_at DESC',
      [req.user.id]
    );
    res.json(result.rows.map(formatSupplier));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/suppliers/:id — én leverandør
app.get('/api/suppliers/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM suppliers WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Ikke fundet' });
    res.json(formatSupplier(result.rows[0]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/suppliers — opret ny leverandør
app.post('/api/suppliers', requireAuth, async (req, res) => {
  const { cvr, name, address, industry, type, country, employees, phone, score, risk, status, statusClass, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Navn er påkrævet.' });

  const scoreNum      = parseInt(score) || 50;
  const riskVal       = risk || calcRisk({ score: scoreNum });
  const statusVal     = status || 'Afventer';
  const statusClsVal  = statusClass || (statusVal === 'Godkendt' ? 's-green' : statusVal === 'Blokeret' ? 's-red' : 's-amber');

  try {
    const result = await pool.query(
      `INSERT INTO suppliers
         (user_id, cvr, name, address, industry, type, country, employees, phone, score, risk, status, status_class, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [req.user.id, cvr || null, name.trim(), address || '', industry || type || '', type || industry || '',
       country || 'Danmark', employees || null, phone || '', scoreNum, riskVal, statusVal, statusClsVal, notes || '']
    );
    await pool.query(
      'INSERT INTO audit_log (user_id, supplier_id, action, details) VALUES ($1,$2,$3,$4)',
      [req.user.id, result.rows[0].id, 'LEVERANDØR TILFØJET', `${name}${cvr ? ' · CVR: ' + cvr : ''}`]
    );
    res.status(201).json(formatSupplier(result.rows[0]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/suppliers/:id — opdatér leverandør
app.patch('/api/suppliers/:id', requireAuth, async (req, res) => {
  const { status, statusClass, score, risk, notes, name, type, country } = req.body;
  try {
    // Hent eksisterende for at merge
    const cur = await pool.query('SELECT * FROM suppliers WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'Ikke fundet' });
    const c = cur.rows[0];

    const newScore      = score      !== undefined ? parseInt(score) : c.score;
    const newRisk       = risk       || calcRisk({ score: newScore });
    const newStatus     = status     || c.status;
    const newStatusCls  = statusClass || (newStatus === 'Godkendt' ? 's-green' : newStatus === 'Blokeret' ? 's-red' : 's-amber');

    const result = await pool.query(
      `UPDATE suppliers SET
         name=$1, type=$2, country=$3, score=$4, risk=$5,
         status=$6, status_class=$7, notes=$8, updated_at=NOW()
       WHERE id=$9 AND user_id=$10 RETURNING *`,
      [name || c.name, type || c.type, country || c.country,
       newScore, newRisk, newStatus, newStatusCls,
       notes !== undefined ? notes : c.notes,
       req.params.id, req.user.id]
    );
    await pool.query(
      'INSERT INTO audit_log (user_id, supplier_id, action, details) VALUES ($1,$2,$3,$4)',
      [req.user.id, req.params.id, 'LEVERANDØR OPDATERET', `Status: ${newStatus} · Score: ${newScore}`]
    );
    res.json(formatSupplier(result.rows[0]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/suppliers/:id
app.delete('/api/suppliers/:id', requireAuth, async (req, res) => {
  try {
    const cur = await pool.query('SELECT name FROM suppliers WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'Ikke fundet' });
    await pool.query('DELETE FROM suppliers WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    await pool.query(
      'INSERT INTO audit_log (user_id, action, details) VALUES ($1,$2,$3)',
      [req.user.id, 'LEVERANDØR SLETTET', cur.rows[0].name]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Sager (cases) API ────────────────────────────────────────

function formatCase(row) {
  return {
    id:             row.id,
    name:           row.name,
    address:        row.address || '',
    clientName:     row.client_name || '',
    status:         row.status || 'active',
    totalEmployees: row.total_employees || null,
    createdAt:      row.created_at,
    updatedAt:      row.updated_at,
  };
}

// GET /api/cases — alle sager for den loggede bruger
app.get('/api/cases', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, COUNT(cs.id)::int AS subcontractor_count
       FROM cases c
       LEFT JOIN case_subcontractors cs ON cs.case_id = c.id
       WHERE c.user_id = $1
       GROUP BY c.id
       ORDER BY c.updated_at DESC`,
      [req.user.id]
    );
    res.json(result.rows.map(row => ({ ...formatCase(row), subcontractorCount: row.subcontractor_count })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/cases/:id — én sag
app.get('/api/cases/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM cases WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Ikke fundet' });
    res.json(formatCase(result.rows[0]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/cases — opret ny sag
app.post('/api/cases', requireAuth, async (req, res) => {
  const { name, address, clientName, totalEmployees } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Sagsnavn er påkrævet.' });
  try {
    const result = await pool.query(
      `INSERT INTO cases (user_id, name, address, client_name, total_employees)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.id, name.trim(), address || null, clientName || null, totalEmployees || null]
    );
    await pool.query(
      'INSERT INTO audit_log (user_id, action, details) VALUES ($1,$2,$3)',
      [req.user.id, 'SAG OPRETTET', name.trim()]
    );
    res.status(201).json(formatCase(result.rows[0]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/cases/:id — opdatér sag
app.patch('/api/cases/:id', requireAuth, async (req, res) => {
  const { name, address, clientName, status, totalEmployees } = req.body;
  try {
    const cur = await pool.query('SELECT * FROM cases WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'Ikke fundet' });
    const c = cur.rows[0];
    const result = await pool.query(
      `UPDATE cases SET name=$1, address=$2, client_name=$3, status=$4, total_employees=$5, updated_at=NOW()
       WHERE id=$6 AND user_id=$7 RETURNING *`,
      [name || c.name, address !== undefined ? address : c.address,
       clientName !== undefined ? clientName : c.client_name,
       status || c.status, totalEmployees !== undefined ? totalEmployees : c.total_employees,
       req.params.id, req.user.id]
    );
    res.json(formatCase(result.rows[0]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/cases/:id
app.delete('/api/cases/:id', requireAuth, async (req, res) => {
  try {
    const cur = await pool.query('SELECT name FROM cases WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'Ikke fundet' });
    await pool.query('DELETE FROM cases WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    await pool.query(
      'INSERT INTO audit_log (user_id, action, details) VALUES ($1,$2,$3)',
      [req.user.id, 'SAG SLETTET', cur.rows[0].name]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Underentreprenør-kæde API ────────────────────────────────

function formatChainNode(row) {
  return {
    id:              row.id,
    caseId:          row.case_id,
    supplierId:      row.supplier_id,
    parentId:        row.parent_id,
    tier:            row.tier,
    roleLabel:       row.role_label || '',
    name:            row.supplier_name,
    country:         row.supplier_country || 'Danmark',
    activity:        row.activity || '',
    employeesOnSite: row.employees_on_site,
    permitStatus:    row.permit_status || '',
    status:          row.status,
    statusClass:     row.status_class,
    addedAt:         row.added_at,
  };
}

// Byg et træ ud fra en flad liste (parent_id-relationer)
function buildChainTree(rows) {
  const byId = {};
  rows.forEach(r => { byId[r.id] = { ...formatChainNode(r), children: [] }; });
  const roots = [];
  rows.forEach(r => {
    const node = byId[r.id];
    if (r.parent_id && byId[r.parent_id]) {
      byId[r.parent_id].children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

// GET /api/cases/:id/chain — hent leverandørkæden som et træ
app.get('/api/cases/:id/chain', requireAuth, async (req, res) => {
  try {
    const caseRow = await pool.query('SELECT id FROM cases WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!caseRow.rows[0]) return res.status(404).json({ error: 'Sag ikke fundet' });

    const result = await pool.query(
      `SELECT cs.*, s.name AS supplier_name, s.country AS supplier_country
       FROM case_subcontractors cs
       JOIN suppliers s ON s.id = cs.supplier_id
       WHERE cs.case_id = $1
       ORDER BY cs.tier ASC, cs.added_at ASC`,
      [req.params.id]
    );
    res.json(buildChainTree(result.rows));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/cases/:id/subcontractors — tilknyt underentreprenør til sagen
app.post('/api/cases/:id/subcontractors', requireAuth, async (req, res) => {
  const { supplierId, parentId, roleLabel, activity, employeesOnSite, permitStatus, status } = req.body;
  if (!supplierId) return res.status(400).json({ error: 'Leverandør er påkrævet.' });

  try {
    const caseRow = await pool.query('SELECT id FROM cases WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!caseRow.rows[0]) return res.status(404).json({ error: 'Sag ikke fundet' });

    const supplierRow = await pool.query('SELECT id, name, country FROM suppliers WHERE id=$1 AND user_id=$2', [supplierId, req.user.id]);
    if (!supplierRow.rows[0]) return res.status(404).json({ error: 'Leverandør ikke fundet' });

    // Beregn tier ud fra parent (parent.tier + 1), ellers tier 1
    let tier = 1;
    if (parentId) {
      const parentRow = await pool.query(
        'SELECT tier FROM case_subcontractors WHERE id=$1 AND case_id=$2',
        [parentId, req.params.id]
      );
      if (!parentRow.rows[0]) return res.status(404).json({ error: 'Overordnet led ikke fundet' });
      tier = parentRow.rows[0].tier + 1;
    }

    const statusVal = status || 'pending';
    const statusCls = statusVal === 'approved' ? 's-green' : statusVal === 'blocked' ? 's-red' : 's-amber';

    const result = await pool.query(
      `INSERT INTO case_subcontractors
         (case_id, supplier_id, parent_id, tier, role_label, activity, employees_on_site, permit_status, status, status_class)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [req.params.id, supplierId, parentId || null, tier, roleLabel || null, activity || null,
       employeesOnSite || null, permitStatus || null, statusVal, statusCls]
    );

    await pool.query(
      'INSERT INTO audit_log (user_id, supplier_id, action, details) VALUES ($1,$2,$3,$4)',
      [req.user.id, supplierId, 'UNDERENTREPRENØR TILKNYTTET', `${supplierRow.rows[0].name} · Tier ${tier} · Sag #${req.params.id}`]
    );

    res.status(201).json(formatChainNode({ ...result.rows[0], supplier_name: supplierRow.rows[0].name, supplier_country: supplierRow.rows[0].country }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/cases/:id/subcontractors/:linkId — opdatér tilknytning
app.patch('/api/cases/:id/subcontractors/:linkId', requireAuth, async (req, res) => {
  const { roleLabel, activity, employeesOnSite, permitStatus, status } = req.body;
  try {
    const caseRow = await pool.query('SELECT id FROM cases WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!caseRow.rows[0]) return res.status(404).json({ error: 'Sag ikke fundet' });

    const cur = await pool.query(
      `SELECT cs.*, s.name AS supplier_name, s.country AS supplier_country
       FROM case_subcontractors cs JOIN suppliers s ON s.id = cs.supplier_id
       WHERE cs.id=$1 AND cs.case_id=$2`,
      [req.params.linkId, req.params.id]
    );
    if (!cur.rows[0]) return res.status(404).json({ error: 'Ikke fundet' });
    const c = cur.rows[0];

    const newStatus = status || c.status;
    const newStatusCls = newStatus === 'approved' ? 's-green' : newStatus === 'blocked' ? 's-red' : 's-amber';

    const result = await pool.query(
      `UPDATE case_subcontractors SET
         role_label=$1, activity=$2, employees_on_site=$3, permit_status=$4, status=$5, status_class=$6, updated_at=NOW()
       WHERE id=$7 AND case_id=$8 RETURNING *`,
      [roleLabel !== undefined ? roleLabel : c.role_label,
       activity !== undefined ? activity : c.activity,
       employeesOnSite !== undefined ? employeesOnSite : c.employees_on_site,
       permitStatus !== undefined ? permitStatus : c.permit_status,
       newStatus, newStatusCls, req.params.linkId, req.params.id]
    );
    res.json(formatChainNode({ ...result.rows[0], supplier_name: c.supplier_name, supplier_country: c.supplier_country }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/cases/:id/subcontractors/:linkId — fjern tilknytning (og evt. underliggende kæde via CASCADE)
app.delete('/api/cases/:id/subcontractors/:linkId', requireAuth, async (req, res) => {
  try {
    const caseRow = await pool.query('SELECT id FROM cases WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!caseRow.rows[0]) return res.status(404).json({ error: 'Sag ikke fundet' });

    const cur = await pool.query(
      `SELECT s.name FROM case_subcontractors cs JOIN suppliers s ON s.id = cs.supplier_id
       WHERE cs.id=$1 AND cs.case_id=$2`,
      [req.params.linkId, req.params.id]
    );
    if (!cur.rows[0]) return res.status(404).json({ error: 'Ikke fundet' });

    await pool.query('DELETE FROM case_subcontractors WHERE id=$1 AND case_id=$2', [req.params.linkId, req.params.id]);
    await pool.query(
      'INSERT INTO audit_log (user_id, action, details) VALUES ($1,$2,$3)',
      [req.user.id, 'UNDERENTREPRENØR FJERNET', cur.rows[0].name]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PDF Export (download direkte) ───────────────────────────
app.get('/api/export/pdf', requireAuth, async (req, res) => {
  try {
    const { buffer } = await generateCompliancePDF(req.user.id, req.user.name, req.user.email);
    const dateStr = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="chainguard-revisionsspor-${dateStr}.pdf"`);
    res.send(buffer);
  } catch (e) {
    console.error('PDF fejl:', e.message, e.stack);
    res.status(500).send('PDF fejl: ' + e.message);
  }
});

// ── Email / Compliance Arkiv ─────────────────────────────────
function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

async function generateCompliancePDF(userId, userName, userEmail) {
  const suppliers = await pool.query(
    'SELECT * FROM suppliers WHERE user_id = $1 ORDER BY added_at DESC',
    [userId]
  );
  const auditLog = await pool.query(
    `SELECT a.*, s.name as supplier_name, s.cvr
     FROM audit_log a
     LEFT JOIN suppliers s ON s.id = a.supplier_id
     WHERE a.user_id = $1
     ORDER BY a.created_at DESC
     LIMIT 500`,
    [userId]
  );

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve({
      buffer: Buffer.concat(chunks),
      suppliersCount: suppliers.rows.length,
      auditEntries: auditLog.rows.length
    }));
    doc.on('error', reject);

    // Header
    doc.fontSize(22).font('Helvetica-Bold').fillColor('#1a1a2e').text('ChainGuard', { continued: true });
    doc.fontSize(12).font('Helvetica').fillColor('#666').text('  —  Compliance Revisionsspor', { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#888').text(`Genereret: ${new Date().toLocaleString('da-DK')}`);
    doc.text(`Bruger: ${userName} (${userEmail})`);
    doc.text(`Arkiveringspligt: 5 år jf. EU's kædeansvarsdirektiv`);
    doc.moveDown(1);

    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e0e0e0').stroke();
    doc.moveDown(1);

    // Leverandøroversigt
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#1a1a2e').text('Leverandøroversigt');
    doc.moveDown(0.5);

    if (suppliers.rows.length === 0) {
      doc.fontSize(10).font('Helvetica').fillColor('#888').text('Ingen leverandører registreret.');
    } else {
      suppliers.rows.forEach((s, i) => {
        const statusColor = s.status === 'compliant' ? '#00875A' : s.status === 'non-compliant' ? '#DE350B' : '#FF8B00';
        const statusLabel = s.status === 'compliant' ? 'Godkendt' : s.status === 'non-compliant' ? 'Ikke godkendt' : 'Afventer';
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#1a1a2e').text(`${i + 1}. ${s.name}`);
        doc.fontSize(9).font('Helvetica').fillColor('#555')
          .text(`CVR: ${s.cvr}  |  Branche: ${s.industry || '—'}  |  Adresse: ${s.address || '—'}`);
        doc.fontSize(9).fillColor(statusColor).text(`Status: ${statusLabel}`);
        if (s.notes) doc.fontSize(9).fillColor('#777').text(`Note: ${s.notes}`);
        doc.fontSize(8).fillColor('#aaa')
          .text(`Tilføjet: ${new Date(s.added_at).toLocaleString('da-DK')}  |  Opdateret: ${new Date(s.updated_at).toLocaleString('da-DK')}`);
        doc.moveDown(0.6);
      });
    }

    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e0e0e0').stroke();
    doc.moveDown(1);

    // Audit log
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#1a1a2e').text('Revisionsspor (tidsstemplet)');
    doc.moveDown(0.5);

    if (auditLog.rows.length === 0) {
      doc.fontSize(10).font('Helvetica').fillColor('#888').text('Ingen handlinger registreret endnu.');
    } else {
      auditLog.rows.forEach(entry => {
        const ts = new Date(entry.created_at).toLocaleString('da-DK');
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#333')
          .text(`${ts}  —  ${entry.action}`, { continued: true });
        doc.font('Helvetica').fillColor('#555')
          .text(`  (${entry.supplier_name || '—'}, CVR: ${entry.cvr || '—'})`);
        if (entry.details) doc.fontSize(8).fillColor('#888').text(`  ${entry.details}`);
        doc.moveDown(0.3);
      });
    }

    // Footer
    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e0e0e0').stroke();
    doc.moveDown(0.5);
    doc.fontSize(8).fillColor('#aaa').text(
      `Dette dokument er genereret automatisk af ChainGuard og indeholder et tidsstemplet revisionsspor. ` +
      `Dokumentet opfylder kravene til kædeansvarsdokumentation jf. EU-direktiv 2022/2464 og den danske lov om kædeansvar. ` +
      `Opbevaringspligt: minimum 5 år. Arkiveret: ${new Date().toLocaleString('da-DK')}`,
      { align: 'center' }
    );

    doc.end();
  });
}

// Compliance arkiv: send rapport via email + gem i DB
app.post('/api/compliance/send-report', requireAuth, async (req, res) => {
  const { archiveEmail } = req.body;
  const targetEmail = archiveEmail || (await pool.query('SELECT archive_email FROM users WHERE id=$1', [req.user.id])).rows[0]?.archive_email;

  if (!targetEmail) {
    return res.status(400).json({ error: 'Ingen arkiv-email konfigureret. Gem en arkiv-email i Indstillinger.' });
  }

  try {
    const { buffer, suppliersCount, auditEntries } = await generateCompliancePDF(req.user.id, req.user.name, req.user.email);
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `chainguard-compliance-${dateStr}.pdf`;

    // Gem i database (5-års arkiv)
    const archiveResult = await pool.query(
      `INSERT INTO compliance_archive (user_id, sent_to, filename, pdf_data, suppliers_count, audit_entries, trigger_type)
       VALUES ($1,$2,$3,$4,$5,$6,'manual') RETURNING id`,
      [req.user.id, targetEmail, filename, buffer, suppliersCount, auditEntries]
    );

    // Send via Resend
    const resend = getResend();
    let emailSentOk = false;
    let emailError = null;
    if (resend) {
      const result = await resend.emails.send({
        from: 'ChainGuard Compliance <onboarding@resend.dev>',
        to: [targetEmail],
        subject: `ChainGuard Compliance Rapport — ${new Date().toLocaleDateString('da-DK')}`,
        text: `Kære arkivmodtager,\n\nVedhæftet finder du ChainGuard compliance revisionsspor genereret ${new Date().toLocaleString('da-DK')}.\n\nRapporten indeholder:\n- ${suppliersCount} leverandør(er)\n- ${auditEntries} revisionsposter\n\nDokumentet er arkiveret i databasen jf. 5-års opbevaringskrav.\n\n— ChainGuard`,
        attachments: [{ filename, content: buffer.toString('base64'), contentType: 'application/pdf' }]
      });
      if (result.error) {
        emailError = result.error.message || JSON.stringify(result.error);
        console.error('Resend fejl:', emailError);
      } else {
        emailSentOk = true;
      }
    }

    // Log i audit_log
    await pool.query(
      'INSERT INTO audit_log (user_id, action, details) VALUES ($1,$2,$3)',
      [req.user.id, 'RAPPORT ARKIVERET', `Sendt til ${targetEmail} — ${suppliersCount} leverandører, ${auditEntries} poster`]
    );

    res.json({
      ok: true,
      archiveId: archiveResult.rows[0].id,
      sentTo: targetEmail,
      filename,
      suppliersCount,
      auditEntries,
      emailSent: emailSentOk,
      emailError: emailError
    });
  } catch (e) {
    console.error('Arkivering fejl:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Hent compliance arkiv-liste
app.get('/api/compliance/archive', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, sent_at, sent_to, filename, suppliers_count, audit_entries, trigger_type, status
       FROM compliance_archive WHERE user_id = $1
       ORDER BY sent_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Download arkiveret PDF
app.get('/api/compliance/archive/:id/pdf', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT pdf_data, filename FROM compliance_archive WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).send('Ikke fundet');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${result.rows[0].filename}"`);
    res.send(result.rows[0].pdf_data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Gem/hent arkiv-email indstilling
app.post('/api/compliance/settings', requireAuth, async (req, res) => {
  const { archiveEmail } = req.body;
  try {
    await pool.query('UPDATE users SET archive_email=$1 WHERE id=$2', [archiveEmail, req.user.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/compliance/settings', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT archive_email FROM users WHERE id=$1', [req.user.id]);
    res.json({ archiveEmail: result.rows[0]?.archive_email || '' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Dokumenter API ──────────────────────────────────────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Tilføj file_data kolonne hvis den ikke findes
pool.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_data BYTEA`).catch(() => {});

function formatDoc(row) {
  return {
    id:          row.id,
    name:        row.name,
    meta:        `${row.type} · ${row.expiry ? 'Udløber ' + new Date(row.expiry).toLocaleDateString('da-DK') : 'Indsendt ' + new Date(row.uploaded_at).toLocaleDateString('da-DK')} · ${row.supplier_name || ''}`,
    type:        row.type,
    ext:         row.file_ref ? row.file_ref.split('.').pop() : '',
    statusClass: row.status === 'udløbet' ? 's-red' : row.status === 'gyldig' ? 's-green' : 's-amber',
    statusLabel: row.status === 'udløbet' ? 'Udløbet' : row.status === 'gyldig' ? 'Gyldig' : 'Afventer',
    size:        row.file_size || '',
    supplier_name: row.supplier_name || '',
    expiry:      row.expiry ? new Date(row.expiry).toISOString().split('T')[0] : null,
    uploadedAt:  row.uploaded_at,
    download_url: row.file_data ? `/api/documents/${row.id}/download` : null,
  };
}

app.get('/api/documents', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, type, status, expiry, uploaded_at, file_size, file_ref, supplier_name,
              (file_data IS NOT NULL) AS has_file
       FROM documents WHERE user_id=$1 ORDER BY uploaded_at DESC`,
      [req.user.id]
    );
    res.json(result.rows.map(row => ({
      ...formatDoc(row),
      download_url: row.has_file ? `/api/documents/${row.id}/download` : null,
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/documents/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const { type, supplier_name, expiry, note } = req.body;
    const file = req.file;
    const name = file ? `${type || 'Dokument'} — ${supplier_name || ''}` : (req.body.name || 'Dokument');
    const fileSize = file ? (file.size > 1024 * 1024
      ? (file.size / (1024 * 1024)).toFixed(1) + ' MB'
      : Math.round(file.size / 1024) + ' KB') : '';
    const fileRef = file ? file.originalname : null;
    const fileData = file ? file.buffer : null;

    // Beregn status baseret på udløbsdato
    let status = 'gyldig';
    if (expiry && new Date(expiry) < new Date()) status = 'udløbet';

    const result = await pool.query(
      `INSERT INTO documents (user_id, supplier_name, name, type, status, expiry, file_size, file_ref, file_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user.id, supplier_name || null, name, type || 'Andet', status,
       expiry || null, fileSize, fileRef, fileData]
    );

    await pool.query(
      'INSERT INTO audit_log (user_id, action, details) VALUES ($1,$2,$3)',
      [req.user.id, 'DOKUMENT UPLOADET', `${name} (${type}) — ${supplier_name || '—'}`]
    );

    res.json(formatDoc(result.rows[0]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/documents/:id/download', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT file_data, file_ref, name FROM documents WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!result.rows[0] || !result.rows[0].file_data) return res.status(404).send('Ikke fundet');
    const { file_data, file_ref, name } = result.rows[0];
    res.setHeader('Content-Disposition', `attachment; filename="${file_ref || name}"`);
    res.send(file_data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/documents/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM documents WHERE id=$1 AND user_id=$2 RETURNING name',
      [req.params.id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Ikke fundet' });
    await pool.query(
      'INSERT INTO audit_log (user_id, action, details) VALUES ($1,$2,$3)',
      [req.user.id, 'DOKUMENT SLETTET', result.rows[0].name]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Afvigelser API ──────────────────────────────────────────

const DEV_TYPE_MAP = {
  critical:   { label: 'Kritisk',          typeClass: 'chip-red',   status: 'Åben',             statusClass: 's-red'   },
  open:       { label: 'Åben',             typeClass: 'chip-amber', status: 'Åben',             statusClass: 's-red'   },
  processing: { label: 'Under behandling', typeClass: 'chip-blue',  status: 'Under behandling', statusClass: 's-blue'  },
  closed:     { label: 'Lukket',           typeClass: 'chip-green', status: 'Lukket',           statusClass: 's-green' },
};

function formatDeviation(row) {
  const end = row.closed_at ? new Date(row.closed_at) : new Date();
  const daysOpen = Math.max(0, Math.round((end - new Date(row.created_at)) / 86400000));
  const metaParts = ['Registreret ' + new Date(row.created_at).toLocaleDateString('da-DK')];
  if (row.location) metaParts.push(row.location);
  if (row.supplier_name) metaParts.push(row.supplier_name);
  return {
    id:           row.id,
    title:        row.title,
    meta:         metaParts.join(' · '),
    body:         row.description || '',
    location:     row.location || '',
    supplierName: row.supplier_name || '',
    type:         row.type,
    typeLabel:    row.type_label,
    typeClass:    row.type_class,
    status:       row.status,
    statusClass:  row.status_class,
    daysOpen,
    closedAt:     row.closed_at,
    createdAt:    row.created_at,
  };
}

// GET /api/deviations — alle afvigelser for den loggede bruger
app.get('/api/deviations', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM deviations WHERE user_id=$1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(result.rows.map(formatDeviation));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/deviations — registrér ny afvigelse
app.post('/api/deviations', requireAuth, async (req, res) => {
  const { title, body, location, supplierName, type } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Titel er påkrævet.' });
  const t = DEV_TYPE_MAP[type] || DEV_TYPE_MAP.open;
  const typeVal = DEV_TYPE_MAP[type] ? type : 'open';
  try {
    // Slå leverandøren op så supplier_id kan sættes, hvis navnet matcher
    let supplierId = null;
    if (supplierName) {
      const sup = await pool.query('SELECT id FROM suppliers WHERE name=$1 AND user_id=$2', [supplierName, req.user.id]);
      supplierId = sup.rows[0] ? sup.rows[0].id : null;
    }
    const result = await pool.query(
      `INSERT INTO deviations (user_id, supplier_id, supplier_name, title, description, location, type, type_label, type_class, status, status_class)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.user.id, supplierId, supplierName || null, title.trim(), body || null, location || null,
       typeVal, t.label, t.typeClass, t.status, t.statusClass]
    );
    await pool.query(
      'INSERT INTO audit_log (user_id, supplier_id, action, details) VALUES ($1,$2,$3,$4)',
      [req.user.id, supplierId, 'AFVIGELSE REGISTRERET', `${title.trim()} (${t.label})`]
    );
    res.status(201).json(formatDeviation(result.rows[0]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/deviations/:id — håndtér/luk/genåbn eller opdatér felter
// Body: { action: 'handle' | 'close' | 'reopen' } eller direkte felter { title, body, location, type }
app.patch('/api/deviations/:id', requireAuth, async (req, res) => {
  const { action, title, body, location, type } = req.body;
  try {
    const cur = await pool.query('SELECT * FROM deviations WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'Ikke fundet' });
    const c = cur.rows[0];

    let newType = c.type, closedAt = c.closed_at, auditAction = null;
    if (action === 'handle') { newType = 'processing'; auditAction = 'AFVIGELSE HÅNDTERES'; }
    else if (action === 'close') { newType = 'closed'; closedAt = new Date(); auditAction = 'AFVIGELSE LUKKET'; }
    else if (action === 'reopen') { newType = 'open'; closedAt = null; auditAction = 'AFVIGELSE GENÅBNET'; }
    else if (type && DEV_TYPE_MAP[type]) { newType = type; }

    const t = DEV_TYPE_MAP[newType] || DEV_TYPE_MAP.open;
    const result = await pool.query(
      `UPDATE deviations SET
         title=$1, description=$2, location=$3,
         type=$4, type_label=$5, type_class=$6, status=$7, status_class=$8,
         closed_at=$9, updated_at=NOW()
       WHERE id=$10 AND user_id=$11 RETURNING *`,
      [title || c.title, body !== undefined ? body : c.description,
       location !== undefined ? location : c.location,
       newType, t.label, t.typeClass, t.status, t.statusClass,
       closedAt, req.params.id, req.user.id]
    );
    if (auditAction) {
      await pool.query(
        'INSERT INTO audit_log (user_id, supplier_id, action, details) VALUES ($1,$2,$3,$4)',
        [req.user.id, c.supplier_id, auditAction, c.title]
      );
    }
    res.json(formatDeviation(result.rows[0]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/deviations/:id
app.delete('/api/deviations/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM deviations WHERE id=$1 AND user_id=$2 RETURNING title',
      [req.params.id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Ikke fundet' });
    await pool.query(
      'INSERT INTO audit_log (user_id, action, details) VALUES ($1,$2,$3)',
      [req.user.id, 'AFVIGELSE SLETTET', result.rows[0].title]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Compliance-tjek API ─────────────────────────────────────
// Server-udgave af frontendens compliance-motor: 9 krav × alle leverandører.
// Dokument-status i DB ('gyldig'/'udløbet'/andet) mappes til ok/fail/warn.

function docState(doc) {
  if (!doc) return null;
  if (doc.status === 'udløbet') return 'fail';
  if (doc.status === 'gyldig') return 'ok';
  return 'warn';
}
function findDoc(docs, ...terms) {
  return docs.find(d => {
    const n = (d.name || '').toLowerCase() + ' ' + (d.type || '').toLowerCase();
    return terms.some(t => n.includes(t));
  });
}

const COMPLIANCE_REQS = [
  { id: 'insurance', label: 'Gyldig forsikring', category: 'Forsikring',
    check: (s, docs) => docState(findDoc(docs, 'forsikring')) || 'fail' },
  { id: 'contract', label: 'Underskrevet kontrakt', category: 'Kontrakt',
    check: (s, docs) => docState(findDoc(docs, 'kontrakt')) || 'fail' },
  { id: 'work_permit', label: 'Arbejdstilladelse (udenlandsk)', category: 'Lovkrav',
    check: (s, docs) => {
      if (s.country === 'Danmark') return 'ok';
      return docState(findDoc(docs, 'arbejdstilladelse', 'a1')) || 'fail';
    } },
  { id: 'esg', label: 'ESG due diligence-skema', category: 'ESG',
    check: (s, docs) => {
      if (s.risk !== 'high' && s.risk !== 'medium') return 'ok';
      return docState(findDoc(docs, 'esg')) || 'fail';
    } },
  { id: 'salary_doc', label: 'Løndokumentation', category: 'Løn',
    check: (s, docs) => {
      if (s.risk === 'low' && s.country === 'Danmark') return 'ok';
      const st = docState(findDoc(docs, 'løn', 'loen'));
      if (!st) return 'warn';
      return st === 'fail' ? 'fail' : 'ok';
    } },
  { id: 'cvr', label: 'CVR/registrering valideret', category: 'Lovkrav',
    check: (s) => {
      if (s.country !== 'Danmark') return 'ok';
      return (s.cvr && s.cvr !== '—') ? 'ok' : 'fail';
    } },
  { id: 'rut', label: 'RUT-registrering', category: 'Lovkrav',
    check: (s) => {
      if (s.country === 'Danmark') return 'ok';
      return s.risk === 'high' ? 'fail' : 'warn';
    } },
  { id: 'risk_class', label: 'Risikoklassificering foretaget', category: 'Risiko',
    check: (s) => (s.risk ? 'ok' : 'fail') },
  { id: 'nemkonto', label: 'NemKonto verificeret', category: 'Bank',
    check: (s, docs, ctx) => nemkonto.toRequirementResult((ctx && ctx.nemkonto && ctx.nemkonto.status) || 'grey') },
  { id: 'payroll_check', label: 'Lønkontrol uden kritiske afvigelser', category: 'Løn',
    check: (s, docs, ctx) => {
      const p = ctx && ctx.payroll;
      if (!p) return 'warn';                       // ingen lønperiode indlæst endnu
      if (p.status === 'red') return 'fail';
      if (p.status === 'green') return 'ok';
      return 'warn';
    } },
  { id: 'sanction', label: 'Sanktions- og PEP-screening', category: 'Screening',
    check: (s) => {
      if (s.status === 'Blokeret') return 'fail';
      if (s.country === 'Danmark' && s.risk === 'low') return 'ok';
      return 'warn';
    } },
];

// Samler NemKonto- og lønstatus pr. leverandør, så compliance-tjekket kan
// bedømme betalings- og lønforholdene sammen med den øvrige dokumentation.
async function complianceContext(userId) {
  const accounts = await pool.query(
    `SELECT * FROM supplier_accounts WHERE user_id=$1 ORDER BY supplier_id, valid_from DESC, id DESC`,
    [userId]
  );
  const employees = await pool.query(
    'SELECT supplier_id, pseudonym, bank_hash FROM payroll_employees WHERE user_id=$1', [userId]
  );
  // Seneste lønperiode pr. leverandør med totaler og antal afvigelser
  const periods = await pool.query(
    `SELECT DISTINCT ON (p.supplier_id)
            p.id, p.supplier_id, p.period_start, p.period_end, p.status, p.status_class,
            p.checked_at, p.ruleset_version,
            (SELECT COUNT(*) FROM payroll_lines l WHERE l.period_id = p.id) AS employees,
            (SELECT COALESCE(SUM(l.net), 0) FROM payroll_lines l WHERE l.period_id = p.id) AS total_net,
            (SELECT COALESCE(SUM(l.bank_paid), 0) FROM payroll_lines l WHERE l.period_id = p.id) AS total_paid,
            (SELECT COUNT(*) FROM payroll_deviations d
              WHERE d.period_id = p.id AND d.superseded = FALSE AND d.resolved_at IS NULL) AS open_deviations,
            (SELECT COUNT(*) FROM payroll_deviations d
              WHERE d.period_id = p.id AND d.superseded = FALSE AND d.resolved_at IS NULL
                AND d.severity = 'critical') AS critical_deviations
       FROM payroll_periods p
      WHERE p.user_id=$1
      ORDER BY p.supplier_id, p.period_start DESC, p.id DESC`,
    [userId]
  );
  const payouts = await pool.query(
    `SELECT p.supplier_id, l.paid_from_hash, l.paid_from_last4
       FROM payroll_lines l JOIN payroll_periods p ON p.id = l.period_id
      WHERE l.user_id=$1 AND l.paid_from_hash IS NOT NULL`,
    [userId]
  );

  const by = (rows, key) => rows.reduce((m, r) => {
    (m[r[key]] = m[r[key]] || []).push(r); return m;
  }, {});

  return {
    accounts: by(accounts.rows, 'supplier_id'),
    employees: by(employees.rows, 'supplier_id'),
    payouts: by(payouts.rows, 'supplier_id'),
    periods: periods.rows.reduce((m, r) => { m[r.supplier_id] = r; return m; }, {}),
  };
}

// Kører NemKonto-kontrollen for én leverandør
function nemkontoFor(supplier, ctx) {
  const all = ctx.accounts[supplier.id] || [];
  const active = all.filter(a => a.kind === 'nemkonto' && a.active);
  const account = active[0] || null;
  const invoiceAccount = all.find(a => a.kind === 'invoice' && a.active) || null;

  const check = nemkonto.runCheck({
    account,
    history: all.filter(a => a.kind === 'nemkonto'),
    supplierName: supplier.name,
    invoiceAccount,
    employees: ctx.employees[supplier.id] || [],
    payouts: ctx.payouts[supplier.id] || [],
  });

  const meta = nemkonto.STATUS_META[check.status];
  return {
    regNo: account ? account.reg_no : null,
    last4: account ? account.account_last4 : null,
    holderName: account ? account.holder_name : null,
    verified: account ? account.verified : false,
    verifiedSource: account ? account.verified_source : null,
    verifiedAt: account ? account.verified_at : null,
    validFrom: account ? account.valid_from : null,
    changes: all.filter(a => a.kind === 'nemkonto').length,
    status: check.status,
    statusLabel: meta.label,
    statusClass: meta.cls,
    deviations: check.deviations,
  };
}

// Lønstatus for compliance-siden. Beløb maskeres for hovedvirksomheden.
function payrollFor(supplier, ctx, view) {
  const p = ctx.periods[supplier.id];
  if (!p) return null;
  const meta = payroll.STATUS_META[p.status] || payroll.STATUS_META.grey;
  const masked = view === 'main';
  return {
    periodId: p.id,
    periodStart: p.period_start,
    periodEnd: p.period_end,
    status: p.status,
    statusLabel: meta.label,
    statusClass: meta.cls,
    checkedAt: p.checked_at,
    rulesetVersion: p.ruleset_version,
    employees: Number(p.employees),
    openDeviations: Number(p.open_deviations),
    criticalDeviations: Number(p.critical_deviations),
    totalNet: masked ? null : Number(p.total_net),
    totalPaid: masked ? null : Number(p.total_paid),
    allPaid: Number(p.total_paid) > 0 && Math.abs(Number(p.total_net) - Number(p.total_paid)) <= 1,
    masked,
  };
}

async function runComplianceForUser(userId, view) {
  const supRes = await pool.query('SELECT * FROM suppliers WHERE user_id=$1 ORDER BY name', [userId]);
  const docRes = await pool.query('SELECT name, type, status, supplier_name FROM documents WHERE user_id=$1', [userId]);

  const docsBySupplier = {};
  docRes.rows.forEach(d => {
    const key = d.supplier_name || '';
    (docsBySupplier[key] = docsBySupplier[key] || []).push(d);
  });

  const ctx = await complianceContext(userId);
  const results = {};
  const details = {};

  supRes.rows.forEach(s => {
    const docs = docsBySupplier[s.name] || [];
    const supplierCtx = { nemkonto: nemkontoFor(s, ctx), payroll: payrollFor(s, ctx, view) };
    details[s.id] = supplierCtx;
    results[s.id] = {};
    COMPLIANCE_REQS.forEach(r => { results[s.id][r.id] = r.check(s, docs, supplierCtx); });
  });

  return { suppliers: supRes.rows, results, details };
}

// POST /api/compliance/check — kør fuldt tjek, gem resultater, returnér per leverandør
app.post('/api/compliance/check', requireAuth, async (req, res) => {
  try {
    const view = resolveView(req);
    const { suppliers, results, details } = await runComplianceForUser(req.user.id, view);

    // Erstat tidligere resultater med det nye kørselsresultat
    await pool.query('DELETE FROM compliance_results WHERE user_id=$1', [req.user.id]);
    for (const s of suppliers) {
      for (const r of COMPLIANCE_REQS) {
        await pool.query(
          `INSERT INTO compliance_results (user_id, supplier_id, req_id, req_label, result)
           VALUES ($1,$2,$3,$4,$5)`,
          [req.user.id, s.id, r.id, r.label, results[s.id][r.id]]
        );
      }
    }

    await pool.query(
      'INSERT INTO audit_log (user_id, action, details) VALUES ($1,$2,$3)',
      [req.user.id, 'COMPLIANCE-TJEK KØRT', `${suppliers.length} leverandører × ${COMPLIANCE_REQS.length} krav`]
    );

    res.json({
      lastRun: new Date().toISOString(),
      view,
      requirements: COMPLIANCE_REQS.map(r => ({ id: r.id, label: r.label, category: r.category })),
      suppliers: suppliers.map(s => ({ id: s.id, name: s.name, country: s.country, risk: s.risk })),
      results,
      details,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/compliance/results — seneste gemte kørsel
app.get('/api/compliance/results', requireAuth, async (req, res) => {
  const view = resolveView(req);
  try {
    const rows = await pool.query(
      `SELECT cr.supplier_id, cr.req_id, cr.result, cr.checked_at, s.name, s.country, s.risk
       FROM compliance_results cr JOIN suppliers s ON s.id = cr.supplier_id
       WHERE cr.user_id=$1`,
      [req.user.id]
    );
    if (!rows.rows.length) return res.json({ lastRun: null, view, requirements: COMPLIANCE_REQS.map(r => ({ id: r.id, label: r.label, category: r.category })), suppliers: [], results: {}, details: {} });

    const results = {};
    const suppliersById = {};
    let lastRun = null;
    rows.rows.forEach(r => {
      (results[r.supplier_id] = results[r.supplier_id] || {})[r.req_id] = r.result;
      suppliersById[r.supplier_id] = { id: r.supplier_id, name: r.name, country: r.country, risk: r.risk };
      if (!lastRun || new Date(r.checked_at) > new Date(lastRun)) lastRun = r.checked_at;
    });
    // NemKonto- og lønstatus beregnes ved opslag, så siden viser den aktuelle
    // tilstand og ikke et fastfrosset øjebliksbillede fra sidste kørsel.
    const live = await runComplianceForUser(req.user.id, view);
    Object.keys(results).forEach(id => {
      if (!live.results[id]) return;
      results[id].nemkonto = live.results[id].nemkonto;
      results[id].payroll_check = live.results[id].payroll_check;
    });

    res.json({
      lastRun,
      view,
      requirements: COMPLIANCE_REQS.map(r => ({ id: r.id, label: r.label, category: r.category })),
      suppliers: Object.values(suppliersById),
      results,
      details: live.details,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Lærlinge API (sync-model) ───────────────────────────────
// Frontenden ejer objektformatet og syncer hele registret; backend gemmer
// objektet i JSONB + udtrukne kolonner til CSV-eksport og rapporter.

const APPRENTICE_TYPE_LABELS = { eud: 'EUD', eux: 'EUX', adult: 'Voksenlærling', intern: 'Praktikant' };

// GET /api/apprentices — hele registret for den loggede bruger
app.get('/api/apprentices', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT data FROM apprentices WHERE user_id=$1 AND data IS NOT NULL ORDER BY created_at ASC',
      [req.user.id]
    );
    res.json(result.rows.map(r => r.data));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/apprentices/sync — upsert hele registret; rækker der ikke længere findes, slettes
app.put('/api/apprentices/sync', requireAuth, async (req, res) => {
  const list = req.body && Array.isArray(req.body.apprentices) ? req.body.apprentices : null;
  if (!list) return res.status(400).json({ error: 'apprentices skal være en liste.' });
  try {
    const clientIds = list.map(a => String(a.id)).filter(Boolean);
    if (clientIds.length) {
      await pool.query(
        'DELETE FROM apprentices WHERE user_id=$1 AND (client_id IS NULL OR NOT (client_id = ANY($2)))',
        [req.user.id, clientIds]
      );
    } else {
      await pool.query('DELETE FROM apprentices WHERE user_id=$1', [req.user.id]);
    }

    // supplierId fra frontend kan pege på demo-data — sæt kun FK når leverandøren findes i DB
    const supRows = await pool.query('SELECT id FROM suppliers WHERE user_id=$1', [req.user.id]);
    const validSupIds = new Set(supRows.rows.map(r => r.id));

    for (const a of list) {
      if (!a.id) continue;
      const statusLabel = a.status === 'confirmed' ? 'Bekræftet' : a.status === 'expired' ? 'Udløbet' : 'Afventer';
      await pool.query(
        `INSERT INTO apprentices (user_id, client_id, supplier_id, supplier_name, name, type, type_label, education, start_date, end_date, status, data, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
         ON CONFLICT (user_id, client_id) DO UPDATE SET
           supplier_id=EXCLUDED.supplier_id, supplier_name=EXCLUDED.supplier_name,
           name=EXCLUDED.name, type=EXCLUDED.type, type_label=EXCLUDED.type_label,
           education=EXCLUDED.education, start_date=EXCLUDED.start_date, end_date=EXCLUDED.end_date,
           status=EXCLUDED.status, data=EXCLUDED.data, updated_at=NOW()`,
        [req.user.id, String(a.id),
         validSupIds.has(a.supplierId) ? a.supplierId : null,
         a.supplierName || null, a.name || null, a.type || null,
         APPRENTICE_TYPE_LABELS[a.type] || a.type || null,
         a.education || null, a.startDate || null, a.endDate || null,
         statusLabel, JSON.stringify(a)]
      );
    }
    res.json({ ok: true, count: list.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Lønkontrol API ──────────────────────────────────────────
// Sammenholder tidsregistrering, lønsystem, indberetning og bank pr.
// medarbejder. Regelmotoren ligger i payroll.js.

// Hovedvirksomheden ser kontrolresultatet, ikke lønsedlen. Data tilhører den
// bruger, der er logget ind, så 'main' er en visning af, hvad en kunde ville
// få udleveret — den reelle adskillelse mellem hovedvirksomhed og leverandør
// kræver rollemodellen fra specifikationens afsnit 2.
function resolveView(req) {
  const v = String(req.query.view || '').toLowerCase();
  return ['main', 'supplier', 'controller'].includes(v) ? v : 'supplier';
}

async function ownPeriod(periodId, userId) {
  const r = await pool.query(
    `SELECT p.*, s.name AS supplier_name, s.country, c.name AS case_name
       FROM payroll_periods p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN cases c     ON c.id = p.case_id
      WHERE p.id=$1 AND p.user_id=$2`,
    [periodId, userId]
  );
  return r.rows[0] || null;
}

async function periodLines(periodId) {
  const r = await pool.query(
    `SELECT l.*, e.pseudonym, e.employee_ref, e.job_group, e.employed_from,
            e.employed_to, e.bank_last4, e.bank_hash
       FROM payroll_lines l
       JOIN payroll_employees e ON e.id = l.employee_id
      WHERE l.period_id=$1
      ORDER BY e.pseudonym`,
    [periodId]
  );
  return r.rows;
}

// Find det regelsæt, der gjaldt i lønperioden — ikke det, der gælder i dag.
async function rulesetFor(period, userId) {
  if (period.ruleset_id) {
    const r = await pool.query('SELECT * FROM payroll_rulesets WHERE id=$1 AND user_id=$2', [period.ruleset_id, userId]);
    if (r.rows[0]) return r.rows[0];
  }
  const r = await pool.query(
    `SELECT * FROM payroll_rulesets
      WHERE user_id=$1 AND valid_from <= $2 AND (valid_to IS NULL OR valid_to >= $2)
      ORDER BY valid_from DESC LIMIT 1`,
    [userId, period.period_end]
  );
  return r.rows[0] || null;
}

function formatPeriod(row, extra = {}) {
  const meta = payroll.STATUS_META[row.status] || payroll.STATUS_META.grey;
  return {
    id: row.id,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name || '—',
    caseId: row.case_id,
    caseName: row.case_name || null,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    payoutDate: row.payout_date,
    source: row.source,
    rulesetVersion: row.ruleset_version,
    status: row.status,
    statusLabel: meta.label,
    statusClass: meta.cls,
    checkedAt: row.checked_at,
    importedAt: row.imported_at,
    ...extra,
  };
}

// GET /api/payroll/periods — alle lønperioder, evt. filtreret på leverandør
app.get('/api/payroll/periods', requireAuth, async (req, res) => {
  try {
    const params = [req.user.id];
    let where = 'p.user_id=$1';
    if (req.query.supplierId) { params.push(req.query.supplierId); where += ` AND p.supplier_id=$${params.length}`; }
    const result = await pool.query(
      `SELECT p.*, s.name AS supplier_name, c.name AS case_name,
              (SELECT COUNT(*) FROM payroll_lines l WHERE l.period_id = p.id) AS employees,
              (SELECT COUNT(*) FROM payroll_deviations d
                WHERE d.period_id = p.id AND d.superseded = FALSE AND d.resolved_at IS NULL) AS open_deviations,
              (SELECT COUNT(*) FROM payroll_deviations d
                WHERE d.period_id = p.id AND d.superseded = FALSE AND d.resolved_at IS NULL
                  AND d.severity = 'critical') AS critical_deviations
         FROM payroll_periods p
         LEFT JOIN suppliers s ON s.id = p.supplier_id
         LEFT JOIN cases c     ON c.id = p.case_id
        WHERE ${where}
        ORDER BY p.period_start DESC, p.id DESC`,
      params
    );
    res.json(result.rows.map(r => formatPeriod(r, {
      employees: Number(r.employees),
      openDeviations: Number(r.open_deviations),
      criticalDeviations: Number(r.critical_deviations),
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/payroll/periods — opret lønperiode
app.post('/api/payroll/periods', requireAuth, async (req, res) => {
  const { supplierId, caseId, periodStart, periodEnd, payoutDate, source, rulesetId } = req.body;
  if (!supplierId)  return res.status(400).json({ error: 'Leverandør er påkrævet.' });
  if (!periodStart || !periodEnd) return res.status(400).json({ error: 'Lønperiodens start og slut er påkrævet.' });
  if (new Date(periodEnd) < new Date(periodStart)) {
    return res.status(400).json({ error: 'Lønperioden slutter før den begynder.' });
  }
  try {
    const sup = await pool.query('SELECT id FROM suppliers WHERE id=$1 AND user_id=$2', [supplierId, req.user.id]);
    if (!sup.rows[0]) return res.status(404).json({ error: 'Leverandøren blev ikke fundet.' });

    let rulesetVersion = null;
    if (rulesetId) {
      const rs = await pool.query('SELECT version FROM payroll_rulesets WHERE id=$1 AND user_id=$2', [rulesetId, req.user.id]);
      rulesetVersion = rs.rows[0] ? rs.rows[0].version : null;
    }

    const result = await pool.query(
      `INSERT INTO payroll_periods
         (user_id, supplier_id, case_id, period_start, period_end, payout_date, source, ruleset_id, ruleset_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user.id, supplierId, caseId || null, periodStart, periodEnd, payoutDate || null,
       source || 'csv', rulesetId || null, rulesetVersion]
    );
    await pool.query(
      'INSERT INTO audit_log (user_id, supplier_id, action, details) VALUES ($1,$2,$3,$4)',
      [req.user.id, supplierId, 'payroll_period_created', `Lønperiode ${periodStart} – ${periodEnd} oprettet`]
    );
    res.json(formatPeriod({ ...result.rows[0], supplier_name: null }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/payroll/periods/:id — lønperiode med linjer og afvigelser
app.get('/api/payroll/periods/:id', requireAuth, async (req, res) => {
  const view = resolveView(req);
  try {
    const period = await ownPeriod(req.params.id, req.user.id);
    if (!period) return res.status(404).json({ error: 'Lønperioden blev ikke fundet.' });

    const lines = await periodLines(period.id);
    const devs = await pool.query(
      `SELECT d.*, e.pseudonym FROM payroll_deviations d
         LEFT JOIN payroll_employees e ON e.id = d.employee_id
        WHERE d.period_id=$1 AND d.superseded = FALSE
        ORDER BY CASE d.severity WHEN 'critical' THEN 0 ELSE 1 END, d.id`,
      [period.id]
    );
    const ruleset = await rulesetFor(period, req.user.id);

    const byLine = new Map();
    for (const d of devs.rows) {
      if (!byLine.has(d.line_id)) byLine.set(d.line_id, []);
      byLine.get(d.line_id).push(d.code);
    }

    res.json({
      period: formatPeriod(period),
      view,
      ruleset: ruleset
        ? { id: ruleset.id, name: ruleset.name, version: ruleset.version, basis: ruleset.basis,
            minHourly: ruleset.min_hourly, source: ruleset.source }
        : { name: payroll.DEFAULT_RULESET.name, version: payroll.DEFAULT_RULESET.version, basis: 'contract',
            minHourly: null, source: payroll.DEFAULT_RULESET.source },
      lines: lines.map(l => {
        const masked = payroll.maskLine(l, view);
        const meta = payroll.STATUS_META[l.status] || payroll.STATUS_META.grey;
        return {
          id: l.id,
          employeeId: l.employee_id,
          pseudonym: l.pseudonym,
          employeeRef: view === 'main' ? null : l.employee_ref,
          jobGroup: l.job_group,
          employedFrom: l.employed_from,
          hoursNormal: Number(l.hours_normal || 0),
          hoursOvertime: Number(l.hours_overtime || 0),
          gross: masked.gross, net: masked.net, supplement: masked.supplement,
          pension: masked.pension, holidayPay: masked.holiday_pay,
          hourlyRate: masked.hourly_rate,
          bankLast4: masked.bank_last4,
          bankPaid: masked.bank_paid,
          bankPaidAt: l.bank_paid_at,
          netPaid: masked.masked ? masked.net_paid : (l.bank_paid != null && Number(l.bank_paid) > 0),
          inPayroll: l.in_payroll,
          reported: l.reported,
          onProject: l.on_project,
          masked: !!masked.masked,
          status: l.status,
          statusLabel: meta.label,
          statusClass: meta.cls,
          codes: byLine.get(l.id) || [],
        };
      }),
      deviations: devs.rows.map(d => ({
        id: d.id, code: d.code, label: d.label, detail: payroll.maskDetail(d.detail, view), severity: d.severity,
        pseudonym: d.pseudonym, lineId: d.line_id, rulesetVersion: d.ruleset_version,
        checkedAt: d.checked_at, resolvedAt: d.resolved_at, resolvedBy: d.resolved_by,
        resolution: d.resolution,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/payroll/periods/:id/import — indlæs løndata fra CSV
app.post('/api/payroll/periods/:id/import', requireAuth, async (req, res) => {
  const csv = req.body && req.body.csv;
  if (!csv || !String(csv).trim()) return res.status(400).json({ error: 'Ingen data at indlæse.' });
  try {
    const period = await ownPeriod(req.params.id, req.user.id);
    if (!period) return res.status(404).json({ error: 'Lønperioden blev ikke fundet.' });

    const { rows, errors } = payroll.parseCSV(csv);
    if (!rows.length) {
      return res.status(400).json({ error: errors[0] || 'Filen indeholder ingen brugbare rækker.', errors });
    }

    let created = 0;
    for (const row of rows) {
      // Medarbejderen får et pseudonym ved første import og beholder det.
      const existing = await pool.query(
        'SELECT id, pseudonym FROM payroll_employees WHERE supplier_id=$1 AND employee_ref=$2',
        [period.supplier_id, row.employee_ref]
      );
      let employeeId, pseudonym;
      if (existing.rows[0]) {
        employeeId = existing.rows[0].id;
        pseudonym  = existing.rows[0].pseudonym;
        await pool.query(
          `UPDATE payroll_employees
              SET job_group=COALESCE($1, job_group), employed_from=COALESCE($2, employed_from),
                  employed_to=COALESCE($3, employed_to), bank_last4=COALESCE($4, bank_last4),
                  bank_hash=COALESCE($5, bank_hash), updated_at=NOW()
            WHERE id=$6`,
          [row.job_group, row.employed_from, row.employed_to, row.bank_last4, row.bank_hash, employeeId]
        );
      } else {
        const seq = await pool.query(
          'SELECT COUNT(*)::int AS n FROM payroll_employees WHERE supplier_id=$1', [period.supplier_id]
        );
        pseudonym = 'MA-' + String(1000 + seq.rows[0].n + 1);
        const ins = await pool.query(
          `INSERT INTO payroll_employees
             (user_id, supplier_id, pseudonym, employee_ref, job_group, employed_from, employed_to, bank_last4, bank_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [req.user.id, period.supplier_id, pseudonym, row.employee_ref, row.job_group,
           row.employed_from, row.employed_to, row.bank_last4, row.bank_hash]
        );
        employeeId = ins.rows[0].id;
        created++;
      }

      await pool.query(
        `INSERT INTO payroll_lines
           (user_id, period_id, employee_id, hours_normal, hours_overtime, hourly_rate, gross, net,
            supplement, pension, holiday_pay, in_payroll, reported, reported_amount, bank_paid, bank_paid_at,
            on_project, paid_from_hash, paid_from_last4)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (period_id, employee_id) DO UPDATE SET
           hours_normal=EXCLUDED.hours_normal, hours_overtime=EXCLUDED.hours_overtime,
           hourly_rate=EXCLUDED.hourly_rate, gross=EXCLUDED.gross, net=EXCLUDED.net,
           supplement=EXCLUDED.supplement, pension=EXCLUDED.pension, holiday_pay=EXCLUDED.holiday_pay,
           in_payroll=EXCLUDED.in_payroll, reported=EXCLUDED.reported,
           reported_amount=EXCLUDED.reported_amount, bank_paid=EXCLUDED.bank_paid,
           bank_paid_at=EXCLUDED.bank_paid_at, on_project=EXCLUDED.on_project,
           paid_from_hash=EXCLUDED.paid_from_hash, paid_from_last4=EXCLUDED.paid_from_last4`,
        [req.user.id, period.id, employeeId, row.hours_normal || 0, row.hours_overtime || 0,
         row.hourly_rate, row.gross, row.net, row.supplement || 0, row.pension || 0, row.holiday_pay || 0,
         row.in_payroll, row.reported, row.reported_amount, row.bank_paid, row.bank_paid_at, row.on_project,
         row.paid_from_hash || null, row.paid_from_last4 || null]
      );
    }

    await pool.query(
      'INSERT INTO audit_log (user_id, supplier_id, action, details) VALUES ($1,$2,$3,$4)',
      [req.user.id, period.supplier_id, 'payroll_import',
       `${rows.length} lønlinjer indlæst for perioden ${period.period_start} – ${period.period_end}`]
    );

    res.json({ ok: true, imported: rows.length, newEmployees: created, warnings: errors });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/payroll/periods/:id/check — kør lønkontrollen
app.post('/api/payroll/periods/:id/check', requireAuth, async (req, res) => {
  try {
    const period = await ownPeriod(req.params.id, req.user.id);
    if (!period) return res.status(404).json({ error: 'Lønperioden blev ikke fundet.' });

    const lines = await periodLines(period.id);
    if (!lines.length) return res.status(400).json({ error: 'Der er ingen løndata at kontrollere. Indlæs lønperioden først.' });

    const ruleset = await rulesetFor(period, req.user.id);
    const result = payroll.runCheck(period, lines, ruleset);
    const version = result.ruleset.version;

    // Historiske resultater ændres aldrig — de markeres som afløst.
    await pool.query(
      'UPDATE payroll_deviations SET superseded=TRUE WHERE period_id=$1 AND superseded=FALSE',
      [period.id]
    );
    for (const d of result.deviations) {
      await pool.query(
        `INSERT INTO payroll_deviations
           (user_id, period_id, line_id, employee_id, code, label, detail, severity, ruleset_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [req.user.id, period.id, d.line_id, d.employee_id, d.code, d.label, d.detail, d.severity, version]
      );
    }
    for (const [lineId, status] of result.lineStatus) {
      const meta = payroll.STATUS_META[status];
      await pool.query('UPDATE payroll_lines SET status=$1, status_class=$2 WHERE id=$3', [status, meta.cls, lineId]);
    }

    const meta = payroll.STATUS_META[result.status];
    await pool.query(
      `UPDATE payroll_periods SET status=$1, status_class=$2, ruleset_version=$3, checked_at=NOW() WHERE id=$4`,
      [result.status, meta.cls, version, period.id]
    );

    const critical = result.deviations.filter(d => d.severity === 'critical').length;
    await pool.query(
      'INSERT INTO audit_log (user_id, supplier_id, action, details) VALUES ($1,$2,$3,$4)',
      [req.user.id, period.supplier_id, 'payroll_check',
       `Lønkontrol kørt med regelversion ${version}: ${meta.label}, ${result.deviations.length} afvigelser (${critical} kritiske)`]
    );

    res.json({
      ok: true,
      status: result.status,
      statusLabel: meta.label,
      statusClass: meta.cls,
      rulesetVersion: version,
      employees: lines.length,
      deviations: result.deviations.length,
      critical,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/payroll/deviations/:id — markér en afvigelse som behandlet
app.patch('/api/payroll/deviations/:id', requireAuth, async (req, res) => {
  const { resolution } = req.body || {};
  if (!resolution || !String(resolution).trim()) {
    return res.status(400).json({ error: 'En begrundelse er påkrævet, før afvigelsen kan lukkes.' });
  }
  try {
    const result = await pool.query(
      `UPDATE payroll_deviations
          SET resolved_at=NOW(), resolved_by=$1, resolution=$2
        WHERE id=$3 AND user_id=$4 AND superseded=FALSE AND resolved_at IS NULL
        RETURNING *`,
      [req.user.name || req.user.email, String(resolution).trim(), req.params.id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Afvigelsen blev ikke fundet eller er allerede behandlet.' });

    // Statussen genberegnes ud fra de afvigelser, der stadig er åbne.
    const dev = result.rows[0];
    const remaining = await pool.query(
      `SELECT severity FROM payroll_deviations
        WHERE period_id=$1 AND superseded=FALSE AND resolved_at IS NULL`,
      [dev.period_id]
    );
    const lines = await periodLines(dev.period_id);
    const status = payroll.rollup(remaining.rows, lines);
    const meta = payroll.STATUS_META[status];
    await pool.query('UPDATE payroll_periods SET status=$1, status_class=$2 WHERE id=$3',
      [status, meta.cls, dev.period_id]);

    await pool.query(
      'INSERT INTO audit_log (user_id, action, details) VALUES ($1,$2,$3)',
      [req.user.id, 'payroll_deviation_resolved', `${dev.code} lukket: ${String(resolution).trim()}`]
    );
    res.json({ ok: true, status, statusLabel: meta.label, statusClass: meta.cls });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/payroll/periods/:id — fjern lønperiode med linjer og afvigelser
app.delete('/api/payroll/periods/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM payroll_periods WHERE id=$1 AND user_id=$2 RETURNING supplier_id, period_start, period_end',
      [req.params.id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Lønperioden blev ikke fundet.' });
    const row = result.rows[0];
    await pool.query(
      'INSERT INTO audit_log (user_id, supplier_id, action, details) VALUES ($1,$2,$3,$4)',
      [req.user.id, row.supplier_id, 'payroll_period_deleted', `Lønperiode ${row.period_start} – ${row.period_end} slettet`]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/payroll/rulesets — regelbibliotek
app.get('/api/payroll/rulesets', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM payroll_rulesets WHERE user_id=$1 ORDER BY valid_from DESC, id DESC', [req.user.id]
    );
    res.json(result.rows.map(r => ({
      id: r.id, name: r.name, version: r.version, basis: r.basis, jobGroup: r.job_group,
      validFrom: r.valid_from, validTo: r.valid_to, minHourly: r.min_hourly,
      overtimeFactor: r.overtime_factor, pensionPct: r.pension_pct, holidayPct: r.holiday_pct,
      maxWeeklyHours: r.max_weekly_hours, source: r.source, approvedBy: r.approved_by,
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/payroll/rulesets — nyt regelsæt. Satser rettes aldrig i en
// eksisterende version; en ændring oprettes som en ny version.
app.post('/api/payroll/rulesets', requireAuth, async (req, res) => {
  const { name, version, basis, jobGroup, validFrom, validTo, minHourly,
          overtimeFactor, pensionPct, holidayPct, maxWeeklyHours, source, approvedBy } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Regelsættet skal have et navn.' });
  if (!version || !String(version).trim()) return res.status(400).json({ error: 'Regelsættet skal have en version.' });
  if (!validFrom) return res.status(400).json({ error: 'Ikrafttrædelsesdato er påkrævet.' });
  try {
    const result = await pool.query(
      `INSERT INTO payroll_rulesets
         (user_id, name, version, basis, job_group, valid_from, valid_to, min_hourly,
          overtime_factor, pension_pct, holiday_pct, max_weekly_hours, source, approved_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [req.user.id, String(name).trim(), String(version).trim(), basis || 'contract', jobGroup || null,
       validFrom, validTo || null, minHourly || null, overtimeFactor || 1.5, pensionPct || null,
       holidayPct == null ? 12.5 : holidayPct, maxWeeklyHours || 48, source || null,
       approvedBy || req.user.name || req.user.email]
    );
    await pool.query(
      'INSERT INTO audit_log (user_id, action, details) VALUES ($1,$2,$3)',
      [req.user.id, 'payroll_ruleset_created', `Regelsæt ${name} ${version} oprettet`]
    );
    res.json({ ok: true, id: result.rows[0].id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── NemKonto API ────────────────────────────────────────────
// NemKontoregisteret er ikke tilgængeligt for private virksomheder, så
// kontoen oplyses af leverandøren og verificeres mod bankforbindelsen.

async function ownSupplier(supplierId, userId) {
  const r = await pool.query('SELECT * FROM suppliers WHERE id=$1 AND user_id=$2', [supplierId, userId]);
  return r.rows[0] || null;
}

// GET /api/suppliers/:id/nemkonto — konto, historik og kontrolresultat
app.get('/api/suppliers/:id/nemkonto', requireAuth, async (req, res) => {
  const view = resolveView(req);
  try {
    const supplier = await ownSupplier(req.params.id, req.user.id);
    if (!supplier) return res.status(404).json({ error: 'Leverandøren blev ikke fundet.' });

    const ctx = await complianceContext(req.user.id);
    const history = (ctx.accounts[supplier.id] || []).filter(a => a.kind === 'nemkonto');

    res.json({
      supplier: { id: supplier.id, name: supplier.name, cvr: supplier.cvr },
      nemkonto: nemkontoFor(supplier, ctx),
      payroll: payrollFor(supplier, ctx, view),
      history: history.map(h => ({
        id: h.id, regNo: h.reg_no, last4: h.account_last4, holderName: h.holder_name,
        verified: h.verified, verifiedSource: h.verified_source, verifiedAt: h.verified_at,
        validFrom: h.valid_from, validTo: h.valid_to, active: h.active, note: h.note,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/suppliers/:id/nemkonto — registrér konto. En ny konto lukker den
// forrige i stedet for at overskrive den, så en ændring kan ses i historikken.
app.post('/api/suppliers/:id/nemkonto', requireAuth, async (req, res) => {
  const { regNo, accountNo, holderName, kind, note } = req.body || {};
  const type = kind === 'invoice' ? 'invoice' : 'nemkonto';

  const parsed = nemkonto.parseAccount(regNo, accountNo);
  if (!parsed.valid) return res.status(400).json({ error: parsed.error });

  try {
    const supplier = await ownSupplier(req.params.id, req.user.id);
    if (!supplier) return res.status(404).json({ error: 'Leverandøren blev ikke fundet.' });

    const current = await pool.query(
      'SELECT id, account_hash FROM supplier_accounts WHERE supplier_id=$1 AND kind=$2 AND active=TRUE',
      [supplier.id, type]
    );
    if (current.rows[0] && current.rows[0].account_hash === parsed.account_hash) {
      return res.status(400).json({ error: 'Kontoen er allerede registreret.' });
    }
    await pool.query(
      'UPDATE supplier_accounts SET active=FALSE, valid_to=CURRENT_DATE WHERE supplier_id=$1 AND kind=$2 AND active=TRUE',
      [supplier.id, type]
    );

    const result = await pool.query(
      `INSERT INTO supplier_accounts
         (user_id, supplier_id, kind, reg_no, account_last4, account_hash, holder_name, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [req.user.id, supplier.id, type, parsed.reg_no, parsed.account_last4, parsed.account_hash,
       holderName || null, note || null]
    );

    const label = type === 'invoice' ? 'Fakturakonto' : 'NemKonto';
    await pool.query(
      'INSERT INTO audit_log (user_id, supplier_id, action, details) VALUES ($1,$2,$3,$4)',
      [req.user.id, supplier.id, 'nemkonto_registered',
       `${label} ${parsed.reg_no} ••••${parsed.account_last4} registreret${current.rows[0] ? ' (afløser tidligere konto)' : ''}`]
    );

    const ctx = await complianceContext(req.user.id);
    res.json({ ok: true, id: result.rows[0].id, replaced: !!current.rows[0], nemkonto: nemkontoFor(supplier, ctx) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/suppliers/:id/nemkonto/verify — bekræft kontoen mod en bankkilde
app.post('/api/suppliers/:id/nemkonto/verify', requireAuth, async (req, res) => {
  const { source, holderName } = req.body || {};
  const allowed = ['psd2', 'bank_statement', 'bank_confirmation'];
  if (!allowed.includes(source)) {
    return res.status(400).json({ error: 'Angiv en gyldig bankkilde: kontooplysningstjeneste, kontoudtog eller bankbekræftelse.' });
  }
  if (!holderName || !String(holderName).trim()) {
    return res.status(400).json({ error: 'Kontoejerens navn ifølge banken er påkrævet.' });
  }
  try {
    const supplier = await ownSupplier(req.params.id, req.user.id);
    if (!supplier) return res.status(404).json({ error: 'Leverandøren blev ikke fundet.' });

    const result = await pool.query(
      `UPDATE supplier_accounts
          SET verified=TRUE, verified_source=$1, verified_at=NOW(), holder_name=$2
        WHERE supplier_id=$3 AND kind='nemkonto' AND active=TRUE
        RETURNING reg_no, account_last4`,
      [source, String(holderName).trim(), supplier.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Der er ingen aktiv NemKonto at verificere.' });

    const row = result.rows[0];
    await pool.query(
      'INSERT INTO audit_log (user_id, supplier_id, action, details) VALUES ($1,$2,$3,$4)',
      [req.user.id, supplier.id, 'nemkonto_verified',
       `NemKonto ${row.reg_no} ••••${row.account_last4} verificeret mod ${source}, kontoejer "${String(holderName).trim()}"`]
    );

    const ctx = await complianceContext(req.user.id);
    res.json({ ok: true, nemkonto: nemkontoFor(supplier, ctx) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── CSV Eksport API ─────────────────────────────────────────

function sendCSV(res, filename, rows) {
  const csv = rows.map(row =>
    row.map(cell => {
      const s = (cell == null ? '' : String(cell)).replace(/"/g, '""');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
    }).join(',')
  ).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + csv); // BOM så Excel læser UTF-8 korrekt
}

const dateStamp = () => new Date().toISOString().slice(0, 10);

// GET /api/export/csv/suppliers
app.get('/api/export/csv/suppliers', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM suppliers WHERE user_id=$1 ORDER BY name', [req.user.id]);
    const riskLabel = { high: 'Høj', medium: 'Medium', low: 'Lav' };
    const rows = [['ID', 'Navn', 'CVR', 'Land', 'Branche', 'Type', 'Ansatte', 'Risiko', 'Score', 'Status', 'Tilføjet']];
    result.rows.forEach(s => rows.push([
      s.id, s.name, s.cvr || '—', s.country, s.industry || '—', s.type || '—',
      s.employees || '—', riskLabel[s.risk] || s.risk, s.score, s.status,
      new Date(s.added_at).toLocaleDateString('da-DK'),
    ]));
    sendCSV(res, `chainguard-leverandoerer-${dateStamp()}.csv`, rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/export/csv/deviations
app.get('/api/export/csv/deviations', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM deviations WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
    const rows = [['ID', 'Titel', 'Type', 'Status', 'Leverandør', 'Placering', 'Dage åben', 'Registreret', 'Lukket', 'Detaljer']];
    result.rows.forEach(d => {
      const f = formatDeviation(d);
      rows.push([
        d.id, d.title, f.typeLabel, d.status, d.supplier_name || '—', d.location || '—',
        f.daysOpen, new Date(d.created_at).toLocaleDateString('da-DK'),
        d.closed_at ? new Date(d.closed_at).toLocaleDateString('da-DK') : '—',
        d.description || '',
      ]);
    });
    sendCSV(res, `chainguard-afvigelser-${dateStamp()}.csv`, rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/export/csv/apprentices
app.get('/api/export/csv/apprentices', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM apprentices WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);
    const rows = [['Navn', 'Type', 'Uddannelse', 'Leverandør', 'Startdato', 'Slutdato', 'Status']];
    result.rows.forEach(a => rows.push([
      a.name || 'Afventer', a.type_label || a.type || '—', a.education || '—', a.supplier_name || '—',
      a.start_date ? new Date(a.start_date).toLocaleDateString('da-DK') : '—',
      a.end_date ? new Date(a.end_date).toLocaleDateString('da-DK') : '—',
      a.status || '—',
    ]));
    sendCSV(res, `chainguard-laerlinge-${dateStamp()}.csv`, rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/export/csv/payroll — kontrolrapport for én lønperiode
app.get('/api/export/csv/payroll', requireAuth, async (req, res) => {
  const view = resolveView(req);
  try {
    const period = await ownPeriod(req.query.periodId, req.user.id);
    if (!period) return res.status(404).json({ error: 'Lønperioden blev ikke fundet.' });

    const lines = await periodLines(period.id);
    const devs = await pool.query(
      `SELECT line_id, code, severity FROM payroll_deviations
        WHERE period_id=$1 AND superseded=FALSE AND resolved_at IS NULL`,
      [period.id]
    );
    const byLine = new Map();
    for (const d of devs.rows) {
      if (!byLine.has(d.line_id)) byLine.set(d.line_id, []);
      byLine.get(d.line_id).push(d.code);
    }

    const money = v => (v == null ? '—' : Number(v).toFixed(2).replace('.', ','));
    const head = ['Medarbejder', 'Faggruppe', 'Timer normal', 'Timer overtid'];
    if (view !== 'main') head.push('Bruttoløn', 'Nettoløn');
    head.push('Indberettet', 'Udbetalt', 'Status', 'Afvigelser');

    const rows = [head];
    for (const l of lines) {
      const masked = payroll.maskLine(l, view);
      const meta = payroll.STATUS_META[l.status] || payroll.STATUS_META.grey;
      const row = [l.pseudonym, l.job_group || '—', money(l.hours_normal), money(l.hours_overtime)];
      if (view !== 'main') row.push(money(masked.gross), money(masked.net));
      row.push(
        l.reported ? 'Ja' : 'Nej',
        view === 'main'
          ? (masked.net_paid ? 'Ja' : 'Nej')
          : money(masked.bank_paid),
        meta.label,
        (byLine.get(l.id) || []).join(' · ') || 'Ingen'
      );
      rows.push(row);
    }

    const d = v => (v ? new Date(v).toLocaleDateString('da-DK') : '—');
    rows.push([]);
    rows.push(['Lønperiode', `${d(period.period_start)} – ${d(period.period_end)}`]);
    rows.push(['Leverandør', period.supplier_name || '—']);
    rows.push(['Regelversion', period.ruleset_version || '—']);
    rows.push(['Kontrolleret', period.checked_at ? new Date(period.checked_at).toLocaleString('da-DK') : 'Ikke kontrolleret']);
    rows.push(['Visning', view === 'main' ? 'Hovedvirksomhed (beløb udeladt)' : 'Fulde løndata']);

    sendCSV(res, `chainguard-loenkontrol-${dateStamp()}.csv`, rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Daglig cron: send compliance rapport kl. 06:00 ──────────
cron.schedule('0 6 * * *', async () => {
  console.log('[CRON] Daglig compliance arkivering starter...');
  try {
    const users = await pool.query(
      'SELECT id, name, email, archive_email FROM users WHERE archive_email IS NOT NULL AND archive_email != \'\''
    );
    for (const user of users.rows) {
      try {
        const { buffer, suppliersCount, auditEntries } = await generateCompliancePDF(user.id, user.name, user.email);
        const dateStr = new Date().toISOString().split('T')[0];
        const filename = `chainguard-compliance-${dateStr}.pdf`;

        await pool.query(
          `INSERT INTO compliance_archive (user_id, sent_to, filename, pdf_data, suppliers_count, audit_entries, trigger_type)
           VALUES ($1,$2,$3,$4,$5,$6,'auto')`,
          [user.id, user.archive_email, filename, buffer, suppliersCount, auditEntries]
        );

        const resend = getResend();
        if (resend) {
          await resend.emails.send({
            from: 'ChainGuard Compliance <onboarding@resend.dev>',
            to: [user.archive_email],
            subject: `ChainGuard Daglig Compliance Rapport — ${new Date().toLocaleDateString('da-DK')}`,
            text: `Automatisk daglig compliance-rapport for ${user.name}.\n\nRapport dato: ${new Date().toLocaleString('da-DK')}\nLeverandører: ${suppliersCount}\nRevisionsposter: ${auditEntries}\n\nDokumentet er arkiveret i databasen jf. 5-års opbevaringskrav.\n\n— ChainGuard`,
            attachments: [{ filename, content: buffer.toString('base64'), contentType: 'application/pdf' }]
          });
        }

        await pool.query(
          'INSERT INTO audit_log (user_id, action, details) VALUES ($1,$2,$3)',
          [user.id, 'AUTO-ARKIVERING', `Daglig rapport sendt til ${user.archive_email}`]
        );

        console.log(`[CRON] Rapport sendt for ${user.email} → ${user.archive_email}`);
      } catch (e) {
        console.error(`[CRON] Fejl for bruger ${user.email}:`, e.message);
      }
    }
    console.log('[CRON] Daglig compliance arkivering færdig.');
  } catch (e) {
    console.error('[CRON] Kritisk fejl:', e.message);
  }
}, { timezone: 'Europe/Copenhagen' });

// ── Stripe webhook (raw body påkrævet) ──────────────────────
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    if (STRIPE_WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
    } else {
      event = JSON.parse(req.body);
    }
  } catch (e) {
    return res.status(400).send('Webhook fejl: ' + e.message);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.user_id;
    const plan = session.metadata?.plan;
    if (userId) {
      await pool.query(
        `UPDATE users SET stripe_customer_id=$1, stripe_subscription_id=$2, subscription_plan=$3, subscription_status='active' WHERE id=$4`,
        [session.customer, session.subscription, plan, userId]
      ).catch(e => console.error('Webhook DB fejl:', e.message));
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    await pool.query(
      `UPDATE users SET subscription_status='cancelled' WHERE stripe_subscription_id=$1`,
      [sub.id]
    ).catch(e => console.error('Webhook DB fejl:', e.message));
  }

  res.json({ received: true });
});

// ── Stripe: opret checkout session ──────────────────────────
app.post('/api/stripe/checkout', requireAuth, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe ikke konfigureret' });
  const { plan } = req.body;
  const plans = {
    basis: { name: 'ChainGuard Basis', amount: 99900, description: '0–20 mio kr omsætning · Fuld compliance platform' },
    pro:   { name: 'ChainGuard Pro',   amount: 249900, description: '20–100 mio kr omsætning · Avanceret compliance + prioriteret support' },
  };
  const selected = plans[plan];
  if (!selected) return res.status(400).json({ error: 'Ukendt plan' });

  const host = req.headers.origin || `https://${req.headers.host}`;
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'dkk',
          product_data: { name: selected.name, description: selected.description },
          unit_amount: selected.amount,
          recurring: { interval: 'month' },
        },
        quantity: 1,
      }],
      subscription_data: {
        trial_period_days: 30,
        metadata: { user_id: String(req.user.id), plan },
      },
      metadata: { user_id: String(req.user.id), plan },
      customer_email: req.user.email,
      success_url: `${host}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${host}/pricing`,
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error('Stripe checkout fejl:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Stripe: success side ─────────────────────────────────────
app.get('/payment/success', requireAuth, async (req, res) => {
  const { session_id } = req.query;
  let plan = 'basis';
  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    plan = session.metadata?.plan || 'basis';
    await pool.query(
      `UPDATE users SET stripe_customer_id=$1, stripe_subscription_id=$2, subscription_plan=$3, subscription_status='trialing' WHERE id=$4`,
      [session.customer, session.subscription, plan, req.user.id]
    );
  } catch (e) { console.error('Success session fejl:', e.message); }

  const planLabel = plan === 'pro' ? 'Pro' : 'Basis';
  res.send(`<!DOCTYPE html>
<html lang="da">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ChainGuard — Betaling gennemført</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Plus Jakarta Sans',sans-serif;background:#080C20;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.09);border-radius:20px;padding:56px 48px;max-width:480px;width:100%;text-align:center}
.icon{width:64px;height:64px;background:rgba(0,223,160,0.15);border:1px solid rgba(0,223,160,0.3);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 24px;font-size:28px}
h1{font-size:24px;font-weight:800;margin-bottom:10px}
p{color:rgba(255,255,255,0.5);font-size:14px;line-height:1.6;margin-bottom:28px}
a{display:inline-block;background:linear-gradient(135deg,#7C5CFC,#635BFF);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:14px}
</style>
</head>
<body>
<div class="card">
  <div class="icon">✓</div>
  <h1>Betaling gennemført!</h1>
  <p>Velkommen til ChainGuard ${planLabel}.<br>Din første måned er gratis — herefter faktureres ${plan === 'pro' ? '2.499' : '999'} kr/md automatisk.</p>
  <a href="/">Gå til platformen</a>
</div>
</body>
</html>`);
});

// ── Prisside (offentlig) ─────────────────────────────────────
app.get('/pricing', (req, res) => {
  const user = getUser(req);
  res.send(`<!DOCTYPE html>
<html lang="da">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ChainGuard — Priser</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Plus Jakarta Sans',sans-serif;background:#080C20;color:#fff;min-height:100vh;-webkit-font-smoothing:antialiased}
.orb-layer{position:fixed;inset:0;pointer-events:none;overflow:hidden}
.orb{position:absolute;border-radius:50%}
.orb-1{width:700px;height:500px;background:radial-gradient(ellipse,rgba(124,92,252,0.28) 0%,transparent 65%);top:-150px;left:-150px}
.orb-2{width:500px;height:500px;background:radial-gradient(ellipse,rgba(99,91,255,0.18) 0%,transparent 70%);bottom:-100px;right:-100px}
nav{display:flex;align-items:center;justify-content:space-between;padding:20px 48px;border-bottom:1px solid rgba(255,255,255,0.07);position:sticky;top:0;background:rgba(8,12,32,0.85);backdrop-filter:blur(20px);z-index:10}
.brand{display:flex;align-items:center;gap:12px}
.brand-icon{width:36px;height:36px;background:linear-gradient(140deg,#9270FF,#635BFF);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px}
.brand-name{font-size:16px;font-weight:800}
.nav-links{display:flex;gap:16px;align-items:center}
.nav-link{color:rgba(255,255,255,0.5);text-decoration:none;font-size:13.5px;font-weight:500;transition:color 0.15s}
.nav-link:hover{color:#fff}
.btn-nav{background:linear-gradient(135deg,#7C5CFC,#635BFF);color:#fff;text-decoration:none;padding:9px 20px;border-radius:8px;font-size:13px;font-weight:700;transition:opacity 0.15s}
.btn-nav:hover{opacity:0.88}
.hero{text-align:center;padding:72px 24px 56px;position:relative;z-index:1}
.badge{display:inline-block;background:rgba(124,92,252,0.15);border:1px solid rgba(124,92,252,0.3);color:#A78BFA;font-size:12px;font-weight:700;padding:5px 14px;border-radius:99px;margin-bottom:20px}
h1{font-size:42px;font-weight:800;letter-spacing:-1.5px;margin-bottom:14px;line-height:1.1}
.sub{color:rgba(255,255,255,0.45);font-size:16px;max-width:520px;margin:0 auto 12px}
.trial-note{color:#00DFA0;font-size:13.5px;font-weight:600;margin-top:8px}
.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;max-width:980px;margin:0 auto;padding:0 24px 80px;position:relative;z-index:1}
.plan{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.09);border-radius:20px;padding:36px 32px;position:relative;transition:border-color 0.2s}
.plan.popular{border-color:rgba(124,92,252,0.5);background:rgba(124,92,252,0.06)}
.popular-badge{position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#7C5CFC,#635BFF);color:#fff;font-size:11px;font-weight:800;padding:4px 16px;border-radius:99px;white-space:nowrap}
.plan-name{font-size:13px;font-weight:700;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px}
.plan-price{font-size:40px;font-weight:800;letter-spacing:-1.5px;margin-bottom:4px}
.plan-price span{font-size:16px;font-weight:500;color:rgba(255,255,255,0.4)}
.plan-target{font-size:13px;color:rgba(255,255,255,0.4);margin-bottom:24px;padding-bottom:24px;border-bottom:1px solid rgba(255,255,255,0.07)}
.plan-features{list-style:none;margin-bottom:28px}
.plan-features li{font-size:13.5px;color:rgba(255,255,255,0.7);padding:7px 0;display:flex;align-items:center;gap:10px}
.plan-features li::before{content:'✓';color:#00DFA0;font-weight:800;font-size:12px;flex-shrink:0}
.btn-plan{width:100%;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);color:#fff;padding:14px;border-radius:10px;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;transition:all 0.2s}
.btn-plan:hover{background:rgba(255,255,255,0.12)}
.btn-plan.primary{background:linear-gradient(135deg,#7C5CFC,#635BFF);border:none;box-shadow:0 4px 20px rgba(124,92,252,0.4)}
.btn-plan.primary:hover{opacity:0.88}
.loading{opacity:0.6;pointer-events:none}
</style>
</head>
<body>
<div class="orb-layer"><div class="orb orb-1"></div><div class="orb orb-2"></div></div>
<nav>
  <div class="brand">
    <div class="brand-icon">🛡</div>
    <div class="brand-name">ChainGuard</div>
  </div>
  <div class="nav-links">
    ${user ? '<a href="/" class="nav-link">Platform</a>' : ''}
    <a href="/login" class="btn-nav">${user ? 'Mit dashboard' : 'Log ind'}</a>
  </div>
</nav>
<div class="hero">
  ${req.query.upgrade ? '<div style="display:inline-block;background:rgba(255,173,13,0.12);border:1px solid rgba(255,173,13,0.3);color:#FFAD0D;padding:10px 22px;border-radius:99px;font-size:13px;font-weight:600;margin-bottom:20px;">Vælg et abonnement for at tilgå platformen</div>' : ''}
  <div class="badge">Simpel og transparent prissætning</div>
  <h1>Vælg den plan<br>der passer dig</h1>
  <p class="sub">Alt hvad du behøver for at dokumentere kædeansvar og overholde EU-krav</p>
  <div class="trial-note">Første 30 dage gratis — ingen binding</div>
</div>
<div class="plans">
  <div class="plan">
    <div class="plan-name">Basis</div>
    <div class="plan-price">999 <span>kr/md</span></div>
    <div class="plan-target">Virksomheder med 0–20 mio kr omsætning</div>
    <ul class="plan-features">
      <li>CVR-opslag og leverandørregistrering</li>
      <li>Automatisk revisionsspor</li>
      <li>PDF compliance-rapport</li>
      <li>Daglig email-arkivering</li>
      <li>5-års dokumentopbevaring</li>
      <li>Op til 50 leverandører</li>
    </ul>
    <button class="btn-plan" onclick="startCheckout('basis', this)">Start gratis prøveperiode</button>
  </div>
  <div class="plan popular">
    <div class="popular-badge">Mest populær</div>
    <div class="plan-name">Pro</div>
    <div class="plan-price">2.499 <span>kr/md</span></div>
    <div class="plan-target">Virksomheder med 20–100 mio kr omsætning</div>
    <ul class="plan-features">
      <li>Alt i Basis</li>
      <li>Ubegrænsede leverandører</li>
      <li>Avanceret risikovurdering</li>
      <li>ESG due diligence rapporter</li>
      <li>Prioriteret support</li>
      <li>API-adgang</li>
    </ul>
    <button class="btn-plan primary" onclick="startCheckout('pro', this)">Start gratis prøveperiode</button>
  </div>
  <div class="plan">
    <div class="plan-name">Heavy</div>
    <div class="plan-price" style="font-size:28px;margin-top:6px">Kontakt os</div>
    <div class="plan-target">Virksomheder med 100+ mio kr omsætning</div>
    <ul class="plan-features">
      <li>Alt i Pro</li>
      <li>Skræddersyet onboarding</li>
      <li>Dedicated account manager</li>
      <li>SLA-garanti</li>
      <li>On-premise mulighed</li>
      <li>Tilpasset rapportering</li>
    </ul>
    <button class="btn-plan" onclick="window.location.href='mailto:christian@chainguard.ai?subject=Heavy plan forespørgsel'">Kontakt os</button>
  </div>
</div>
<script>
async function startCheckout(plan, btn) {
  btn.classList.add('loading');
  btn.textContent = 'Vent...';
  try {
    const r = await fetch('/api/stripe/checkout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan })
    });
    const data = await r.json();
    if (data.url) {
      window.location.href = data.url;
    } else if (r.status === 401) {
      window.location.href = '/login?redirect=pricing';
    } else {
      alert('Fejl: ' + (data.error || 'Prøv igen'));
      btn.classList.remove('loading');
      btn.textContent = 'Start gratis prøveperiode';
    }
  } catch(e) {
    alert('Netværksfejl — prøv igen');
    btn.classList.remove('loading');
    btn.textContent = 'Start gratis prøveperiode';
  }
}
</script>
</body>
</html>`);
});

// ── Investor side ────────────────────────────────────────────
app.get('/investor', requireAuth, (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="da">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ChainGuard — Investor Overblik</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; background: #080C20; color: #fff; min-height: 100vh; -webkit-font-smoothing: antialiased; }
.topbar { display:flex;align-items:center;justify-content:space-between;padding:18px 40px;border-bottom:1px solid rgba(255,255,255,0.07);background:rgba(8,12,32,0.8);backdrop-filter:blur(20px);position:sticky;top:0;z-index:10; }
.brand { display:flex;align-items:center;gap:12px; }
.brand-icon { width:36px;height:36px;background:linear-gradient(140deg,#9270FF,#635BFF);border-radius:10px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(124,92,252,0.5);font-size:18px; }
.brand-name { font-size:16px;font-weight:800;letter-spacing:-0.5px; }
.badge { background:rgba(124,92,252,0.15);border:1px solid rgba(124,92,252,0.3);color:#A78BFA;font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px; }
.links { display:flex;gap:16px;align-items:center; }
.logout { color:rgba(255,255,255,0.4);font-size:13px;text-decoration:none;transition:color 0.15s; }
.logout:hover { color:#FF4D6A; }
.back { color:rgba(255,255,255,0.4);font-size:13px;text-decoration:none;transition:color 0.15s; }
.back:hover { color:#A78BFA; }
.content { max-width:1100px;margin:0 auto;padding:48px 40px; }
h1 { font-size:28px;font-weight:800;letter-spacing:-0.5px;margin-bottom:8px; }
.sub { color:rgba(255,255,255,0.45);font-size:15px;margin-bottom:40px; }
.kpi-grid { display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:40px; }
.kpi { background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:24px; }
.kpi-val { font-size:36px;font-weight:800;letter-spacing:-1px;margin-bottom:4px; }
.kpi-label { font-size:12px;font-weight:600;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.8px; }
.kpi-sub { font-size:12px;color:rgba(255,255,255,0.3);margin-top:4px; }
.green { color:#00DFA0; } .violet { color:#A78BFA; } .blue { color:#4A9FFF; } .amber { color:#FFAD0D; }
.card { background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:28px;margin-bottom:20px; }
.card h2 { font-size:16px;font-weight:700;margin-bottom:20px; }
.row { display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:14px; }
.row:last-child { border-bottom:none; }
.row-label { color:rgba(255,255,255,0.5); }
.row-val { font-weight:600; }
.tag { display:inline-block;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:700; }
.tag-green { background:rgba(0,223,160,0.12);color:#00DFA0;border:1px solid rgba(0,223,160,0.3); }
.milestone { display:flex;gap:16px;padding:14px 0;border-bottom:1px solid rgba(255,255,255,0.06); }
.milestone:last-child { border-bottom:none; }
.dot { width:10px;height:10px;border-radius:50%;background:#00DFA0;margin-top:4px;flex-shrink:0; }
.dot.pending { background:#FFAD0D; }
.ms-title { font-size:14px;font-weight:600;margin-bottom:2px; }
.ms-sub { font-size:12px;color:rgba(255,255,255,0.4); }
</style>
</head>
<body>
<div class="topbar">
  <div class="brand">
    <div class="brand-icon">🛡</div>
    <div class="brand-name">ChainGuard</div>
    <span class="badge">Investor Overblik</span>
  </div>
  <div class="links">
    <a href="/" class="back">← Platform</a>
    <a href="/logout" class="logout">Log ud</a>
  </div>
</div>
<div class="content">
  <h1>Investor Overblik</h1>
  <p class="sub">Fortroligt dokument — kun til investorer</p>
  <div class="kpi-grid">
    <div class="kpi"><div class="kpi-val green">0</div><div class="kpi-label">Betalende kunder</div><div class="kpi-sub">Mål: 10 inden Q3 2026</div></div>
    <div class="kpi"><div class="kpi-val violet">999–2.499 kr</div><div class="kpi-label">Pris pr. måned</div><div class="kpi-sub">Basis / Pro plan</div></div>
    <div class="kpi"><div class="kpi-val blue">0 kr</div><div class="kpi-label">MRR</div><div class="kpi-sub">Monthly Recurring Revenue</div></div>
    <div class="kpi"><div class="kpi-val amber">~50.000</div><div class="kpi-label">Adresserbart marked</div><div class="kpi-sub">Danske virksomheder</div></div>
  </div>
  <div class="card">
    <h2>Forretningsmodel</h2>
    <div class="row"><span class="row-label">Model</span><span class="row-val">SaaS — månedligt abonnement</span></div>
    <div class="row"><span class="row-label">Basis plan</span><span class="row-val">999 kr/md · 0–20 mio kr omsætning</span></div>
    <div class="row"><span class="row-label">Pro plan</span><span class="row-val">2.499 kr/md · 20–100 mio kr omsætning</span></div>
    <div class="row"><span class="row-label">Heavy plan</span><span class="row-val">Skræddersyet · 100+ mio kr omsætning</span></div>
    <div class="row"><span class="row-label">Prøveperiode</span><span class="row-val">30 dage gratis — ingen binding</span></div>
    <div class="row"><span class="row-label">Målgruppe</span><span class="row-val">Virksomheder med leverandørkæder i Danmark</span></div>
    <div class="row"><span class="row-label">Problem</span><span class="row-val">EU kædeansvarsdirektiv kræver dokumentation</span></div>
    <div class="row"><span class="row-label">Løsning</span><span class="row-val">Automatisk CVR-tjek, revisionsspor + PDF-arkiv</span></div>
    <div class="row"><span class="row-label">Status</span><span class="row-val"><span class="tag tag-green">Live</span></span></div>
  </div>
  <div class="card">
    <h2>Milepæle</h2>
    <div class="milestone"><div class="dot"></div><div><div class="ms-title">Platform lanceret</div><div class="ms-sub">April 2026 · Live på railway.app</div></div></div>
    <div class="milestone"><div class="dot"></div><div><div class="ms-title">Første betalende kunde</div><div class="ms-sub">April 2026 · Igangværende</div></div></div>
    <div class="milestone"><div class="dot pending"></div><div><div class="ms-title">10 betalende kunder</div><div class="ms-sub">Mål: Juni 2026</div></div></div>
    <div class="milestone"><div class="dot pending"></div><div><div class="ms-title">Kommunal anbefaling</div><div class="ms-sub">Mål: Q3 2026</div></div></div>
    <div class="milestone"><div class="dot pending"></div><div><div class="ms-title">20 kunder · break-even</div><div class="ms-sub">Mål: Q4 2026</div></div></div>
  </div>
  <div class="card">
    <h2>Kontakt</h2>
    <div class="row"><span class="row-label">Stifter</span><span class="row-val">Christian</span></div>
    <div class="row"><span class="row-label">Email</span><span class="row-val">christian@chainguard.ai</span></div>
  </div>
</div>
</body>
</html>`);
});

// ── Dashboard (kræver login + aktivt abonnement) ─────────────
app.use('/', requireAuth, requireSubscription, express.static(path.join(__dirname, 'public')));

// ── Global fejlhåndtering ────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Server fejl:', err.message);
  res.status(500).send('Noget gik galt — prøv at genindlæse siden.');
});

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  ChainGuard kører på port ${PORT}\n`);
  init().catch(e => console.error('Database init fejl:', e.message));
});
