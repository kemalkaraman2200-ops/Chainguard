// ── NemKonto-kontrol ────────────────────────────────────────
// Kontrollerer virksomhedens udbetalingskonto og sammenholder den med
// lønudbetalingerne.
//
// Vigtigt om datakilden: NemKontoregisteret kan ikke slås op af private
// virksomheder. Opslag er forbeholdt offentlige myndigheder, der skal
// udbetale penge. ChainGuard henter derfor ikke kontoen automatisk —
// leverandøren oplyser den, og kontrollen verificerer den mod de kilder,
// systemet allerede har adgang til:
//
//   · bankforbindelsens kontoejer (PSD2/kontooplysningstjeneste)
//   · fakturakontoen på leverandørens fakturaer
//   · den konto, lønnen faktisk er udbetalt fra
//   · medarbejdernes lønkonti — samme konto begge steder er et alarmsignal
//
// Kontonummeret gemmes aldrig. Kun registreringsnummer, de sidste fire
// cifre og et hash, der gør det muligt at sammenligne konti.

const crypto = require('crypto');

const HASH_SALT = process.env.PAYROLL_HASH_SALT || 'chainguard-payroll';

function accountHash(digits) {
  if (!digits) return null;
  return crypto.createHash('sha256').update(HASH_SALT + digits).digest('hex');
}

// Dansk kontonummer: 4 cifres registreringsnummer og op til 10 cifres
// kontonummer. Modulus-kontrollen er bankspecifik og indgår ikke — et
// formelt gyldigt nummer er derfor ikke det samme som en konto, der findes.
function parseAccount(regNo, accountNo) {
  const reg = String(regNo || '').replace(/\D/g, '');
  const acct = String(accountNo || '').replace(/\D/g, '');

  if (!reg && !acct) return { valid: false, error: 'Registreringsnummer og kontonummer mangler.' };
  if (reg.length !== 4) return { valid: false, error: 'Registreringsnummeret skal være fire cifre.' };
  if (acct.length < 6 || acct.length > 10) {
    return { valid: false, error: 'Kontonummeret skal være mellem seks og ti cifre.' };
  }

  return {
    valid: true,
    reg_no: reg,
    account_last4: acct.slice(-4),
    account_hash: accountHash(reg + acct.padStart(10, '0')),
  };
}

// Sammenligner to kontoangivelser uden at kende numrene
const sameAccount = (a, b) => !!(a && b && a === b);

// Navnesammenligning skal tåle "ApS", "A/S", store bogstaver og bindestreger,
// men må ikke acceptere et helt andet firmanavn.
function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(aps|a\/s|as|i\/s|ivs|p\/s|ltd|gmbh|uab|oü|sia|sp\.? z ?o\.?o\.?)\b/g, '')
    .replace(/[^a-z0-9æøå]+/g, ' ')
    .trim();
}

function namesMatch(a, b) {
  const x = normalizeName(a), y = normalizeName(b);
  if (!x || !y) return null;            // kan ikke vurderes
  return x === y || x.includes(y) || y.includes(x);
}

