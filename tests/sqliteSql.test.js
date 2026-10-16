import assert from 'node:assert/strict';
import test from 'node:test';
import { isReadQuery, toSqlite } from '../server/sqliteSql.js';

test('translates MySQL date helpers used by AfriStock', () => {
  const sql = toSqlite(`
    SELECT DATE_FORMAT(sale_date, '%d') AS day
    FROM sales
    WHERE DATE(sale_date) = CURDATE()
      OR DATE(sale_date) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)
      OR sale_date >= DATE_SUB(NOW(), INTERVAL 6 DAY)
    FOR UPDATE
  `);

  assert.match(sql, /strftime\('%d', sale_date\)/);
  assert.match(sql, /date\(sale_date\) = date\('now','localtime'\)/);
  assert.match(sql, /date\('now','localtime','-1 days'\)/);
  assert.match(sql, /datetime\('now','localtime','-6 days'\)/);
  assert.doesNotMatch(sql, /FOR UPDATE/);
});

test('translates upsert settings query', () => {
  const sql = toSqlite('INSERT INTO app_settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)');
  assert.match(sql, /ON CONFLICT\("key"\) DO UPDATE SET "value" = excluded\."value"/);
});

test('detects read queries', () => {
  assert.equal(isReadQuery('SELECT 1'), true);
  assert.equal(isReadQuery('INSERT INTO users (name) VALUES (?)'), false);
});
