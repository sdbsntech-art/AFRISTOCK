import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { DEFAULT_CATEGORIES, DEFAULT_PRODUCTS } from './catalog.js';
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

  // 2. Initialiser un compte vendeur de démonstration (Mamadou Diallo)
  const [sellerRows] = await db.query('SELECT id FROM users WHERE username = ? OR email = ?', ['diallo', 'diallo@afristock.com']);
  let sellerId;
  if (sellerRows.length === 0) {
    const sellerPasswordHash = hashPassword('Diallo@AfriStock2026!');
    const [result] = await db.query(`
      INSERT INTO users (name, username, email, password, role, status, first_name, last_name, phone, shop_name, must_change_password)
      VALUES (?, ?, ?, ?, 'seller', 'active', ?, ?, ?, ?, 0)
    `, [
      'Mamadou Diallo',
      'diallo',
      'diallo@afristock.com',
      sellerPasswordHash,
      'Mamadou',
      'Diallo',
      '+225 05 44 22 11',
      'Diallo Tech & Pièces',
    ]);
    sellerId = result.insertId;
    console.log('✅ Compte Vendeur créé : identifiant = diallo | mot de passe = Diallo@AfriStock2026!');
  } else {
    sellerId = sellerRows[0].id;
    console.log('ℹ️ Compte Vendeur existant (id=' + sellerId + ')');
  }

  // 3. Initialiser les catégories par défaut
  console.log('[MySQL Init] Peuplement des catégories...');
  for (const cat of DEFAULT_CATEGORIES) {
    const [existing] = await db.query('SELECT id FROM categories WHERE name = ?', [cat.name]);
    if (existing.length === 0) {
      await db.query('INSERT INTO categories (name, family, user_id) VALUES (?, ?, NULL)', [cat.name, cat.family]);
    }
  }

  // 4. Initialiser le catalogue de produits pour le vendeur démo
  console.log('[MySQL Init] Vérification des produits en stock...');
  const [productCountRows] = await db.query('SELECT COUNT(*) as count FROM products');
  const count = productCountRows[0].count;

  if (count === 0 && DEFAULT_PRODUCTS && DEFAULT_PRODUCTS.length > 0) {
    console.log(`[MySQL Init] Insertion de ${DEFAULT_PRODUCTS.length} produits exemples pour le vendeur Mamadou Diallo...`);
    for (const prod of DEFAULT_PRODUCTS) {
      const [res] = await db.query(`
        INSERT INTO products (
          user_id, name, category, brand, model, reference, quantity,
          price_buy, price_sale, threshold, location, description, compatible_models
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        sellerId,
        prod.name,
        prod.category,
        prod.brand,
        prod.model,
        prod.reference || null,
        Number(prod.quantity || 0),
        Number(prod.price_buy || 0),
        Number(prod.price_sale || 0),
        Number(prod.threshold || 3),
        prod.location || 'Rayon A',
        prod.description || '',
        prod.compatible || '',
      ]);

      const newProdId = res.insertId;
      await db.query(`
        INSERT INTO stock_movements (user_id, product_id, type, quantity, note)
        VALUES (?, ?, 'entry', ?, 'Stock initial de démarrage')
      `, [sellerId, newProdId, Number(prod.quantity || 0)]);
    }
    console.log('✅ Catalogue initial inséré avec succès.');
  }

  await db.end();
  console.log('🎉 Base de données MySQL `afristock` prête et sécurisée !');
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

