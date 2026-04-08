const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;

function httpsGet(u) {
  return new Promise((res, rej) => {
    const r = https.get(
      { ...url.parse(u), headers: { 'User-Agent': 'ChainGuard/1.0' } },
      x => {
        let d = '';
        x.on('data', c => d += c);
        x.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
      }
    );
    r.on('error', rej);
    r.setTimeout(8000, () => { r.destroy(); rej(new Error('Timeout')); });
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

function serveStatic(req, res) {
  const safePath = path.normalize(req.url).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(__dirname, 'public', safePath === '/' ? 'index.html' : safePath);

  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404); res.end('Not found'); return;
  }

  const ext = path.extname(filePath);
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const pathname = url.parse(req.url).pathname;

  // CVR opslag på CVR-nummer
  const m1 = pathname.match(/^\/api\/cvr\/(\d{8})$/);
  if (m1) {
    try {
      const d = await httpsGet('https://cvrapi.dk/api?search=' + m1[1] + '&country=dk');
      if (d.error) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'NOT_FOUND' })); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(normalizeCVR(d)));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // CVR søgning på navn
  const m2 = pathname.match(/^\/api\/cvr\/search\/(.+)$/);
  if (m2) {
    try {
      const q = decodeURIComponent(m2[1]);
      const d = await httpsGet('https://cvrapi.dk/api?search=' + encodeURIComponent(q) + '&country=dk');
      if (d.error || !d.name) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('[]'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([{ name: d.name, cvr: String(d.vat || ''), city: d.city || '' }]));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Statiske filer
  serveStatic(req, res);

}).listen(PORT, () => {
  console.log(`\n✅  ChainGuard kører på port ${PORT}\n`);
});
