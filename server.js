const express = require('express');
const session = require('express-session');
const https = require('https');
const path = require('path');
const url = require('url');
const bcrypt = require('bcryptjs');
const { pool, init } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'chainguard-secret-skift-i-prod',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 } // 8 timer
}));

// ── Auth middleware ─────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect('/login');
}

// ── Login side ──────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/');
  res.send(`<!DOCTYPE html>
<html lang="da">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ChainGuard — Log ind</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    background: #080C20;
    color: #fff;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    -webkit-font-smoothing: antialiased;
  }
  .orb-layer { position:fixed;inset:0;pointer-events:none;overflow:hidden; }
  .orb { position:absolute;border-radius:50%; }
  .orb-1 { width:700px;height:500px;background:radial-gradient(ellipse,rgba(124,92,252,0.28) 0%,transparent 65%);top:-150px;left:-150px; }
  .orb-2 { width:500px;height:500px;background:radial-gradient(ellipse,rgba(99,91,255,0.18) 0%,transparent 70%);bottom:-100px;right:-100px; }
  .card {
    position: relative;
    z-index: 1;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 20px;
    padding: 48px 44px;
    width: 100%;
    max-width: 420px;
    backdrop-filter: blur(24px);
  }
  .logo {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 36px;
  }
  .logo-icon {
    width: 40px; height: 40px;
    background: linear-gradient(140deg,#9270FF 0%,#635BFF 100%);
    border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 4px 20px rgba(124,92,252,0.5);
    font-size: 20px;
  }
  .logo-text { font-size: 20px; font-weight: 800; letter-spacing: -0.5px; }
  .logo-sub { font-size: 11px; color: rgba(255,255,255,0.3); margin-top: 1px; }
  h1 { font-size: 22px; font-weight: 700; margin-bottom: 6px; }
  .subtitle { color: rgba(255,255,255,0.45); font-size: 14px; margin-bottom: 32px; }
  label { display: block; font-size: 12.5px; font-weight: 600; color: rgba(255,255,255,0.6); margin-bottom: 7px; }
  input {
    width: 100%;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    padding: 12px 14px;
    color: #fff;
    font-size: 14px;
    font-family: inherit;
    margin-bottom: 18px;
    outline: none;
    transition: border-color 0.2s;
  }
  input:focus { border-color: rgba(124,92,252,0.6); }
  button {
    width: 100%;
    background: linear-gradient(135deg,#7C5CFC 0%,#635BFF 100%);
    border: none;
    border-radius: 10px;
    padding: 13px;
    color: #fff;
    font-size: 14.5px;
    font-weight: 700;
    font-family: inherit;
    cursor: pointer;
    margin-top: 4px;
    box-shadow: 0 4px 20px rgba(124,92,252,0.4);
    transition: opacity 0.2s;
  }
  button:hover { opacity: 0.88; }
  .error {
    background: rgba(255,77,106,0.12);
    border: 1px solid rgba(255,77,106,0.28);
    color: #FF4D6A;
    border-radius: 8px;
    padding: 10px 14px;
    font-size: 13px;
    margin-bottom: 18px;
  }
</style>
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
</div>
</body>
</html>`);
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user) return res.redirect('/login?error=1');
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.redirect('/login?error=1');
    req.session.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    res.redirect('/');
  } catch (e) {
    console.error('Login fejl:', e.message);
    res.redirect('/login?error=1');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ── CVR API ─────────────────────────────────────────────────
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

app.get('/api/cvr/:cvr', requireAuth, async (req, res) => {
  if (!/^\d{8}$/.test(req.params.cvr)) return res.status(400).json({ error: 'Ugyldigt CVR-nummer' });
  try {
    const d = await httpsGet('https://cvrapi.dk/api?search=' + req.params.cvr + '&country=dk');
    if (d.error) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json(normalizeCVR(d));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/cvr/search/:query', requireAuth, async (req, res) => {
  try {
    const q = decodeURIComponent(req.params.query);
    const d = await httpsGet('https://cvrapi.dk/api?search=' + encodeURIComponent(q) + '&country=dk');
    if (d.error || !d.name) return res.json([]);
    res.json([{ name: d.name, cvr: String(d.vat || ''), city: d.city || '' }]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Leverandør API ──────────────────────────────────────────
app.get('/api/suppliers', requireAuth, async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM suppliers WHERE user_id = $1 ORDER BY added_at DESC',
    [req.session.user.id]
  );
  res.json(result.rows);
});

app.post('/api/suppliers', requireAuth, async (req, res) => {
  const { cvr, name, address, industry, employees, phone, status, notes } = req.body;
  const result = await pool.query(
    `INSERT INTO suppliers (user_id, cvr, name, address, industry, employees, phone, status, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [req.session.user.id, cvr, name, address, industry, employees, phone, status || 'pending', notes]
  );
  await pool.query(
    'INSERT INTO audit_log (user_id, supplier_id, action, details) VALUES ($1,$2,$3,$4)',
    [req.session.user.id, result.rows[0].id, 'TILFØJET', `CVR: ${cvr}`]
  );
  res.json(result.rows[0]);
});

app.patch('/api/suppliers/:id', requireAuth, async (req, res) => {
  const { status, notes } = req.body;
  const result = await pool.query(
    `UPDATE suppliers SET status=$1, notes=$2, updated_at=NOW()
     WHERE id=$3 AND user_id=$4 RETURNING *`,
    [status, notes, req.params.id, req.session.user.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Ikke fundet' });
  await pool.query(
    'INSERT INTO audit_log (user_id, supplier_id, action, details) VALUES ($1,$2,$3,$4)',
    [req.session.user.id, req.params.id, 'OPDATERET', `Status: ${status}`]
  );
  res.json(result.rows[0]);
});

app.delete('/api/suppliers/:id', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM suppliers WHERE id=$1 AND user_id=$2', [req.params.id, req.session.user.id]);
  res.json({ ok: true });
});

app.get('/api/audit/:supplierId', requireAuth, async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM audit_log WHERE supplier_id=$1 ORDER BY created_at DESC',
    [req.params.supplierId]
  );
  res.json(result.rows);
});

// ── Dashboard (kræver login) ─────────────────────────────────
app.use('/', requireAuth, express.static(path.join(__dirname, 'public')));

// ── Start ────────────────────────────────────────────────────
init().then(() => {
  app.listen(PORT, () => {
    console.log(`\n✅  ChainGuard kører på port ${PORT}\n`);
  });
}).catch(e => {
  console.error('Database fejl:', e.message);
  process.exit(1);
});
