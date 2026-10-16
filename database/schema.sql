CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'seller' CHECK (role IN ('admin', 'seller')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  shop_name TEXT DEFAULT 'AfriStock',
  logo TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  google_id TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS user_sessions (
  session_id TEXT PRIMARY KEY,
  expires INTEGER NOT NULL,
  data TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
  "key" TEXT PRIMARY KEY,
  "value" TEXT,
  updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  family TEXT NOT NULL DEFAULT 'autres',
  user_id INTEGER,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  UNIQUE (user_id, name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  reference TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  price_buy INTEGER NOT NULL DEFAULT 0,
  price_sale INTEGER NOT NULL DEFAULT 0,
  threshold INTEGER NOT NULL DEFAULT 3,
  location TEXT,
  description TEXT,
  compatible_models TEXT,
  date_created TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  sale_date TEXT DEFAULT (datetime('now', 'localtime')),
  total_amount INTEGER NOT NULL DEFAULT 0,
  total_profit INTEGER NOT NULL DEFAULT 0,
  items_count INTEGER NOT NULL DEFAULT 0,
  customer_name TEXT,
  payment_method TEXT DEFAULT 'cash',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  subtotal INTEGER NOT NULL,
  profit INTEGER NOT NULL,
  FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT NOT NULL,
  temp_password TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  user_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  description TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS users_role_idx ON users(role);
CREATE INDEX IF NOT EXISTS users_status_idx ON users(status);
CREATE INDEX IF NOT EXISTS categories_family_idx ON categories(family);
CREATE INDEX IF NOT EXISTS products_user_idx ON products(user_id);
CREATE INDEX IF NOT EXISTS products_category_idx ON products(category);
CREATE INDEX IF NOT EXISTS sales_user_idx ON sales(user_id);
CREATE INDEX IF NOT EXISTS sales_date_idx ON sales(sale_date);
CREATE INDEX IF NOT EXISTS stock_movements_user_idx ON stock_movements(user_id);
CREATE INDEX IF NOT EXISTS activity_logs_created_idx ON activity_logs(created_at);
