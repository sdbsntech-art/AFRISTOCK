import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { getMySqlAdminConfig, getMySqlConfig } from '../server/databaseConfig.js';
import { loadLocalEnv, saveLocalEnvValues } from '../server/loadEnv.js';

loadLocalEnv();

export const initializeDatabase = async () => {
  const appUserConfig = getMySqlConfig();
  const adminConfig = getMySqlAdminConfig();
  const connectionConfig = { host: adminConfig.host, port: adminConfig.port, user: adminConfig.user, password: adminConfig.password };
  const dbName = appUserConfig.database;
  if (!/^[a-zA-Z0-9_]{1,64}$/.test(dbName)) {
    throw new Error('MYSQL_DATABASE doit contenir uniquement des lettres, chiffres et caractères _ (1 à 64 caractères).');
  }
  if (!/^[a-zA-Z0-9_]{1,32}$/.test(appUserConfig.user)) {
    throw new Error('MYSQL_USER doit contenir uniquement des lettres, chiffres et caractères _ (1 à 32 caractères).');
  }

  const appPassword = process.env.MYSQL_PASSWORD || crypto.randomBytes(32).toString('hex');
  if (!/^[a-f0-9]{64}$/i.test(appPassword)) {
    throw new Error('MYSQL_PASSWORD doit être une clé hexadécimale de 64 caractères générée par AfriStock.');
  }
  const sessionSecret = process.env.SESSION_SECRET && Buffer.byteLength(process.env.SESSION_SECRET) >= 32
    ? process.env.SESSION_SECRET
    : crypto.randomBytes(48).toString('hex');
  saveLocalEnvValues({
    MYSQL_USER: appUserConfig.user,
    MYSQL_PASSWORD: appPassword,
    SESSION_SECRET: sessionSecret,
  });
  process.env.MYSQL_PASSWORD = appPassword;
  process.env.SESSION_SECRET = sessionSecret;

  let rootConn;
  let db;
  try {
    console.log('[MySQL Init] Connexion au serveur MySQL local...');
    rootConn = await mysql.createConnection(connectionConfig);
    console.log(`[MySQL Init] Création / vérification de la base : \`${dbName}\`...`);
    await rootConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    const accountHost = appUserConfig.host === 'localhost' ? 'localhost' : appUserConfig.host === '::1' ? '::1' : '127.0.0.1';
    const account = `'${appUserConfig.user}'@'${accountHost}'`;
    await rootConn.query(`CREATE USER IF NOT EXISTS ${account} IDENTIFIED BY '${appPassword}'`);
    await rootConn.query(`ALTER USER ${account} IDENTIFIED BY '${appPassword}'`);
    await rootConn.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${dbName}\`.* TO ${account}`);
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

    await db.end();
    db = null;

    db = await mysql.createConnection({
      ...appUserConfig,
      password: appPassword,
    });
    await db.query('SELECT 1');
    console.log('✅ Base locale prête. Le compte applicatif dédié est créé avec des droits limités ; aucune donnée métier n’a été préremplie.');
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
