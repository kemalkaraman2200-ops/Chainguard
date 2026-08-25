const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGNOSSL ? false : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

async function runSQL(label, sql) {
  try {
    await pool.query(sql);
  } catch (e) {
    console.warn(`[DB] ${label}: ${e.message}`);
  }
}

async function init() {
  // Kerne-tabeller
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id         SERIAL PRIMARY KEY,
      email      VARCHAR(255) UNIQUE NOT NULL,
      password   VARCHAR(255) NOT NULL,
      name       VARCHAR(255),
      role       VARCHAR(50)  DEFAULT 'user',
      created_at TIMESTAMPTZ  DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id           SERIAL PRIMARY KEY,
      user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
      cvr          VARCHAR(8),
      name         VARCHAR(255) NOT NULL,
      address      VARCHAR(500),
      industry     VARCHAR(255),
      type         VARCHAR(255),
      country      VARCHAR(100) DEFAULT 'Danmark',
      employees    INTEGER,
      phone        VARCHAR(50),
      risk         VARCHAR(10)  DEFAULT 'low',
      score        INTEGER      DEFAULT 50,
      status       VARCHAR(50)  DEFAULT 'Afventer',
      status_class VARCHAR(20)  DEFAULT 's-amber',
      notes        TEXT,
      added_at     TIMESTAMPTZ  DEFAULT NOW(),
      updated_at   TIMESTAMPTZ  DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER REFERENCES users(id),
      supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
      action      VARCHAR(100),
      details     TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS compliance_archive (
      id              SERIAL PRIMARY KEY,
      user_id         INTEGER REFERENCES users(id),
      sent_at         TIMESTAMPTZ DEFAULT NOW(),
      sent_to         VARCHAR(255),
      filename        VARCHAR(255),
      pdf_data        BYTEA,
      suppliers_count INTEGER DEFAULT 0,
      audit_entries   INTEGER DEFAULT 0,
      trigger_type    VARCHAR(20) DEFAULT 'manual',
      status          VARCHAR(20) DEFAULT 'sent',
      error_msg       TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS deviations (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
      supplier_id   INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
      supplier_name VARCHAR(255),
      title         VARCHAR(500) NOT NULL,
      description   TEXT,
      location      VARCHAR(255),
      type          VARCHAR(30)  DEFAULT 'open',
      type_label    VARCHAR(50)  DEFAULT 'Åben',
      type_class    VARCHAR(30)  DEFAULT 'chip-amber',
      status        VARCHAR(50)  DEFAULT 'Åben',
      status_class  VARCHAR(20)  DEFAULT 's-red',
      days_open     INTEGER      DEFAULT 0,
      closed_at     TIMESTAMPTZ,
      created_at    TIMESTAMPTZ  DEFAULT NOW(),
      updated_at    TIMESTAMPTZ  DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS compliance_results (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
      supplier_id INTEGER REFERENCES suppliers(id) ON DELETE CASCADE,
      req_id      VARCHAR(50)  NOT NULL,
      req_label   VARCHAR(255),
      result      VARCHAR(10)  NOT NULL,
      checked_at  TIMESTAMPTZ  DEFAULT NOW()
    )
  `);

  // documents — eksisterer muligvis fra tidligere version uden user_id
  await pool.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER,
      supplier_id   INTEGER,
      supplier_name VARCHAR(255),
      name          VARCHAR(255) NOT NULL,
      type          VARCHAR(50)  NOT NULL,
      status        VARCHAR(20)  DEFAULT 'gyldig',
      expiry        DATE,
      uploaded_at   TIMESTAMPTZ  DEFAULT NOW(),
      file_size     VARCHAR(20),
      file_ref      VARCHAR(500)
    )
  `);

  // cases — sager/projekter (fx en byggeplads)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cases (
      id           SERIAL PRIMARY KEY,
      user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
      name         VARCHAR(255) NOT NULL,
      address      VARCHAR(500),
      client_name  VARCHAR(255),
      status       VARCHAR(50)  DEFAULT 'active',
      total_employees INTEGER,
      created_at   TIMESTAMPTZ  DEFAULT NOW(),
      updated_at   TIMESTAMPTZ  DEFAULT NOW()
    )
  `);

  // case_subcontractors — leverandørkæde for en sag (selv-refererende for tier-struktur)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS case_subcontractors (
      id              SERIAL PRIMARY KEY,
      case_id         INTEGER REFERENCES cases(id) ON DELETE CASCADE,
      supplier_id     INTEGER REFERENCES suppliers(id) ON DELETE CASCADE,
      parent_id       INTEGER REFERENCES case_subcontractors(id) ON DELETE CASCADE,
      tier            INTEGER      DEFAULT 1,
      role_label      VARCHAR(100),
      activity        VARCHAR(255),
      employees_on_site INTEGER,
      permit_status   VARCHAR(50),
      status          VARCHAR(50)  DEFAULT 'pending',
      status_class    VARCHAR(20)  DEFAULT 's-amber',
      added_at        TIMESTAMPTZ  DEFAULT NOW(),
      updated_at      TIMESTAMPTZ  DEFAULT NOW()
    )
  `);

  // apprentices — lærlinge/elever/praktikanter (oplæringskrav)
  // client_id = frontendens eget id ('ap_...'); data = hele frontend-objektet (sync-model)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS apprentices (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
      client_id     VARCHAR(50),
      supplier_id   INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
      supplier_name VARCHAR(255),
      name          VARCHAR(255),
      type          VARCHAR(50),
      type_label    VARCHAR(100),
      education     VARCHAR(255),
      start_date    DATE,
      end_date      DATE,
      status        VARCHAR(50)  DEFAULT 'Afventer',
      data          JSONB,
      created_at    TIMESTAMPTZ  DEFAULT NOW(),
      updated_at    TIMESTAMPTZ  DEFAULT NOW(),
      UNIQUE (user_id, client_id)
    )
  `);

  // ── LØNKONTROL ──────────────────────────────────────────────
  // Regelbibliotek: satser og vilkår i versioneret form, så en lønkontrol
  // altid kan reproduceres med den regelversion, der gjaldt i lønperioden.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payroll_rulesets (
      id               SERIAL PRIMARY KEY,
      user_id          INTEGER REFERENCES users(id) ON DELETE CASCADE,
      name             VARCHAR(255) NOT NULL,
      version          VARCHAR(20)  NOT NULL,
      basis            VARCHAR(30)  DEFAULT 'contract',
      job_group        VARCHAR(100),
      valid_from       DATE NOT NULL,
      valid_to         DATE,
      min_hourly       NUMERIC(10,2),
      overtime_factor  NUMERIC(5,2)  DEFAULT 1.5,
      pension_pct      NUMERIC(5,2),
      holiday_pct      NUMERIC(5,2)  DEFAULT 12.5,
      max_weekly_hours NUMERIC(5,2)  DEFAULT 48,
      source           VARCHAR(255),
      approved_by      VARCHAR(255),
      created_at       TIMESTAMPTZ   DEFAULT NOW()
    )
  `);

  // Pseudonymiseret medarbejderregister. Ingen CPR-numre og aldrig hele
  // kontonummeret — kun de sidste fire cifre og et hash til at opdage,
  // at flere ansatte får løn på samme konto.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payroll_employees (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
      supplier_id   INTEGER REFERENCES suppliers(id) ON DELETE CASCADE,
      pseudonym     VARCHAR(20)  NOT NULL,
      employee_ref  VARCHAR(50),
      job_group     VARCHAR(100),
      employed_from DATE,
      employed_to   DATE,
      bank_last4    VARCHAR(4),
      bank_hash     VARCHAR(64),
      created_at    TIMESTAMPTZ  DEFAULT NOW(),
      updated_at    TIMESTAMPTZ  DEFAULT NOW(),
      UNIQUE (supplier_id, employee_ref)
    )
  `);

  // Lønperiode pr. leverandør — og pr. projekt, hvis den er knyttet til en sag.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payroll_periods (
      id              SERIAL PRIMARY KEY,
      user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
      supplier_id     INTEGER REFERENCES suppliers(id) ON DELETE CASCADE,
      case_id         INTEGER REFERENCES cases(id) ON DELETE SET NULL,
      period_start    DATE NOT NULL,
      period_end      DATE NOT NULL,
      payout_date     DATE,
      source          VARCHAR(50)  DEFAULT 'csv',
      ruleset_id      INTEGER REFERENCES payroll_rulesets(id) ON DELETE SET NULL,
      ruleset_version VARCHAR(20),
      status          VARCHAR(20)  DEFAULT 'grey',
      status_class    VARCHAR(20)  DEFAULT 's-gray',
      checked_at      TIMESTAMPTZ,
      imported_at     TIMESTAMPTZ  DEFAULT NOW()
    )
  `);

  // Én linje pr. medarbejder pr. lønperiode. Kolonnerne holder de fire kilder
  // adskilt: timer (tidsregistrering), løn (lønsystem), reported (indberetning)
  // og bank_paid (bankudbetaling).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payroll_lines (
      id              SERIAL PRIMARY KEY,
      user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
      period_id       INTEGER REFERENCES payroll_periods(id) ON DELETE CASCADE,
      employee_id     INTEGER REFERENCES payroll_employees(id) ON DELETE CASCADE,
      hours_normal    NUMERIC(8,2)  DEFAULT 0,
      hours_overtime  NUMERIC(8,2)  DEFAULT 0,
      hourly_rate     NUMERIC(10,2),
      gross           NUMERIC(12,2),
      net             NUMERIC(12,2),
      supplement      NUMERIC(12,2) DEFAULT 0,
      pension         NUMERIC(12,2) DEFAULT 0,
      holiday_pay     NUMERIC(12,2) DEFAULT 0,
      in_payroll      BOOLEAN       DEFAULT TRUE,
      reported        BOOLEAN       DEFAULT FALSE,
      reported_amount NUMERIC(12,2),
      bank_paid       NUMERIC(12,2),
      bank_paid_at    DATE,
      on_project      BOOLEAN       DEFAULT TRUE,
      status          VARCHAR(20)   DEFAULT 'grey',
      status_class    VARCHAR(20)   DEFAULT 's-gray',
      UNIQUE (period_id, employee_id)
    )
  `);

  // Afvigelser fra lønkontrollen. Resultater rettes aldrig: en ny kontrol
  // markerer de gamle som superseded og indsætter et nyt sæt.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payroll_deviations (
      id              SERIAL PRIMARY KEY,
      user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
      period_id       INTEGER REFERENCES payroll_periods(id) ON DELETE CASCADE,
      line_id         INTEGER REFERENCES payroll_lines(id) ON DELETE CASCADE,
      employee_id     INTEGER REFERENCES payroll_employees(id) ON DELETE SET NULL,
      code            VARCHAR(40)  NOT NULL,
      label           VARCHAR(255) NOT NULL,
      detail          TEXT,
      severity        VARCHAR(20)  DEFAULT 'warning',
      ruleset_version VARCHAR(20),
      superseded      BOOLEAN      DEFAULT FALSE,
      resolved_at     TIMESTAMPTZ,
      resolved_by     VARCHAR(255),
      resolution      TEXT,
      checked_at      TIMESTAMPTZ  DEFAULT NOW()
    )
  `);

  // Virksomhedens udbetalingskonto (NemKonto) med historik, så en ændring
  // midt i et projekt kan opdages. Kontonummeret gemmes aldrig — kun
  // registreringsnummer, sidste fire cifre og et hash til sammenligning.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS supplier_accounts (
      id              SERIAL PRIMARY KEY,
      user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
      supplier_id     INTEGER REFERENCES suppliers(id) ON DELETE CASCADE,
      kind            VARCHAR(20)  DEFAULT 'nemkonto',
      reg_no          VARCHAR(4),
      account_last4   VARCHAR(4),
      account_hash    VARCHAR(64),
      holder_name     VARCHAR(255),
      verified        BOOLEAN      DEFAULT FALSE,
      verified_source VARCHAR(50),
      verified_at     TIMESTAMPTZ,
      valid_from      DATE         DEFAULT CURRENT_DATE,
      valid_to        DATE,
      active          BOOLEAN      DEFAULT TRUE,
      note            TEXT,
      created_at      TIMESTAMPTZ  DEFAULT NOW()
    )
  `);

  // Opgrader eksisterende tabeller med nye kolonner (fejler stille hvis kolonnen allerede findes)
  const alters = [
    // users
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS archive_email           VARCHAR(255)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id      VARCHAR(255)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id  VARCHAR(255)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_plan       VARCHAR(20) DEFAULT 'none'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status     VARCHAR(20) DEFAULT 'none'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at           TIMESTAMPTZ`,
    // suppliers
    `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS type         VARCHAR(255)`,
    `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS country      VARCHAR(100) DEFAULT 'Danmark'`,
    `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS risk         VARCHAR(10)  DEFAULT 'low'`,
    `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS score        INTEGER      DEFAULT 50`,
    `ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS status_class VARCHAR(20)  DEFAULT 's-amber'`,
    `ALTER TABLE suppliers ALTER COLUMN status TYPE VARCHAR(50)`,
    `ALTER TABLE suppliers ALTER COLUMN cvr DROP NOT NULL`,
    // documents — tilføj user_id og nye kolonner til eksisterende tabel
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS user_id    INTEGER`,
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_size  VARCHAR(20)`,
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_ref   VARCHAR(500)`,
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS status     VARCHAR(20) DEFAULT 'gyldig'`,
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS expiry     DATE`,
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS supplier_name VARCHAR(255)`,
    // apprentices — tabellen kan være oprettet i tidligere version uden sync-kolonner
    `ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS paid_from_hash  VARCHAR(64)`,
    `ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS paid_from_last4 VARCHAR(4)`,
    `ALTER TABLE apprentices ADD COLUMN IF NOT EXISTS client_id VARCHAR(50)`,
    `ALTER TABLE apprentices ADD COLUMN IF NOT EXISTS data      JSONB`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_apprentices_client ON apprentices(user_id, client_id)`,
  ];

  for (const sql of alters) {
    await runSQL(sql.slice(0, 60), sql);
  }

  // Indeks (kør separat så én fejl ikke stopper resten)
  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_suppliers_user   ON suppliers(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_documents_sup    ON documents(supplier_id)`,
    `CREATE INDEX IF NOT EXISTS idx_deviations_user  ON deviations(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_comp_results_sup ON compliance_results(supplier_id, user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_user       ON audit_log(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_cases_user        ON cases(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_case_subs_case    ON case_subcontractors(case_id)`,
    `CREATE INDEX IF NOT EXISTS idx_case_subs_parent  ON case_subcontractors(parent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_case_subs_sup     ON case_subcontractors(supplier_id)`,
    `CREATE INDEX IF NOT EXISTS idx_apprentices_user   ON apprentices(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pay_emp_sup      ON payroll_employees(supplier_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pay_emp_hash     ON payroll_employees(bank_hash)`,
    `CREATE INDEX IF NOT EXISTS idx_pay_periods_sup  ON payroll_periods(supplier_id, user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pay_lines_period ON payroll_lines(period_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pay_devs_period  ON payroll_deviations(period_id, superseded)`,
    `CREATE INDEX IF NOT EXISTS idx_pay_rules_user   ON payroll_rulesets(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sup_accounts     ON supplier_accounts(supplier_id, active)`,
  ];

  // user_id-indeks på documents kun hvis kolonnen nu eksisterer
  try {
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id)`);
  } catch (_) {}

  for (const sql of indexes) {
    await runSQL('INDEX: ' + sql.slice(30, 70), sql);
  }

  console.log('✅  Database tabeller og indeks klar');
}

// Hjælpefunktion: beregn risikoscore fra leverandørdata
function calcRisk(supplier) {
  const s = supplier.score || 50;
  if (s < 45) return 'high';
  if (s < 70) return 'medium';
  return 'low';
}

// Formater leverandør til frontend-format
function formatSupplier(row) {
  const risk = row.risk || calcRisk(row);
  const scoreNum = row.score || 50;
  return {
    id:          row.id,
    name:        row.name,
    type:        row.type || row.industry || '—',
    country:     row.country || 'Danmark',
    risk,
    score:       scoreNum,
    status:      row.status || 'Afventer',
    statusClass: row.status_class || (row.status === 'Godkendt' ? 's-green' : row.status === 'Blokeret' ? 's-red' : 's-amber'),
    cvr:         row.cvr || '—',
    notes:       row.notes || '',
    addedAt:     row.added_at,
    updatedAt:   row.updated_at,
  };
}

module.exports = { pool, init, calcRisk, formatSupplier };
