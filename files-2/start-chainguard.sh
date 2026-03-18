#!/bin/bash
# ─────────────────────────────────────────────────────────────
# ChainGuard — Start-script
# Kør dette fra den mappe hvor chainguard-final.html ligger
# ─────────────────────────────────────────────────────────────

set -e

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo -e "${BOLD}╔══════════════════════════════════════╗${NC}"
echo -e "${BOLD}║   ChainGuard — Starter               ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════╝${NC}"
echo ""

# ── Tjek at chainguard-final.html findes ─────────────────────
if [ ! -f "chainguard-final.html" ]; then
  echo -e "${RED}✗ Fejl: chainguard-final.html blev ikke fundet i denne mappe.${NC}"
  echo ""
  echo "  Sørg for at køre dette script fra den mappe"
  echo "  hvor chainguard-final.html ligger."
  echo ""
  echo "  Eksempel:"
  echo "  cd ~/Downloads && bash start-chainguard.sh"
  echo ""
  exit 1
fi

# ── Tjek Node.js ─────────────────────────────────────────────
if ! command -v node &> /dev/null; then
  echo -e "${RED}✗ Node.js er ikke installeret.${NC}"
  echo ""
  echo "  Kør dette først:"
  echo "  brew install node"
  echo ""
  exit 1
fi

NODE_VER=$(node --version)
echo -e "${GREEN}✓ Node.js ${NODE_VER} fundet${NC}"

# ── Opret server.js hvis den ikke findes ─────────────────────
if [ ! -f "server.js" ]; then
  echo -e "${YELLOW}→ Opretter server.js...${NC}"

  cat > server.js << 'SERVEREOF'
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');
const PORT  = process.env.PORT || 3000;

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Virk-Auth');
}

