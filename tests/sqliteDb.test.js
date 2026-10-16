import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('stores users in a local SQLite file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afristock-sqlite-'));
  process.env.SQLITE_PATH = path.join(dir, 'afristock.sqlite');
  process.env.SESSION_SECRET = 'a'.repeat(48);

  const { closeDatabase, openSqlite, pool } = await import('../server/sqlite.js');
  openSqlite();

  const [[before]] = await pool.query('SELECT COUNT(*) AS user_count FROM users');
  assert.equal(Number(before.user_count), 0);

  await pool.query(
    'INSERT INTO users (name, username, email, password, role, status) VALUES (?, ?, ?, ?, ?, ?)',
    ['Ada', 'ada', 'ada@shop.local', 'hash', 'admin', 'active'],
  );

  const [rows] = await pool.query('SELECT username, email FROM users WHERE username = ?', ['ada']);
  assert.equal(rows[0].username, 'ada');
  assert.equal(rows[0].email, 'ada@shop.local');

  closeDatabase();
});
