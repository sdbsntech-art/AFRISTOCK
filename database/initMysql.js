import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

const connectionConfig = {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
};

export const initializeDatabase = async () => {
  const dbName = process.env.MYSQL_DATABASE || 'afristock';
  if (!/^[a-zA-Z0-9_]{1,64}$/.test(dbName)) {
    throw new Error('MYSQL_DATABASE doit contenir uniquement des lettres, chiffres et caractères _ (1 à 64 caractères).');
  }

  let rootConn;
  let db;
  try {
    console.log('[MySQL Init] Connexion au serveur MySQL local...');
    rootConn = await mysql.createConnection(connectionConfig);
    console.log(`[MySQL Init] Création / vérification de la base : \`${dbName}\`...`);
    await rootConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await rootConn.end();
    rootConn = null;

    db = await mysql.createConnection({ ...connectionConfig, database: dbName });

    console.log('[MySQL Init] Application du schéma des tables...');
    const schemaPath = path.resolve('mysql/schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8').replace(/^\s*--.*$/gm, '');
    const statements = schemaSql
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement && !/^(CREATE\s+DATABASE|USE\s+)/i.test(statement));

    for (const statement of statements) {
      await db.query(statement);
    }

    const [categoryIndex] = await db.query("SHOW INDEX FROM categories WHERE Key_name = 'categories_user_name_unique'");
    if (categoryIndex.length === 0) {
      const [duplicates] = await db.query(`
        SELECT user_id FROM categories
        WHERE user_id IS NOT NULL
        GROUP BY user_id, name
        HAVING COUNT(*) > 1
        LIMIT 1
      `);
      if (duplicates.length > 0) {
        throw new Error('Des catégories identiques existent dans une boutique. Corrigez-les avant d’ajouter la contrainte de sécurité.');
      }
      await db.query('ALTER TABLE categories ADD UNIQUE KEY categories_user_name_unique (user_id, name)');
    }

    console.log('✅ Base MySQL prête, sans comptes, catégories ni produits préremplis.');
  } finally {
    if (rootConn) await rootConn.end();
    if (db) await db.end();
  }
};

// If run directly from terminal
if (process.argv[1] && process.argv[1].includes('initMysql')) {
  initializeDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[MySQL Init] Erreur fatale :', err);
      process.exit(1);
    });
}
