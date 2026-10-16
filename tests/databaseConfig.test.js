import assert from 'node:assert/strict';
import test from 'node:test';
import { getMySqlConfig, getSessionSecret } from '../server/databaseConfig.js';

test('parses hosted MySQL URLs and enables verified TLS in production', () => {
  const config = getMySqlConfig({
    NODE_ENV: 'production',
    MYSQL_URL: 'mysql://stock%40user:p%40ss@db.example.com:3307/afristock',
  });

  assert.equal(config.host, 'db.example.com');
  assert.equal(config.port, 3307);
  assert.equal(config.user, 'stock@user');
  assert.equal(config.password, 'p@ss');
  assert.equal(config.database, 'afristock');
  assert.equal(config.connectionLimit, 1);
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test('keeps local development defaults without enabling TLS', () => {
  const config = getMySqlConfig({});

  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.database, 'afristock');
  assert.equal(config.connectionLimit, 10);
  assert.equal('ssl' in config, false);
});

test('rejects production configuration that would fall back to local MySQL', () => {
  assert.throws(() => getMySqlConfig({ NODE_ENV: 'production' }), /MYSQL_URL/);
  assert.throws(
    () => getMySqlConfig({
      NODE_ENV: 'production',
      MYSQL_URL: 'mysql://user:password@localhost/afristock',
    }),
    /localhost/,
  );
});

test('rejects missing or short production session secrets', () => {
  assert.throws(() => getSessionSecret({ NODE_ENV: 'production' }), /32 octets/);
  assert.throws(
    () => getSessionSecret({ NODE_ENV: 'production', SESSION_SECRET: 'too-short' }),
    /32 octets/,
  );
});

test('rejects production settings that disable MySQL TLS verification', () => {
  assert.throws(
    () => getMySqlConfig({
      NODE_ENV: 'production',
      MYSQL_URL: 'mysql://user:password@db.example.com/afristock',
      MYSQL_SSL_REJECT_UNAUTHORIZED: 'false',
    }),
    /validation du certificat TLS/,
  );
});
