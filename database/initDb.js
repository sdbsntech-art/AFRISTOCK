import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { DEFAULT_CATEGORIES, DEFAULT_PRODUCTS } from './catalog.js';

const dbDir = path.resolve('data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const ensureColumn = (db, table, column, definition) => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
};

export const createDatabase = () => {
  const db = new Database(path.join(dbDir, 'store.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      phone TEXT,
      shop_name TEXT,
      logo TEXT,
      google_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      family TEXT NOT NULL DEFAULT 'autres'
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      brand TEXT NOT NULL,
      model TEXT NOT NULL,
      reference TEXT,
      quantity INTEGER NOT NULL DEFAULT 0,
      price_buy INTEGER NOT NULL DEFAULT 0,
      price_sale INTEGER NOT NULL DEFAULT 0,
      threshold INTEGER NOT NULL DEFAULT 0,
      location TEXT,
      description TEXT,
      compatible_models TEXT,
      date_created TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_date TEXT DEFAULT CURRENT_TIMESTAMP,
      total_amount INTEGER DEFAULT 0,
      total_profit INTEGER DEFAULT 0,
      items_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price INTEGER NOT NULL,
      subtotal INTEGER NOT NULL,
      profit INTEGER NOT NULL,
      FOREIGN KEY (sale_id) REFERENCES sales(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
  `);

  ensureColumn(db, 'categories', 'family', "TEXT NOT NULL DEFAULT 'autres'");
  ensureColumn(db, 'products', 'compatible_models', 'TEXT');
  ensureColumn(db, 'users', 'first_name', 'TEXT');
  ensureColumn(db, 'users', 'last_name', 'TEXT');
  ensureColumn(db, 'users', 'phone', 'TEXT');
  ensureColumn(db, 'users', 'shop_name', 'TEXT');
  ensureColumn(db, 'users', 'logo', 'TEXT');
  ensureColumn(db, 'users', 'google_id', 'TEXT');
  ensureColumn(db, 'users', 'created_at', 'TEXT');
  db.prepare(`UPDATE users SET created_at = datetime('now') WHERE created_at IS NULL OR trim(created_at) = ''`).run();

  return db;
};

export const seedDatabase = (db) => {
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (userCount > 0) {
    db.prepare(`
      UPDATE users
      SET shop_name = CASE WHEN shop_name IS NULL OR trim(shop_name) = '' THEN 'AfriStock' ELSE shop_name END,
          first_name = CASE WHEN first_name IS NULL OR trim(first_name) = '' THEN name ELSE first_name END
      WHERE shop_name IS NULL OR trim(shop_name) = '' OR first_name IS NULL OR trim(first_name) = ''
    `).run();
  }

  const insertCategory = db.prepare('INSERT OR IGNORE INTO categories (name, family) VALUES (?, ?)');
  const updateFamily = db.prepare('UPDATE categories SET family = ? WHERE name = ? AND (family IS NULL OR family = \'\' OR family = \'autres\')');

  const seedMeta = db.transaction(() => {
    for (const category of DEFAULT_CATEGORIES) {
      insertCategory.run(category.name, category.family);
      updateFamily.run(category.family, category.name);
    }
  });
  seedMeta();

  const insertProduct = db.prepare(`
    INSERT INTO products (
      name, category, brand, model, reference, quantity, price_buy, price_sale,
      threshold, location, description, compatible_models, date_created
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  const insertMovement = db.prepare(`
    INSERT INTO stock_movements (product_id, type, quantity, note, created_at)
    VALUES (?, 'entry', ?, 'Catalogue initial', datetime('now'))
  `);
  const findByRef = db.prepare('SELECT id FROM products WHERE reference = ?');

  const seedProducts = db.transaction(() => {
    for (const product of DEFAULT_PRODUCTS) {
      if (findByRef.get(product.reference)) continue;
      const result = insertProduct.run(
        product.name,
        product.category,
        product.brand,
        product.model,
        product.reference,
        product.quantity,
        product.price_buy,
        product.price_sale,
        product.threshold,
        product.location,
        product.description,
        product.compatible,
      );
      insertMovement.run(result.lastInsertRowid, product.quantity);
    }
  });
  seedProducts();
};
