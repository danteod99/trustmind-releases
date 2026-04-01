const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

let db = null;

function getDbPath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'trustmind.db');
}

function initDatabase() {
  db = new Database(getDbPath());
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      ig_user TEXT DEFAULT '',
      ig_pass TEXT DEFAULT '',
      ig_logged_in INTEGER DEFAULT 0,
      proxy_type TEXT DEFAULT 'http',
      proxy_host TEXT DEFAULT '',
      proxy_port TEXT DEFAULT '',
      proxy_user TEXT DEFAULT '',
      proxy_pass TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      timezone TEXT DEFAULT 'America/Lima',
      notes TEXT DEFAULT '',
      status TEXT DEFAULT 'stopped',
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now'))
    );
  `);

  // Migrate: add columns if they don't exist
  const columns = db.prepare("PRAGMA table_info(profiles)").all().map(c => c.name);
  if (!columns.includes('ig_user')) {
    db.exec("ALTER TABLE profiles ADD COLUMN ig_user TEXT DEFAULT ''");
    db.exec("ALTER TABLE profiles ADD COLUMN ig_pass TEXT DEFAULT ''");
    db.exec("ALTER TABLE profiles ADD COLUMN ig_logged_in INTEGER DEFAULT 0");
  }
  if (!columns.includes('ig_2fa_secret')) {
    db.exec("ALTER TABLE profiles ADD COLUMN ig_2fa_secret TEXT DEFAULT ''");
  }
  if (!columns.includes('ig_email')) {
    db.exec("ALTER TABLE profiles ADD COLUMN ig_email TEXT DEFAULT ''");
  }
  if (!columns.includes('ig_email_pass')) {
    db.exec("ALTER TABLE profiles ADD COLUMN ig_email_pass TEXT DEFAULT ''");
  }
  if (!columns.includes('account_status')) {
    db.exec("ALTER TABLE profiles ADD COLUMN account_status TEXT DEFAULT 'unknown'");
    db.exec("ALTER TABLE profiles ADD COLUMN account_status_msg TEXT DEFAULT ''");
  }

  // Table for extracted followers
  db.exec(`
    CREATE TABLE IF NOT EXISTS extracted_followers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_user TEXT NOT NULL,
      username TEXT NOT NULL,
      full_name TEXT DEFAULT '',
      extracted_by TEXT DEFAULT '',
      extracted_at DATETIME DEFAULT (datetime('now')),
      UNIQUE(target_user, username)
    );
  `);

  // Table for extraction history
  db.exec(`
    CREATE TABLE IF NOT EXISTS extraction_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_user TEXT NOT NULL,
      count INTEGER DEFAULT 0,
      extracted_by TEXT DEFAULT '',
      extracted_at DATETIME DEFAULT (datetime('now'))
    );
  `);

  // Settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT ''
    );
  `);

  // Action log (for dashboard stats)
  db.exec(`
    CREATE TABLE IF NOT EXISTS action_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      target TEXT DEFAULT '',
      count INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT (datetime('now'))
    );
  `);

  // Scheduled tasks
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      action TEXT NOT NULL,
      config TEXT DEFAULT '{}',
      schedule_time TEXT DEFAULT '08:00',
      schedule_days TEXT DEFAULT '[1,2,3,4,5]',
      profile_ids TEXT DEFAULT '[]',
      enabled INTEGER DEFAULT 1,
      last_run DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT (datetime('now'))
    );
  `);

  // Account health checks
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_health (
      profile_id TEXT PRIMARY KEY,
      status TEXT DEFAULT 'unchecked',
      message TEXT DEFAULT '',
      shadowban INTEGER DEFAULT 0,
      shadowban_checks TEXT DEFAULT '{}',
      last_checked DATETIME DEFAULT NULL
    );
  `);

  // Warm-up tracking
  db.exec(`
    CREATE TABLE IF NOT EXISTS warmup_status (
      profile_id TEXT PRIMARY KEY,
      active INTEGER DEFAULT 0,
      day INTEGER DEFAULT 0,
      started_at DATETIME DEFAULT NULL,
      today_likes INTEGER DEFAULT 0,
      today_follows INTEGER DEFAULT 0,
      today_stories INTEGER DEFAULT 0,
      today_comments INTEGER DEFAULT 0,
      last_action DATETIME DEFAULT NULL
    );
  `);

  // Scraped data (emails, phones, bios)
  db.exec(`
    CREATE TABLE IF NOT EXISTS scraped_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_user TEXT NOT NULL,
      data_type TEXT NOT NULL,
      value TEXT NOT NULL,
      scraped_by TEXT DEFAULT '',
      scraped_at DATETIME DEFAULT (datetime('now')),
      UNIQUE(target_user, data_type, value)
    );
  `);

  // License cache for offline tier validation
  db.exec(`
    CREATE TABLE IF NOT EXISTS license_cache (
      user_id TEXT PRIMARY KEY,
      tier TEXT NOT NULL,
      expires_at TEXT,
      offline_valid_until TEXT,
      updated_at TEXT
    );
  `);

  return db;
}

function getDb() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

module.exports = { initDatabase, getDb };
