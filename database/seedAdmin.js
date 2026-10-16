import '../server/loadEnv.js';
import { pool } from '../server/sqlite.js';
import { hashPassword } from '../server/security.js';

async function seed() {
  const [existing] = await pool.query('SELECT * FROM users WHERE username = ? OR email = ?', ['admin', 'admin@afristock.com']);
  if (existing.length > 0) {
    console.log('Compte admin déjà présent :', existing[0].username, `(${existing[0].email})`);
    process.exit(0);
  }

  const hash = await hashPassword('Admin@AfriStock2026!');
  await pool.query(`
    INSERT INTO users (
      name, username, email, password, role, status,
      first_name, last_name, phone, shop_name, must_change_password
    ) VALUES (?, ?, ?, ?, 'admin', 'active', ?, ?, ?, ?, 0)
  `, [
    'Administrateur AfriStock',
    'admin',
    'admin@afristock.com',
    hash,
    'Admin',
    'AfriStock',
    '+225 07 00 00 01',
    'Direction AfriStock',
  ]);

  console.log('✅ Compte Administrateur initialisé avec succès dans la base SQLite locale !');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Erreur :', err);
  process.exit(1);
});
