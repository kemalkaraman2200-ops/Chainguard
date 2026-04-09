const { Pool } = require('pg');

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    }
  : {
      host: process.env.PGHOST,
      port: parseInt(process.env.PGPORT || '5432'),
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      ssl: false
    };

const pool = new Pool({
  ...poolConfig,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id        SERIAL PRIMARY KEY,
      email     VARCHAR(255) UNIQUE NOT NULL,
      password  VARCHAR(255) NOT NULL,
      name      VARCHAR(255),
      role      VARCHAR(50) DEFAULT 'user',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
      cvr         VARCHAR(8) NOT NULL,
      name        VARCHAR(255),
      address     VARCHAR(500),
      industry    VARCHAR(255),
      employees   INTEGER,
      phone       VARCHAR(50),
      status      VARCHAR(20) DEFAULT 'pending',
      notes       TEXT,
      added_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER REFERENCES users(id),
      supplier_id INTEGER REFERENCES suppliers(id) ON DELETE CASCADE,
      action      VARCHAR(100),
      details     TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS compliance_archive (
      id               SERIAL PRIMARY KEY,
      user_id          INTEGER REFERENCES users(id),
      sent_at          TIMESTAMPTZ DEFAULT NOW(),
      sent_to          VARCHAR(255),
      filename         VARCHAR(255),
      pdf_data         BYTEA,
      suppliers_count  INTEGER DEFAULT 0,
      audit_entries    INTEGER DEFAULT 0,
      trigger_type     VARCHAR(20) DEFAULT 'manual',
      status           VARCHAR(20) DEFAULT 'sent',
      error_msg        TEXT
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS archive_email VARCHAR(255);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_plan VARCHAR(20) DEFAULT 'none';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(20) DEFAULT 'none';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;
  `);
  console.log('Database tabeller klar');
}

module.exports = { pool, init };
