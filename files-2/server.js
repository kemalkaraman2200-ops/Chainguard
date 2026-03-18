/**
 * ChainGuard — CVR Proxy Server
 * ─────────────────────────────
 * Løser CORS-problemet ved at proxye requests til cvrapi.dk og virk.dk
 * fra serveren i stedet for browseren.
 *
 * Start:  node server.js
 * Kræver: Node.js 18+ (ingen npm-pakker nødvendige)
 *
 * Endpoints:
 *   GET  /api/cvr/:nummer        — slå CVR-nummer op
 *   GET  /api/cvr/search/:query  — søg på firmanavn
 *   GET  /                       — server chainguard-final.html
 */

const http     = require('http');
const https    = require('https');
const fs       = require('fs');
const path     = require('path');
const url      = require('url');

const PORT = process.env.PORT || 3000;

// ── CORS headers ───────────────────────────────────────────────
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ── Fetch helper (Node built-in https) ────────────────────────
function httpsGet(targetUrl) {
  return new Promise((resolve, reject) => {
    const opts = {
      ...url.parse(targetUrl),
      headers: {
        'User-Agent':    'ChainGuard Compliance Platform/1.0',
        'Accept':        'application/json',
        'Cache-Control': 'no-cache',
      },
    };
    const req = https.get(opts, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { reject(new Error('Invalid JSON from upstream')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ── Optional: Official Virk API (POST, Basic auth) ────────────
function httpsPost(targetUrl, body, authHeader) {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(targetUrl);
    const data   = JSON.stringify(body);
    const opts = {
      hostname: parsed.hostname,
      path:     parsed.path,
      method:   'POST',
      headers: {
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent':    'ChainGuard Compliance Platform/1.0',
        ...(authHeader ? { 'Authorization': authHeader } : {}),
      },
    };
    const req = https.request(opts, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch(e) { reject(new Error('Invalid JSON from Virk API')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(data);
    req.end();
  });
}

// ── Normalize cvrapi.dk response ──────────────────────────────
function normalizeCvrapi(d) {
  return {
    name:        d.name        || '—',
    vat:         String(d.vat  || ''),
    address:     [d.address, d.zipcode, d.city].filter(Boolean).join(', ') || '—',
    industrydesc:d.industrydesc|| '—',
    industrycode:d.industrycode|| '',
    companydesc: d.companydesc || d.companycode || '—',
    startdate:   d.startdate   || '',
    employees:   d.employees   ?? null,
    phone:       d.phone       || '—',
    enddate:     d.enddate     || null,
    _source:     'cvrapi',
  };
}

// ── Route handler ─────────────────────────────────────────────
async function handleRequest(req, res) {
  const parsedUrl  = url.parse(req.url, true);
  const pathname   = parsedUrl.pathname;

  setCors(res);

  // Preflight
  if(req.method === 'OPTIONS') {
    res.writeHead(204); res.end(); return;
  }

  // ── Serve HTML frontend ──────────────────────────────────────
  if(pathname === '/' || pathname === '/index.html') {
    const htmlPath = path.join(__dirname, 'chainguard-final.html');
    if(!fs.existsSync(htmlPath)) {
      res.writeHead(404, {'Content-Type':'text/plain'});
      res.end('chainguard-final.html ikke fundet i samme mappe som server.js');
      return;
    }
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
    fs.createReadStream(htmlPath).pipe(res);
    return;
  }

  // ── CVR number lookup: GET /api/cvr/:number ──────────────────
  const cvrMatch = pathname.match(/^\/api\/cvr\/(\d{8})$/);
  if(cvrMatch) {
    const cvr = cvrMatch[1];
    try {
      // Try official Virk API first if Authorization header is forwarded
      const authHeader = req.headers['x-virk-auth'];
      if(authHeader) {
        try {
          const result = await httpsPost(
            'https://distribution.virk.dk/cvr-permanent/virksomhed/_search',
            { query: { term: { 'Vrvirksomhed.cvrNummer': cvr } }, size: 1 },
            authHeader
          );
          if(result.status === 200) {
            const hit = result.body?.hits?.hits?.[0]?._source?.Vrvirksomhed;
            if(hit) {
              const normalized = normalizeVirkHit(hit);
              res.writeHead(200, {'Content-Type':'application/json'});
              res.end(JSON.stringify(normalized));
              return;
            }
          }
        } catch(e) { /* fall through to cvrapi */ }
      }

      // cvrapi.dk fallback
      const result = await httpsGet(`https://cvrapi.dk/api?search=${cvr}&country=dk`);
      if(result.status !== 200 || result.body.error) {
        res.writeHead(404, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ error: result.body?.error || 'NOT_FOUND' }));
        return;
      }
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify(normalizeCvrapi(result.body)));
    } catch(e) {
      console.error('CVR lookup error:', e.message);
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── Name search: GET /api/cvr/search/:query ──────────────────
  const nameMatch = pathname.match(/^\/api\/cvr\/search\/(.+)$/);
  if(nameMatch) {
    const query = decodeURIComponent(nameMatch[1]);
    try {
      const authHeader = req.headers['x-virk-auth'];
      if(authHeader) {
        try {
          const result = await httpsPost(
            'https://distribution.virk.dk/cvr-permanent/virksomhed/_search',
            {
              query: { match: { 'Vrvirksomhed.navne.navn': { query, fuzziness: 'AUTO' } } },
              _source: ['Vrvirksomhed.cvrNummer','Vrvirksomhed.navne',
                        'Vrvirksomhed.beliggenhedsadresse','Vrvirksomhed.virksomhedsform'],
              size: 8,
            },
            authHeader
          );
          if(result.status === 200) {
            const hits = (result.body?.hits?.hits || [])
              .map(h => h._source?.Vrvirksomhed)
              .filter(Boolean)
              .map(h => ({
                name: h.navne?.slice(-1)?.[0]?.navn || '—',
                cvr:  String(h.cvrNummer || ''),
                city: h.beliggenhedsadresse?.slice(-1)?.[0]?.postdistrikt || '',
                form: h.virksomhedsform?.slice(-1)?.[0]?.kortBeskrivelse || '',
              }));
            res.writeHead(200, {'Content-Type':'application/json'});
            res.end(JSON.stringify(hits));
            return;
          }
        } catch(e) { /* fall through */ }
      }

      // cvrapi.dk fallback (single best match)
      const result = await httpsGet(`https://cvrapi.dk/api?search=${encodeURIComponent(query)}&country=dk`);
      if(result.status === 200 && !result.body.error && result.body.name) {
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify([{
          name: result.body.name,
          cvr:  String(result.body.vat || ''),
          city: result.body.city || '',
          form: result.body.companydesc || '',
        }]));
      } else {
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify([]));
      }
    } catch(e) {
      console.error('Name search error:', e.message);
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // 404
  res.writeHead(404, {'Content-Type':'application/json'});
  res.end(JSON.stringify({ error: 'Not found' }));
}

// ── Virk Elasticsearch normalizer ────────────────────────────
function normalizeVirkHit(hit) {
  const navn   = hit.navne?.slice(-1)?.[0]?.navn || '—';
  const adr    = hit.beliggenhedsadresse?.slice(-1)?.[0];
  const addr   = adr
    ? [adr.vejnavn + ' ' + (adr.husnummerFra || ''), adr.postnummer, adr.postdistrikt].filter(Boolean).join(', ')
    : '—';
  const ind    = hit.brancheAnsvarskode?.branche?.slice(-1)?.[0];
  const active = hit.virksomhedsstatus?.slice(-1)?.[0]?.status === 'NORMAL';
  return {
    name:        navn,
    vat:         String(hit.cvrNummer || ''),
    address:     addr,
    industrydesc:ind?.branchetekst || '—',
    industrycode:ind?.branchekode  || '',
    companydesc: hit.virksomhedsform?.slice(-1)?.[0]?.kortBeskrivelse || '—',
    startdate:   hit.stiftelsesDato || '',
    employees:   hit.aarsvaerk?.slice(-1)?.[0]?.antalAarsvaerk ?? null,
    phone:       hit.telefonNummer?.slice(-1)?.[0]?.kontaktoplysning || '—',
    enddate:     active ? null : 'ophørt',
    _source:     'virk',
  };
}

// ── Start server ──────────────────────────────────────────────
const server = http.createServer(handleRequest);
server.listen(PORT, () => {
  console.log(`\n✅  ChainGuard proxy server kører på http://localhost:${PORT}`);
  console.log(`   → Åbn http://localhost:${PORT} i din browser\n`);
  console.log('   Endpoints:');
  console.log(`   GET  http://localhost:${PORT}/api/cvr/25450040`);
  console.log(`   GET  http://localhost:${PORT}/api/cvr/search/Novo%20Nordisk\n`);
});
