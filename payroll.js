// ── Lønkontrol ──────────────────────────────────────────────
// Kernekontrollen i ChainGuard: sammenhold fire uafhængige kilder for hver
// medarbejder i en lønperiode.
//
//   1  Tidsregistrering  → faktisk arbejdstid og projekt
//   2  Lønsystem         → beregnet løn, tillæg og fradrag
//   3  Indberetning      → indberettet løn og medarbejdere
//   4  Bank              → faktisk udbetalt nettoløn
//
// En medarbejder bliver først grøn, når alle fire hænger sammen. Modulet er
// rent regnestykke uden database, så en kontrol kan køres om med den
// regelversion, der gjaldt i den kontrollerede lønperiode.

const crypto = require('crypto');

const HASH_SALT = process.env.PAYROLL_HASH_SALT || 'chainguard-payroll';

// Kontonummer gemmes aldrig. Hashet bruges udelukkende til at opdage, at
// flere ansatte får løn på samme konto.
function bankHash(account) {
  if (!account) return null;
  const digits = String(account).replace(/\D/g, '');
  if (!digits) return null;
  return crypto.createHash('sha256').update(HASH_SALT + digits).digest('hex');
}

function bankLast4(account) {
  if (!account) return null;
  const digits = String(account).replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

const num = v => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const n0 = v => num(v) || 0;
const kr = v => (v == null ? '—' : Number(v).toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kr.');
const dk = d => (d ? new Date(d).toLocaleDateString('da-DK') : '—');
const days = (a, b) => Math.max(1, Math.round((new Date(b) - new Date(a)) / 86400000) + 1);

// ── Regelsæt ────────────────────────────────────────────────
// Bruges når leverandøren ikke har et registreret kontrolgrundlag. Satserne
// er et udgangspunkt, der skal erstattes af virksomhedens overenskomst eller
// hovedentreprenørens arbejdsklausul.
const DEFAULT_RULESET = {
  name: 'Kontraktuelt kontrolgrundlag',
  version: 'v1.0',
  basis: 'contract',
  min_hourly: null,
  overtime_factor: 1.5,
  pension_pct: null,
  holiday_pct: 12.5,
  max_weekly_hours: 48,
  source: 'Standardgrundlag — erstattes af kontraktens vilkår',
};

// ── Kontrolregler ───────────────────────────────────────────
// severity 'critical' giver rød status og overstyrer den samlede score.
// Hver regel returnerer en forklaring, eller null hvis den ikke er brudt.
const RULES = [
  {
    code: 'NOT_IN_PAYROLL',
    label: 'Timer findes, men medarbejderen findes ikke i lønsystemet',
    severity: 'critical',
    test: ({ line }) =>
      !line.in_payroll && (n0(line.hours_normal) + n0(line.hours_overtime)) > 0
        ? `Der er registreret ${n0(line.hours_normal) + n0(line.hours_overtime)} timer på projektet, men personen indgår ikke i lønsystemet og er ikke indberettet.`
        : null,
  },
  {
    code: 'WORK_BEFORE_EMPLOYMENT',
    label: 'Medarbejderen arbejder før ansættelsesdatoen',
    severity: 'critical',
    test: ({ line, emp, period }) =>
      emp.employed_from && new Date(period.period_start) < new Date(emp.employed_from) &&
      (n0(line.hours_normal) + n0(line.hours_overtime)) > 0
        ? `Lønperioden begynder ${dk(period.period_start)}, men ansættelsen er registreret fra ${dk(emp.employed_from)}.`
        : null,
  },
  {
    code: 'NOT_REPORTED',
    label: 'Lønnen er ikke indberettet',
    severity: 'critical',
    test: ({ line }) =>
      line.in_payroll && n0(line.net) > 0 && !line.reported
        ? `Der er beregnet en løn på ${kr(line.net)} netto, men lønnen er ikke indberettet for perioden.`
        : null,
  },
  {
    code: 'NET_NOT_PAID',
    label: 'Nettolønnen er ikke udbetalt',
    severity: 'critical',
    test: ({ line }) =>
      line.in_payroll && n0(line.net) > 0 && n0(line.bank_paid) === 0
        ? `Lønseddel og indberetning viser ${kr(line.net)} netto, men der er ingen tilsvarende udbetaling på virksomhedens konto.`
        : null,
  },
  {
    code: 'BANK_MISMATCH',
    label: 'Bankbeløbet afviger fra lønsedlen',
    severity: 'critical',
    test: ({ line }) => {
      const net = n0(line.net), paid = n0(line.bank_paid);
      if (!(net > 0 && paid > 0)) return null;
      const diff = Math.abs(net - paid);
      return diff > 1
        ? `Lønsedlen viser ${kr(net)} netto, men der er udbetalt ${kr(paid)}. Forskel: ${kr(diff)}.`
        : null;
    },
  },
  {
    code: 'SHARED_BANK_ACCOUNT',
    label: 'Flere ansatte får løn på samme bankkonto',
    severity: 'critical',
    test: ({ emp, sharedAccounts }) =>
      emp.bank_hash && sharedAccounts.has(emp.bank_hash)
        ? `Kontoen ••••${emp.bank_last4 || '????'} modtager løn for ${sharedAccounts.get(emp.bank_hash).length} medarbejdere i samme lønperiode: ${sharedAccounts.get(emp.bank_hash).join(', ')}.`
        : null,
  },
  {
    code: 'REPORTED_MISMATCH',
    label: 'Indberettet beløb afviger fra lønsedlen',
    severity: 'warning',
    test: ({ line }) => {
      const gross = n0(line.gross), rep = num(line.reported_amount);
      if (!(line.reported && rep != null && gross > 0)) return null;
      return Math.abs(gross - rep) > 1
        ? `Lønsedlen viser ${kr(gross)} brutto, men der er indberettet ${kr(rep)}.`
        : null;
    },
  },
  {
    code: 'BELOW_MIN_RATE',
    label: 'Lønnen er lavere end det gældende kontrolgrundlag',
    severity: 'critical',
    test: ({ line, ruleset }) => {
      const min = num(ruleset.min_hourly);
      const hours = n0(line.hours_normal) + n0(line.hours_overtime);
      const gross = n0(line.gross);
      if (!(min && hours > 0 && gross > 0)) return null;
      const actual = gross / hours;
      return actual < min - 0.01
        ? `Effektiv timeløn er ${kr(actual)} mod et kontrolgrundlag på ${kr(min)} (${ruleset.name} ${ruleset.version}).`
        : null;
    },
  },
  {
    code: 'MISSING_OVERTIME_SUPPLEMENT',
    label: 'Overarbejdstillæg mangler',
    severity: 'warning',
    test: ({ line }) =>
      n0(line.hours_overtime) > 0 && n0(line.supplement) <= 0
        ? `Der er registreret ${n0(line.hours_overtime)} overarbejdstimer, men lønsedlen indeholder intet tillæg.`
        : null,
  },
  {
    code: 'MISSING_PENSION',
    label: 'Pension mangler',
    severity: 'warning',
    test: ({ line, ruleset }) =>
      num(ruleset.pension_pct) > 0 && line.in_payroll && n0(line.gross) > 0 && n0(line.pension) <= 0
        ? `Kontrolgrundlaget kræver ${ruleset.pension_pct} % pension, men lønsedlen indeholder ingen pension.`
        : null,
  },
  {
    code: 'MISSING_HOLIDAY_PAY',
    label: 'Feriepenge mangler',
    severity: 'warning',
    test: ({ line, ruleset }) =>
      num(ruleset.holiday_pct) > 0 && line.in_payroll && n0(line.gross) > 0 && n0(line.holiday_pay) <= 0
        ? `Kontrolgrundlaget kræver ${ruleset.holiday_pct} % feriepenge, men lønsedlen indeholder ingen feriepenge.`
        : null,
  },
  {
    code: 'HOURS_EXCEED_LIMIT',
    label: 'Timerne overstiger den fastsatte grænse',
    severity: 'warning',
    test: ({ line, period, ruleset }) => {
      const max = num(ruleset.max_weekly_hours);
      const hours = n0(line.hours_normal) + n0(line.hours_overtime);
      if (!(max && hours > 0)) return null;
      const weeks = days(period.period_start, period.period_end) / 7;
      const weekly = hours / Math.max(weeks, 0.2);
      return weekly > max
        ? `Gennemsnitligt ${weekly.toFixed(1)} timer om ugen mod en grænse på ${max} timer.`
        : null;
    },
  },
  {
    code: 'NOT_ON_PROJECT',
    label: 'Medarbejderen var ikke registreret på projektet',
    severity: 'warning',
    test: ({ line }) =>
      !line.on_project && (n0(line.hours_normal) + n0(line.hours_overtime)) > 0
        ? 'Der er udbetalt løn for timer, som ikke kan henføres til projektet.'
        : null,
  },
];

// ── Kontrolkørsel ───────────────────────────────────────────
// Kører alle regler over en lønperiode. Returnerer afvigelser, status pr.
// linje og en samlet status, hvor kritiske afvigelser overstyrer resten.
function runCheck(period, lines, ruleset) {
  const rules = { ...DEFAULT_RULESET, ...(ruleset || {}) };

  // Find konti, der bruges af mere end én medarbejder i perioden
  const byAccount = new Map();
  for (const l of lines) {
    if (!l.bank_hash || n0(l.bank_paid) <= 0) continue;
    if (!byAccount.has(l.bank_hash)) byAccount.set(l.bank_hash, []);
    byAccount.get(l.bank_hash).push(l.pseudonym);
  }
  const sharedAccounts = new Map([...byAccount].filter(([, v]) => v.length > 1));

  const deviations = [];
  const lineStatus = new Map();

  for (const line of lines) {
    const emp = {
      pseudonym: line.pseudonym,
      employed_from: line.employed_from,
      employed_to: line.employed_to,
      bank_hash: line.bank_hash,
      bank_last4: line.bank_last4,
    };
    const found = [];
    for (const rule of RULES) {
      let detail = null;
      try {
        detail = rule.test({ line, emp, period, ruleset: rules, sharedAccounts });
      } catch (_) {
        detail = null; // en regel må aldrig vælte hele kontrollen
      }
      if (detail) {
        found.push({
          code: rule.code,
          label: rule.label,
          severity: rule.severity,
          detail,
          line_id: line.id,
          employee_id: line.employee_id,
          pseudonym: line.pseudonym,
        });
      }
    }
    deviations.push(...found);
    lineStatus.set(line.id, statusOf(found, line));
  }

  return { deviations, lineStatus, status: rollup(deviations, lines), ruleset: rules };
}

// Status for én medarbejder. Grå betyder "kan ikke vurderes" og må aldrig
// blive behandlet som grøn.
function statusOf(deviations, line) {
  if (deviations.some(d => d.severity === 'critical')) return 'red';
  if (deviations.some(d => d.severity === 'warning')) return 'amber';
  const complete = line.in_payroll && line.net != null && line.bank_paid != null;
  return complete ? 'green' : 'grey';
}

function rollup(deviations, lines) {
  const open = deviations.filter(d => !d.resolved_at);
  if (open.some(d => d.severity === 'critical')) return 'red';
  if (open.some(d => d.severity === 'warning')) return 'amber';
  if (!lines.length) return 'grey';
  return lines.every(l => l.in_payroll && l.net != null && l.bank_paid != null) ? 'green' : 'grey';
}

const STATUS_META = {
  green: { label: 'Grøn · godkendt',        cls: 's-green' },
  amber: { label: 'Gul · handling kræves',  cls: 's-amber' },
  red:   { label: 'Rød · ikke compliant',   cls: 's-red'   },
  grey:  { label: 'Grå · kan ikke vurderes', cls: 's-gray' },
};

// ── CSV-import ──────────────────────────────────────────────
// Tolerant over for dansk Excel: både komma og semikolon som separator og
// decimalkomma i beløb. Ukendte kolonner ignoreres.
const CSV_FIELDS = {
  medarbejder: 'employee_ref', medarbejder_ref: 'employee_ref', medarbejdernr: 'employee_ref',
  faggruppe: 'job_group', jobfunktion: 'job_group',
  ansat_fra: 'employed_from', ansat_til: 'employed_to',
  timer_normal: 'hours_normal', timer: 'hours_normal',
  timer_overtid: 'hours_overtime', overarbejde: 'hours_overtime',
  timeloen: 'hourly_rate', timeløn: 'hourly_rate',
  brutto: 'gross', bruttoloen: 'gross', bruttoløn: 'gross',
  netto: 'net', nettoloen: 'net', nettoløn: 'net',
  tillaeg: 'supplement', tillæg: 'supplement',
  pension: 'pension',
  feriepenge: 'holiday_pay',
  indberettet: 'reported',
  indberettet_beloeb: 'reported_amount', indberettet_beløb: 'reported_amount',
  bank_konto: 'bank_account', konto: 'bank_account',
  bank_betalt: 'bank_paid', udbetalt: 'bank_paid',
  bank_dato: 'bank_paid_at', udbetalingsdato: 'bank_paid_at',
  paa_projekt: 'on_project', på_projekt: 'on_project',
  betalt_fra: 'paid_from_account', afsenderkonto: 'paid_from_account',
  i_loensystem: 'in_payroll', i_lønsystem: 'in_payroll',
};

const NUMERIC_FIELDS = ['hours_normal', 'hours_overtime', 'hourly_rate', 'gross', 'net',
                        'supplement', 'pension', 'holiday_pay', 'reported_amount', 'bank_paid'];
const BOOL_FIELDS = ['reported', 'on_project', 'in_payroll'];

const normalizeHeader = h =>
  h.trim().toLowerCase().replace(/^﻿/, '').replace(/[\s.-]+/g, '_');

const toBool = v => {
  const s = String(v || '').trim().toLowerCase();
  if (['ja', 'true', '1', 'x', 'y'].includes(s)) return true;
  if (['nej', 'false', '0', ''].includes(s)) return false;
  return null;
};

function splitLine(line, sep) {
  const out = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (c === sep && !quoted) {
      out.push(cur); cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function parseCSV(text) {
  const lines = String(text).split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { rows: [], errors: ['Filen er tom.'] };

  const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
  const headers = splitLine(lines[0], sep).map(normalizeHeader);
  const mapped = headers.map(h => CSV_FIELDS[h] || null);

  if (!mapped.includes('employee_ref')) {
    return { rows: [], errors: ['Kolonnen "medarbejder" mangler. Hent skabelonen for det forventede format.'] };
  }

  const rows = [], errors = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i], sep);
    const row = {};
    mapped.forEach((field, idx) => {
      if (!field) return;
      const raw = cells[idx];
      if (NUMERIC_FIELDS.includes(field)) row[field] = num(raw);
      else if (BOOL_FIELDS.includes(field)) row[field] = toBool(raw);
      else row[field] = raw === '' ? null : raw;
    });

    if (!row.employee_ref) { errors.push(`Linje ${i + 1}: medarbejder mangler — sprunget over.`); continue; }
    if (row.in_payroll == null) row.in_payroll = row.net != null || row.gross != null;
    if (row.on_project == null) row.on_project = true;
    if (row.reported == null) row.reported = false;
    if (row.bank_account) {
      row.bank_hash = bankHash(row.bank_account);
      row.bank_last4 = bankLast4(row.bank_account);
      delete row.bank_account; // hele kontonummeret forlader aldrig importen
    }
    if (row.paid_from_account) {
      row.paid_from_hash = bankHash(row.paid_from_account);
      row.paid_from_last4 = bankLast4(row.paid_from_account);
      delete row.paid_from_account;
    }
    rows.push(row);
  }
  return { rows, errors };
}

// ── Maskering ───────────────────────────────────────────────
// Hovedvirksomheden ser kontrolresultatet, ikke lønsedlen. Beløb, satser og
// kontooplysninger fjernes serverside, så de aldrig når browseren.
const MASKED_FIELDS = ['hourly_rate', 'gross', 'net', 'supplement', 'pension',
                       'holiday_pay', 'reported_amount', 'bank_paid', 'bank_last4'];

// Afvigelsesteksten forklarer, hvad der er galt — men den må ikke røbe de
// beløb og kontooplysninger, som tabellen netop har skjult.
function maskDetail(detail, view) {
  if (view !== 'main' || !detail) return detail;
  return String(detail)
    .replace(/\d[\d.]*,\d{2} kr\./g, 'et beløb')
    .replace(/Kontoen ••••\d{4}/g, 'Den anvendte konto')
    .replace(/••••\d{4}/g, 'kontoen');
}

function maskLine(line, view) {
  if (view !== 'main') return line;
  const out = { ...line };
  for (const f of MASKED_FIELDS) {
    if (out[f] != null) out[f] = null;
  }
  out.masked = true;
  // Kontrolresultatet består: timer, om lønnen er indberettet og udbetalt
  out.net_paid = line.bank_paid != null && n0(line.bank_paid) > 0;
  return out;
}

module.exports = {
  RULES, DEFAULT_RULESET, STATUS_META,
  runCheck, rollup, statusOf,
  parseCSV, maskLine, maskDetail, bankHash, bankLast4,
  fmt: { num, kr, dk },
};
