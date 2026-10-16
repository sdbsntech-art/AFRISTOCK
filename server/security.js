import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

const CURRENT_PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/**
 * Hash a password using scrypt with a unique cryptographically secure salt.
 * Output format: scrypt$v=1$N=32768$r=8$p=1$<salt_hex>$<derived_key_hex>
 * Asynchrone pour ne jamais bloquer la boucle d'événements du serveur.
 */
export const hashPassword = async (password) => {
  if (!password || typeof password !== 'string') {
    throw new Error('Le mot de passe doit être une chaîne non vide.');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64, CURRENT_PARAMS);
  return `scrypt$v=1$N=32768$r=8$p=1$${salt}$${key.toString('hex')}`;
};

export const isCurrentPasswordHash = (stored) => (
  typeof stored === 'string'
  && /^scrypt\$v=1\$N=32768\$r=8\$p=1\$[a-f0-9]{32}\$[a-f0-9]{128}$/i.test(stored)
);

export const isLegacyScryptHash = (stored) => {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt:')) return false;
  const parts = stored.split(':');
  return parts.length === 3
    && parts[1].length > 0
    && parts[1].length <= 256
    && /^[a-f0-9]{128}$/i.test(parts[2]);
};

/**
 * Verify a plain-text password against a stored hash using constant-time comparison.
 */
export const verifyPassword = async (password, stored) => {
  if (!password || typeof password !== 'string' || !stored || typeof stored !== 'string') return false;

  // Legacy format scrypt:salt:hash
  if (stored.startsWith('scrypt:')) {
    if (!isLegacyScryptHash(stored)) return false;
    const parts = stored.split(':');
    const [, salt, hash] = parts;
    const actual = await scrypt(password, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
  }

  if (stored.startsWith('scrypt$') && !isCurrentPasswordHash(stored)) return false;

  // Standard scrypt$v=1$...
  if (isCurrentPasswordHash(stored)) {
    const parts = stored.split('$');
    const salt = parts[5];
    const hash = parts[6];
    const actual = await scrypt(password, salt, 64, CURRENT_PARAMS);
    const expected = Buffer.from(hash, 'hex');
    return crypto.timingSafeEqual(actual, expected);
  }

  // Verify old plaintext records only so a successful login can upgrade them to scrypt.
  const actual = Buffer.from(password);
  const expected = Buffer.from(stored);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};

/**
 * Automatically generate a cryptographically strong random password for user resets.
 */
export const generateSecurePassword = (length = 12) => {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '@#$%=+!';
  const all = upper + lower + digits + symbols;

  const pwd = [
    upper[crypto.randomInt(upper.length)],
    lower[crypto.randomInt(lower.length)],
    digits[crypto.randomInt(digits.length)],
    symbols[crypto.randomInt(symbols.length)],
  ];

  for (let i = pwd.length; i < Math.max(length, 10); i++) {
    pwd.push(all[crypto.randomInt(all.length)]);
  }

  // Fisher-Yates shuffle
  for (let i = pwd.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [pwd[i], pwd[j]] = [pwd[j], pwd[i]];
  }

  return pwd.join('');
};

/**
 * Validate password complexity.
 */
export const validatePasswordStrength = (password) => {
  if (typeof password !== 'string') return 'Mot de passe invalide.';
  if (password.length < 8) return 'Le mot de passe doit contenir au moins 8 caractères.';
  if (password.length > 256) return 'Le mot de passe ne doit pas dépasser 256 caractères.';
  return null;
};
