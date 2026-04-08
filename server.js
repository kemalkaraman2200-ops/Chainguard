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
const { pool, init } = require('./db');

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

app.get('/api/debug-db', async (req, res) => {
  const dbUrl = process.env.DATABASE_URL || 'IKKE SAT';
  const resendKey = process.env.RESEND_API_KEY || 'IKKE SAT';
  res.json({
    database_url_prefix: dbUrl.substring(0, 30) + '...',
    resend_key_prefix: resendKey.substring(0, 8) + '...',
    resend_key_sat: !!process.env.RESEND_API_KEY
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
