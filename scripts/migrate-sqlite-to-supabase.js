import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import pg from 'pg';

const { Pool } = pg;
const sourcePath = path.resolve('data', 'store.db');
const dryRun = process.argv.includes('--dry-run');
const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!dryRun && !connectionString) throw new Error('Définissez SUPABASE_DB_URL dans votre environnement avant la migration.');
if (!fs.existsSync(sourcePath)) throw new Error(`Base SQLite introuvable : ${sourcePath}`);
let databaseUrl;
if (connectionString) {
  databaseUrl = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    throw new Error('SUPABASE_DB_URL doit être une chaîne de connexion PostgreSQL.');
  }
}

const tables = [
  { name: 'users', columns: ['id', 'name', 'username', 'email', 'password', 'first_name', 'last_name', 'phone', 'shop_name', 'logo', 'google_id', 'created_at'], identity: true },
  { name: 'app_settings', columns: ['key', 'value'], identity: false },
  { name: 'categories', columns: ['id', 'name', 'family'], identity: true },
  { name: 'products', columns: ['id', 'name', 'category', 'brand', 'model', 'reference', 'quantity', 'price_buy', 'price_sale', 'threshold', 'location', 'description', 'compatible_models', 'date_created'], identity: true },
  { name: 'sales', columns: ['id', 'sale_date', 'total_amount', 'total_profit', 'items_count'], identity: true },
  { name: 'sale_items', columns: ['id', 'sale_id', 'product_id', 'quantity', 'unit_price', 'subtotal', 'profit'], identity: true },
  { name: 'stock_movements', columns: ['id', 'product_id', 'type', 'quantity', 'note', 'created_at'], identity: true },
];

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$v=1$N=32768$r=8$p=1$${salt}$${key.toString('hex')}`;
};

const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
const pool = databaseUrl ? new Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 10000,
}) : null;

const migrate = async () => {
  const integrity = source.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') throw new Error(`La vérification SQLite a échoué : ${integrity}`);
  const foreignKeyErrors = source.pragma('foreign_key_check');
  if (foreignKeyErrors.length) throw new Error(`La base SQLite contient ${foreignKeyErrors.length} relation(s) incohérente(s); aucune donnée n'a été migrée.`);

  const records = new Map();
  for (const table of tables) {
    const columns = source.prepare(`PRAGMA table_info(${table.name})`).all().map((column) => column.name);
    const missing = table.columns.filter((column) => !columns.includes(column));
    if (missing.length) throw new Error(`La table SQLite ${table.name} ne contient pas les colonnes requises : ${missing.join(', ')}.`);
    records.set(table.name, source.prepare(`SELECT ${table.columns.join(', ')} FROM ${table.name} ORDER BY ${table.identity ? 'id' : 'key'}`).all());
  }
  if (dryRun) {
    for (const table of tables) console.log(`Vérifié : ${table.name} (${records.get(table.name).length} lignes).`);
    console.log('Vérification terminée sans connexion à Supabase et sans modification des données.');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = 120000');
    for (const table of tables) {
      const result = await client.query(`SELECT COUNT(*)::integer AS count FROM public.${table.name}`);
      if (result.rows[0].count !== 0) {
        throw new Error(`La table Supabase ${table.name} contient déjà des données. Migration arrêtée sans modification pour éviter tout écrasement.`);
      }
    }

    const userRows = records.get('users');
    for (const user of userRows) {
      if (user.username === 'admin' && user.password === 'admin123') {
        user.password = hashPassword(crypto.randomBytes(48).toString('hex'));
      } else if (!user.password.startsWith('scrypt:') && !user.password.startsWith('scrypt$v=1$')) {
        user.password = hashPassword(user.password);
      }
    }

    for (const table of tables) {
      const rows = records.get(table.name);
      for (let offset = 0; offset < rows.length; offset += 200) {
        const batch = rows.slice(offset, offset + 200);
        for (const row of batch) {
          const placeholders = table.columns.map((_, i) => `$${i + 1}`).join(', ');
          const values = table.columns.map((column) => row[column]);
          await client.query(
            `INSERT INTO public.${table.name} (${table.columns.join(', ')}) VALUES (${placeholders})`,
            values,
          );
        }
      }
      console.log(`Migré : ${table.name} (${rows.length} lignes).`);
    }

    for (const table of tables.filter((item) => item.identity)) {
      await client.query(`
        SELECT setval(
          pg_get_serial_sequence('public.${table.name}', 'id'),
          COALESCE((SELECT MAX(id) FROM public.${table.name}), 1),
          EXISTS (SELECT 1 FROM public.${table.name})
        )
      `);
    }
    await client.query('COMMIT');
    console.log('Migration terminée. La base SQLite d’origine est restée intacte.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

migrate()
  .catch((error) => {
    console.error(`Migration annulée : ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    source.close();
    if (pool) await pool.end();
  });
