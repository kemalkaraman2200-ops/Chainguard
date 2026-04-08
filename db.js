const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
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
  `);
  console.log('Database tabeller klar');
}

module.exports = { pool, init };
