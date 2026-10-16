import assert from 'node:assert/strict';
import test from 'node:test';
import { getLocalServerHost, getMySqlConfig, getSessionSecret } from '../server/databaseConfig.js';

test('uses local MySQL defaults without remote TLS configuration', () => {
  const config = getMySqlConfig({});

  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.database, 'afristock');
  assert.equal(config.connectionLimit, 10);
  assert.equal('ssl' in config, false);
});

test('rejects remote MySQL hosts and hosted database URLs', () => {
  assert.throws(() => getMySqlConfig({ MYSQL_HOST: 'db.example.com' }), /Connexion MySQL distante refusée/);
  assert.throws(
    () => getMySqlConfig({ MYSQL_URL: 'mysql://user:password@db.example.com/afristock' }),
    /MYSQL_URL distante est désactivée/,
  );
});

test('refuses to run the MySQL API on Vercel', () => {
  assert.throws(() => getMySqlConfig({ VERCEL: '1' }), /ne peut pas fonctionner sur Vercel/);
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
