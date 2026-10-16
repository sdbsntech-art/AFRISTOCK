import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { DEFAULT_CATEGORIES } from './catalog.js';
import { hashPassword } from '../server/security.js';

const connectionConfig = {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  multipleStatements: true,
};

export const initializeDatabase = async () => {
  console.log('[MySQL Init] Connexion au serveur MySQL de Laragon...');
  const rootConn = await mysql.createConnection(connectionConfig);

  const dbName = process.env.MYSQL_DATABASE || 'afristock';
  console.log(`[MySQL Init] Création / vérification de la base de données : \`${dbName}\`...`);
  await rootConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await rootConn.end();

  // Connect to the specific database
  const db = await mysql.createConnection({
    ...connectionConfig,
    database: dbName,
  });

  console.log('[MySQL Init] Application du schéma des tables...');
  const schemaPath = path.resolve('mysql/schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  // Split and execute statements
  const statements = schemaSql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.toLowerCase().startsWith('create database') && !s.toLowerCase().startsWith('use '));

  for (const statement of statements) {
    try {
      await db.query(statement);
    } catch (err) {
      console.warn(`[MySQL Init] Note sur statement : ${err.message}`);
    }
  }

  console.log('[MySQL Init] Vérification et initialisation des comptes administrateur et vendeur...');

  // 1. Initialiser le compte administrateur principal
  const [adminRows] = await db.query('SELECT id FROM users WHERE username = ? OR email = ?', ['admin', 'admin@afristock.com']);
  let adminId;
  if (adminRows.length === 0) {
    const adminPasswordHash = hashPassword('Admin@AfriStock2026!');
    const [result] = await db.query(`
      INSERT INTO users (name, username, email, password, role, status, first_name, last_name, phone, shop_name, must_change_password)
      VALUES (?, ?, ?, ?, 'admin', 'active', ?, ?, ?, ?, 0)
    `, [
      'Administrateur AfriStock',
      'admin',
      'admin@afristock.com',
      adminPasswordHash,
      'Admin',
      'AfriStock',
      '+225 07 00 00 01',
      'Direction AfriStock',
    ]);
    adminId = result.insertId;
    console.log('✅ Compte Administrateur créé : identifiant = admin | mot de passe = Admin@AfriStock2026!');
  } else {
    adminId = adminRows[0].id;
    // S'assurer que le rôle est admin
    await db.query("UPDATE users SET role = 'admin' WHERE id = ?", [adminId]);
    console.log('ℹ️ Compte Administrateur existant (id=' + adminId + ')');
  }

  // 3. Initialiser les catégories standards du métier (si absentes)
  console.log('[MySQL Init] Peuplement des catégories standards...');
  for (const cat of DEFAULT_CATEGORIES) {
    const [existing] = await db.query('SELECT id FROM categories WHERE name = ?', [cat.name]);
    if (existing.length === 0) {
      await db.query('INSERT INTO categories (name, family, user_id) VALUES (?, ?, NULL)', [cat.name, cat.family]);
    }
  }

  console.log('✅ Système de production initialisé sans données factices ni simulation.');
  await db.end();
  console.log('🎉 Base de données MySQL `afristock` prête pour la production !');
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

