import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { getLocalServerHost, getSessionSecret, getSqlitePath } from '../server/databaseConfig.js';

test('uses a local SQLite file by default', () => {
  const sqlitePath = getSqlitePath({ LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' });
  assert.equal(sqlitePath, path.join('C:\\Users\\test\\AppData\\Local', 'AfriStock', 'afristock.sqlite'));
});

test('rejects remote database URLs', () => {
  assert.throws(
    () => getSqlitePath({ DATABASE_URL: 'postgres://db.example.com/afristock' }),
    /URL de bases distantes/,
  );
  assert.throws(
    () => getSqlitePath({ SQLITE_PATH: 'libsql://db.example.com' }),
    /chemin de fichier absolu local/,
  );
  assert.throws(
    () => getSqlitePath({ SQLITE_PATH: '\\\\server\\share\\afristock.sqlite' }),
    /chemin de fichier absolu local/,
  );
});

test('supports running in cloud and local environments without blocking', () => {
  const vercelPath = getSqlitePath({ VERCEL: '1' });
  assert.ok(vercelPath.endsWith('afristock.sqlite'));
});

test('binds the local API only to loopback interfaces', () => {
  assert.equal(getLocalServerHost({}), '127.0.0.1');
  assert.equal(getLocalServerHost({ HOST: 'localhost' }), 'localhost');
  assert.throws(() => getLocalServerHost({ HOST: '0.0.0.0' }), /HOST doit rester/);
});

test('requires a long session secret in every environment', () => {
  assert.throws(() => getSessionSecret({}), /32 octets/);
  assert.throws(
    () => getSessionSecret({ SESSION_SECRET: 'too-short' }),
    /32 octets/,
  );
  assert.equal(getSessionSecret({ SESSION_SECRET: 'a'.repeat(32) }), 'a'.repeat(32));
});