function httpsGet(targetUrl) {
  return new Promise((resolve, reject) => {
    const opts = {
      ...url.parse(targetUrl),
      headers: { 'User-Agent': 'ChainGuard/1.0', 'Accept': 'application/json' },
    };
    const req = https.get(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { reject(new Error('Ugyldigt JSON-svar')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function httpsPost(targetUrl, body, authHeader) {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(targetUrl);
    const data   = JSON.stringify(body);
    const req = https.request({
      hostname: parsed.hostname, path: parsed.path, method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data),
        'User-Agent': 'ChainGuard/1.0',
        ...(authHeader ? { 'Authorization': authHeader } : {}),
      },
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(b) }); }
        catch(e) { reject(new Error('Ugyldigt JSON fra Virk')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(data); req.end();
  });
}

function normalizeCvrapi(d) {
  return {
    name: d.name || '—', vat: String(d.vat || ''),
    address: [d.address, d.zipcode, d.city].filter(Boolean).join(', ') || '—',
    industrydesc: d.industrydesc || '—', industrycode: d.industrycode || '',
    companydesc: d.companydesc || d.companycode || '—',
    startdate: d.startdate || '', employees: d.employees ?? null,
    phone: d.phone || '—', enddate: d.enddate || null, _source: 'cvrapi',
  };
}

function normalizeVirk(hit) {
  const navn = hit.navne?.slice(-1)?.[0]?.navn || '—';
  const adr  = hit.beliggenhedsadresse?.slice(-1)?.[0];
  const addr = adr ? [adr.vejnavn+' '+(adr.husnummerFra||''),adr.postnummer,adr.postdistrikt].filter(Boolean).join(', ') : '—';
  const ind  = hit.brancheAnsvarskode?.branche?.slice(-1)?.[0];
  const ok   = hit.virksomhedsstatus?.slice(-1)?.[0]?.status === 'NORMAL';
  return {
    name: navn, vat: String(hit.cvrNummer||''), address: addr,
    industrydesc: ind?.branchetekst||'—', industrycode: ind?.branchekode||'',
    companydesc: hit.virksomhedsform?.slice(-1)?.[0]?.kortBeskrivelse||'—',
    startdate: hit.stiftelsesDato||'', employees: hit.aarsvaerk?.slice(-1)?.[0]?.antalAarsvaerk??null,
    phone: hit.telefonNummer?.slice(-1)?.[0]?.kontaktoplysning||'—',
    enddate: ok ? null : 'ophørt', _source: 'virk',
  };
}

async function handleRequest(req, res) {
  const p = url.parse(req.url, true).pathname;
  setCors(res);
  if(req.method==='OPTIONS') { res.writeHead(204); res.end(); return; }

  // Serve HTML
  if(p==='/' || p==='/index.html') {
    const f = path.join(__dirname, 'chainguard-final.html');
    if(!fs.existsSync(f)) { res.writeHead(404); res.end('chainguard-final.html mangler'); return; }
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
    fs.createReadStream(f).pipe(res); return;
  }

  const auth = req.headers['x-virk-auth'];

  // CVR nummer: GET /api/cvr/12345678
  const m1 = p.match(/^\/api\/cvr\/(\d{8})$/);
  if(m1) {
    const cvr = m1[1];
    try {
      if(auth) {
        try {
          const r = await httpsPost('https://distribution.virk.dk/cvr-permanent/virksomhed/_search',
            { query: { term: { 'Vrvirksomhed.cvrNummer': cvr } }, size: 1 }, auth);
          if(r.status===200) {
            const hit = r.body?.hits?.hits?.[0]?._source?.Vrvirksomhed;
            if(hit) { res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(normalizeVirk(hit))); return; }
          }
        } catch(e) {}
      }
      const r = await httpsGet(`https://cvrapi.dk/api?search=${cvr}&country=dk`);
      if(r.status!==200||r.body.error) { res.writeHead(404,{'Content-Type':'application/json'}); res.end(JSON.stringify({error:'NOT_FOUND'})); return; }
      res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(normalizeCvrapi(r.body)));
    } catch(e) { res.writeHead(500,{'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // Navn søgning: GET /api/cvr/search/Novo
  const m2 = p.match(/^\/api\/cvr\/search\/(.+)$/);
  if(m2) {
    const q = decodeURIComponent(m2[1]);
    try {
      if(auth) {
        try {
          const r = await httpsPost('https://distribution.virk.dk/cvr-permanent/virksomhed/_search', {
            query: { match: { 'Vrvirksomhed.navne.navn': { query: q, fuzziness: 'AUTO' } } },
            _source: ['Vrvirksomhed.cvrNummer','Vrvirksomhed.navne','Vrvirksomhed.beliggenhedsadresse'], size: 8,
          }, auth);
          if(r.status===200) {
            const hits = (r.body?.hits?.hits||[]).map(h=>h._source?.Vrvirksomhed).filter(Boolean)
              .map(h=>({ name:h.navne?.slice(-1)?.[0]?.navn||'—', cvr:String(h.cvrNummer||''), city:h.beliggenhedsadresse?.slice(-1)?.[0]?.postdistrikt||'' }));
            res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(hits)); return;
          }
        } catch(e) {}
      }
      const r = await httpsGet(`https://cvrapi.dk/api?search=${encodeURIComponent(q)}&country=dk`);
      if(r.status===200&&!r.body.error&&r.body.name) {
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify([{ name:r.body.name, cvr:String(r.body.vat||''), city:r.body.city||'' }]));
      } else { res.writeHead(200,{'Content-Type':'application/json'}); res.end('[]'); }
    } catch(e) { res.writeHead(500,{'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  res.writeHead(404,{'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Not found'}));
}

http.createServer(handleRequest).listen(PORT, () => {
  console.log('\n\x1b[32m✅  ChainGuard kører!\x1b[0m');
  console.log('\x1b[1m   → Åbn denne adresse i din browser:\x1b[0m');
  console.log('\x1b[36m   http://localhost:' + PORT + '\x1b[0m\n');
});
SERVEREOF

  echo -e "${GREEN}✓ server.js oprettet${NC}"
else
  echo -e "${GREEN}✓ server.js fundet${NC}"
fi

# ── Start serveren ────────────────────────────────────────────
echo ""
echo -e "${BOLD}Starter server...${NC}"
echo -e "${YELLOW}  Tryk Ctrl+C for at stoppe den igen${NC}"
echo ""

node server.js
