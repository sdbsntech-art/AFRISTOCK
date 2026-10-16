import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  hashPassword,
  isCurrentPasswordHash,
  isLegacyScryptHash,
  verifyPassword,
} from '../server/security.js';

test('hashes passwords with a unique scrypt salt and verifies the result', () => {
  const first = hashPassword('MotDePasse!2026');
  const second = hashPassword('MotDePasse!2026');

  assert.match(first, /^scrypt\$v=1\$N=32768\$r=8\$p=1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  assert.notEqual(first, second);
  assert.equal(isCurrentPasswordHash(first), true);
  assert.equal(verifyPassword('MotDePasse!2026', first), true);
  assert.equal(verifyPassword('mauvais-mot-de-passe', first), false);
});

test('rejects malformed hashes instead of treating them as valid scrypt records', () => {
  assert.equal(isCurrentPasswordHash('scrypt$v=1$N=32768$r=8$p=1$bad$bad'), false);
  assert.equal(verifyPassword('password', 'scrypt$v=1$N=32768$r=8$p=1$bad$bad'), false);
});

test('verifies legacy scrypt records for automatic upgrade on next login', () => {
  const password = 'AncienMotDePasse!';
  const salt = 'ancien-sel';
  const digest = crypto.scryptSync(password, salt, 64).toString('hex');

  assert.equal(verifyPassword(password, `scrypt:${salt}:${digest}`), true);
  assert.equal(isLegacyScryptHash(`scrypt:${salt}:${digest}`), true);
  assert.equal(verifyPassword('incorrect', `scrypt:${salt}:${digest}`), false);
});

test('supports legacy plaintext verification only to allow automatic hash upgrade', () => {
  assert.equal(verifyPassword('legacy-password', 'legacy-password'), true);
  assert.equal(verifyPassword('different-password', 'legacy-password'), false);
  assert.equal(verifyPassword('password', 'scrypt:bad-format'), false);
});
