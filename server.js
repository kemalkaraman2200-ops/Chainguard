const express = require('express');
const https = require('https');
const path = require('path');
const url = require('url');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const PDFDocument = require('pdfkit');
const { pool, init } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.SESSION_SECRET || 'chainguard-jwt-secret';

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
<style>
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
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user) return res.redirect('/login?error=1');
    const match = await bcrypt.compare(password, user.password);
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

// ── Leverandør API (kræver auth) ────────────────────────────
app.get('/api/suppliers', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM suppliers WHERE user_id = $1 ORDER BY added_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/suppliers', requireAuth, async (req, res) => {
  const { cvr, name, address, industry, employees, phone, status, notes } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO suppliers (user_id, cvr, name, address, industry, employees, phone, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user.id, cvr, name, address, industry, employees, phone, status || 'pending', notes || '']
    );
    await pool.query(
      'INSERT INTO audit_log (user_id, supplier_id, action, details) VALUES ($1,$2,$3,$4)',
      [req.user.id, result.rows[0].id, 'TILFØJET', `CVR: ${cvr}`]
    );
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/suppliers/:id', requireAuth, async (req, res) => {
  const { status, notes } = req.body;
  try {
    const result = await pool.query(
      `UPDATE suppliers SET status=$1, notes=$2, updated_at=NOW() WHERE id=$3 AND user_id=$4 RETURNING *`,
      [status, notes, req.params.id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Ikke fundet' });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/suppliers/:id', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM suppliers WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// ── PDF Export ───────────────────────────────────────────────
app.get('/api/export/pdf', requireAuth, async (req, res) => {
  try {
    const suppliers = await pool.query(
      'SELECT * FROM suppliers WHERE user_id = $1 ORDER BY added_at DESC',
      [req.user.id]
    );
    const auditLog = await pool.query(
      `SELECT a.*, s.name as supplier_name, s.cvr
       FROM audit_log a
       LEFT JOIN suppliers s ON s.id = a.supplier_id
       WHERE a.user_id = $1
       ORDER BY a.created_at DESC
       LIMIT 100`,
      [req.user.id]
    );

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="chainguard-revisionsspor-${new Date().toISOString().split('T')[0]}.pdf"`);
    doc.pipe(res);

    // Header
    doc.fontSize(22).font('Helvetica-Bold').fillColor('#1a1a2e').text('ChainGuard', { continued: true });
    doc.fontSize(12).font('Helvetica').fillColor('#666').text('  —  Compliance Revisionsspor', { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#888').text(`Genereret: ${new Date().toLocaleString('da-DK')}`, { align: 'left' });
    doc.text(`Bruger: ${req.user.name} (${req.user.email})`);
    doc.moveDown(1);

    // Linje
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
        doc.fontSize(8).fillColor('#aaa').text(`Tilføjet: ${new Date(s.added_at).toLocaleString('da-DK')}`);
        doc.moveDown(0.6);
      });
    }

    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e0e0e0').stroke();
    doc.moveDown(1);

    // Audit log
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#1a1a2e').text('Revisionsspor');
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
      `Dette dokument er genereret automatisk af ChainGuard og indeholder et tidsstemplet revisionsspor. Dokumentet kan fremvises som dokumentation for due diligence i forbindelse med kædeansvar.`,
      { align: 'center' }
    );

    doc.end();
  } catch (e) {
    console.error('PDF fejl:', e.message);
    res.status(500).send('Kunne ikke generere PDF');
  }
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
    <div class="kpi"><div class="kpi-val green">3</div><div class="kpi-label">Betalende kunder</div><div class="kpi-sub">Mål: 20 inden Q3 2026</div></div>
    <div class="kpi"><div class="kpi-val violet">499 kr</div><div class="kpi-label">Pris pr. måned</div><div class="kpi-sub">Per virksomhed</div></div>
    <div class="kpi"><div class="kpi-val blue">1.497 kr</div><div class="kpi-label">MRR</div><div class="kpi-sub">Monthly Recurring Revenue</div></div>
    <div class="kpi"><div class="kpi-val amber">~50.000</div><div class="kpi-label">Adresserbart marked</div><div class="kpi-sub">Danske entreprenører</div></div>
  </div>
  <div class="card">
    <h2>Forretningsmodel</h2>
    <div class="row"><span class="row-label">Model</span><span class="row-val">SaaS — månedligt abonnement</span></div>
    <div class="row"><span class="row-label">Pris</span><span class="row-val">499 kr/md · første måned gratis</span></div>
    <div class="row"><span class="row-label">Målgruppe</span><span class="row-val">Hoved- og totalentreprenører i Danmark</span></div>
    <div class="row"><span class="row-label">Problem</span><span class="row-val">Kommuner kræver kædeansvarsdokumentation</span></div>
    <div class="row"><span class="row-label">Løsning</span><span class="row-val">Automatisk CVR-tjek + revisionsspor</span></div>
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

// ── Dashboard (kræver login) ─────────────────────────────────
app.use('/', requireAuth, express.static(path.join(__dirname, 'public')));

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
