import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'data', 'store.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent TEXT NOT NULL,
      action TEXT NOT NULL,
      reasoning TEXT,
      input_data TEXT,
      output_data TEXT,
      status TEXT DEFAULT 'pending',
      requires_approval INTEGER DEFAULT 0,
      approved_at TEXT,
      approved_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      executed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shopify_id TEXT UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      cost_price REAL,
      vendor TEXT,
      category TEXT,
      tags TEXT,
      target_audience TEXT,
      source TEXT,
      source_product_id TEXT,
      status TEXT DEFAULT 'active',
      is_soft_deleted INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pricing_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      shopify_id TEXT NOT NULL,
      old_price REAL NOT NULL,
      new_price REAL NOT NULL,
      reasoning TEXT,
      competitor_prices TEXT,
      sales_velocity REAL,
      ai_decision_id INTEGER REFERENCES ai_decisions(id),
      changed_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shopify_order_id TEXT UNIQUE NOT NULL,
      shopify_order_number TEXT,
      customer_email TEXT,
      total_price REAL,
      fulfillment_status TEXT DEFAULT 'pending',
      fulfillment_provider TEXT,
      provider_order_id TEXT,
      tracking_number TEXT,
      tracking_url TEXT,
      refund_status TEXT,
      refund_reason TEXT,
      ai_refund_decision TEXT,
      raw_data TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS marketing_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER REFERENCES products(id),
      shopify_id TEXT,
      platform TEXT NOT NULL,
      campaign_type TEXT NOT NULL,
      headline TEXT,
      body TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      clicks INTEGER DEFAULT 0,
      conversions INTEGER DEFAULT 0,
      revenue REAL DEFAULT 0,
      posted_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS product_performance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      shopify_id TEXT NOT NULL,
      date TEXT NOT NULL,
      units_sold INTEGER DEFAULT 0,
      revenue REAL DEFAULT 0,
      views INTEGER DEFAULT 0,
      add_to_carts INTEGER DEFAULT 0,
      recorded_at TEXT DEFAULT (datetime('now')),
      UNIQUE(shopify_id, date)
    );

    CREATE INDEX IF NOT EXISTS idx_ai_decisions_agent ON ai_decisions(agent);
    CREATE INDEX IF NOT EXISTS idx_ai_decisions_status ON ai_decisions(status);
    CREATE INDEX IF NOT EXISTS idx_products_shopify_id ON products(shopify_id);
    CREATE INDEX IF NOT EXISTS idx_orders_shopify_id ON orders(shopify_order_id);
    CREATE INDEX IF NOT EXISTS idx_pricing_history_product ON pricing_history(shopify_id);
  `);
}

export function closeDb(): void {
  if (db) {
    db.close();
  }
}