// ── Kontrolregler ───────────────────────────────────────────
// Samme form som lønkontrollens regler: hver regel returnerer en forklaring
// eller null. 'critical' giver rød status.
const RULES = [
  {
    code: 'NEMKONTO_MISSING',
    label: 'NemKonto er ikke oplyst',
    severity: 'critical',
    test: ({ account }) =>
      !account ? 'Leverandøren har ikke oplyst sin NemKonto, så udbetalinger kan ikke kontrolleres.' : null,
  },
  {
    code: 'NEMKONTO_UNVERIFIED',
    label: 'NemKonto er oplyst, men ikke verificeret',
    severity: 'warning',
    test: ({ account }) =>
      account && !account.verified
        ? `Kontoen ${account.reg_no} ••••${account.account_last4} er oplyst af leverandøren selv og endnu ikke bekræftet mod bankforbindelsen.`
        : null,
  },
  {
    code: 'NEMKONTO_HOLDER_MISMATCH',
    label: 'Kontoejeren er ikke virksomheden',
    severity: 'critical',
    test: ({ account, supplierName }) => {
      if (!account || !account.holder_name) return null;
      const match = namesMatch(account.holder_name, supplierName);
      return match === false
        ? `Banken oplyser "${account.holder_name}" som kontoejer, men leverandøren er registreret som "${supplierName}".`
        : null;
    },
  },
  {
    code: 'NEMKONTO_INVOICE_MISMATCH',
    label: 'Fakturakontoen matcher ikke NemKontoen',
    severity: 'critical',
    test: ({ account, invoiceAccount }) => {
      if (!account || !invoiceAccount) return null;
      return !sameAccount(account.account_hash, invoiceAccount.account_hash)
        ? `Fakturaen anviser betaling til ${invoiceAccount.reg_no} ••••${invoiceAccount.account_last4}, men virksomhedens NemKonto er ${account.reg_no} ••••${account.account_last4}.`
        : null;
    },
  },
  {
    code: 'NEMKONTO_CHANGED',
    label: 'Udbetalingskontoen er ændret i projektperioden',
    severity: 'warning',
    test: ({ account, history }) => {
      if (!account || !history || history.length < 2) return null;
      const previous = history.find(h => h.account_hash !== account.account_hash);
      if (!previous) return null;
      const when = account.valid_from ? new Date(account.valid_from).toLocaleDateString('da-DK') : 'ukendt dato';
      return `Kontoen blev ændret ${when} fra ${previous.reg_no} ••••${previous.account_last4} til ${account.reg_no} ••••${account.account_last4}. Bekræft ændringen med leverandøren, før der udbetales.`;
    },
  },
  {
    code: 'NEMKONTO_IS_EMPLOYEE_ACCOUNT',
    label: 'NemKontoen bruges også som lønkonto for en medarbejder',
    severity: 'critical',
    test: ({ account, employees }) => {
      if (!account || !employees || !employees.length) return null;
      const hits = employees.filter(e => sameAccount(e.bank_hash, account.account_hash));
      return hits.length
        ? `Virksomhedens udbetalingskonto står også som lønkonto for ${hits.map(e => e.pseudonym).join(', ')}. Lønnen ender dermed samme sted, som den kom fra.`
        : null;
    },
  },
  {
    code: 'SALARY_NOT_FROM_NEMKONTO',
    label: 'Lønnen er ikke udbetalt fra den verificerede konto',
    severity: 'warning',
    test: ({ account, payouts }) => {
      if (!account || !payouts || !payouts.length) return null;
      const other = payouts.filter(p => p.paid_from_hash && !sameAccount(p.paid_from_hash, account.account_hash));
      if (!other.length) return null;
      const konti = [...new Set(other.map(p => '••••' + (p.paid_from_last4 || '????')))];
      const n = other.length;
      return `${n} lønudbetaling${n === 1 ? '' : 'er'} kommer fra ${konti.join(', ')} og ikke fra virksomhedens NemKonto.`;
    },
  },
];

// ── Kontrolkørsel ───────────────────────────────────────────
// ctx: { account, history, supplierName, invoiceAccount, employees, payouts }
function runCheck(ctx) {
  const deviations = [];
  for (const rule of RULES) {
    let detail = null;
    try {
      detail = rule.test(ctx);
    } catch (_) {
      detail = null; // en regel må aldrig vælte hele kontrollen
    }
    if (detail) deviations.push({ code: rule.code, label: rule.label, severity: rule.severity, detail });
  }

  // Manglende konto er ikke en afvisning, men en oplysning der ikke kan
  // vurderes. Grå må aldrig tælle som grøn — compliance-tjekket regner den
  // derfor stadig som et ikke-opfyldt krav.
  let status;
  if (!ctx.account) status = 'grey';
  else if (deviations.some(d => d.severity === 'critical')) status = 'red';
  else if (deviations.some(d => d.severity === 'warning')) status = 'amber';
  else status = 'green';

  return { status, deviations };
}

// Oversættelse til compliance-tjekkets ok/warn/fail
const toRequirementResult = status =>
  ({ green: 'ok', amber: 'warn', red: 'fail', grey: 'fail' }[status] || 'fail');

const STATUS_META = {
  green: { label: 'Verificeret',        cls: 's-green' },
  amber: { label: 'Kræver handling',    cls: 's-amber' },
  red:   { label: 'Afvist',             cls: 's-red'   },
  grey:  { label: 'Ikke oplyst',        cls: 's-gray'  },
};

module.exports = {
  RULES, STATUS_META,
  parseAccount, accountHash, runCheck, namesMatch, normalizeName,
  toRequirementResult, sameAccount,
};
