import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  hashPassword,
  isCurrentPasswordHash,
  isLegacyScryptHash,
  verifyPassword,
} from '../server/security.js';

test('hashes passwords with a unique scrypt salt and verifies the result', async () => {
  const first = await hashPassword('MotDePasse!2026');
  const second = await hashPassword('MotDePasse!2026');

  assert.match(first, /^scrypt\$v=1\$N=32768\$r=8\$p=1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  assert.notEqual(first, second);
  assert.equal(isCurrentPasswordHash(first), true);
  assert.equal(await verifyPassword('MotDePasse!2026', first), true);
  assert.equal(await verifyPassword('mauvais-mot-de-passe', first), false);
});

test('rejects malformed hashes instead of treating them as valid scrypt records', async () => {
  assert.equal(isCurrentPasswordHash('scrypt$v=1$N=32768$r=8$p=1$bad$bad'), false);
  assert.equal(await verifyPassword('password', 'scrypt$v=1$N=32768$r=8$p=1$bad$bad'), false);
});

test('verifies legacy scrypt records for automatic upgrade on next login', async () => {
  const password = 'AncienMotDePasse!';
  const salt = 'ancien-sel';
  const digest = crypto.scryptSync(password, salt, 64).toString('hex');

  assert.equal(await verifyPassword(password, `scrypt:${salt}:${digest}`), true);
  assert.equal(isLegacyScryptHash(`scrypt:${salt}:${digest}`), true);
  assert.equal(await verifyPassword('incorrect', `scrypt:${salt}:${digest}`), false);
});

test('supports legacy plaintext verification only to allow automatic hash upgrade', async () => {
  assert.equal(await verifyPassword('legacy-password', 'legacy-password'), true);
  assert.equal(await verifyPassword('different-password', 'legacy-password'), false);
  assert.equal(await verifyPassword('password', 'scrypt:bad-format'), false);
});

test('hashPassword rejects empty passwords', async () => {
  await assert.rejects(() => hashPassword(''), /chaîne non vide/);
  await assert.rejects(() => hashPassword(null), /chaîne non vide/);
});
