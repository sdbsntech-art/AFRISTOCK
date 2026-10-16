import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: '127.0.0.1', port: 3306, user: 'root', password: '', database: 'afristock'
});

const [tables] = await conn.query('SHOW TABLES');
console.log('Tables dans afristock:');
tables.forEach(t => console.log('  -', Object.values(t)[0]));

const [users] = await conn.query('SELECT id, name, username, email, role, status FROM users');
console.log('\nUtilisateurs:');
users.forEach(u => console.log(`  [${u.role}] ${u.name} (@${u.username}) - ${u.email} - ${u.status}`));

const [prodCount] = await conn.query('SELECT COUNT(*) as c FROM products');
console.log('\nProduits en stock:', prodCount[0].c);

const [catCount] = await conn.query('SELECT COUNT(*) as c FROM categories');
console.log('Catégories:', catCount[0].c);

await conn.end();
