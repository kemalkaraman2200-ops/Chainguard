const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
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
    // documents — tilføj user_id og nye kolonner til eksisterende tabel
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS user_id    INTEGER`,
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_size  VARCHAR(20)`,
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_ref   VARCHAR(500)`,
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS status     VARCHAR(20) DEFAULT 'gyldig'`,
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS expiry     DATE`,
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS supplier_name VARCHAR(255)`,
    // apprentices — tabellen kan være oprettet i tidligere version uden sync-kolonner
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
