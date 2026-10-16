import crypto from 'node:crypto';

/**
 * Hash a password using scrypt with a unique cryptographically secure salt.
 * Output format: scrypt$v=1$N=32768$r=8$p=1$<salt_hex>$<derived_key_hex>
 */
export const hashPassword = (password) => {
  if (!password || typeof password !== 'string') {
    throw new Error('Le mot de passe doit être une chaîne non vide.');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$v=1$N=32768$r=8$p=1$${salt}$${key.toString('hex')}`;
};

/**
 * Verify a plain-text password against a stored hash using constant-time comparison.
 */
export const verifyPassword = (password, stored) => {
  if (!password || !stored || typeof stored !== 'string') return false;

  // Legacy format scrypt:salt:hash
  if (stored.startsWith('scrypt:')) {
    const [, salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const actual = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
  }

  // Standard scrypt$v=1$...
  if (!stored.startsWith('scrypt$v=1$N=32768$r=8$p=1$')) {
    // In case of plain text legacy fallback during migration
    return stored === password;
  }

  const parts = stored.split('$');
  const salt = parts[5];
  const hash = parts[6];
  if (!salt || !hash) return false;

  const actual = crypto.scryptSync(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  const expected = Buffer.from(hash, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
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
