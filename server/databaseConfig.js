import os from 'node:os';
import path from 'node:path';

const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const assertLocalDatabaseEnvironment = (env = {}) => {
  if (env.MYSQL_URL?.trim() || env.DATABASE_URL?.trim()) {
    throw new Error('Les URL de bases distantes sont désactivées. AfriStock stocke les données dans un fichier SQLite local.');
  }
};

export const getLocalServerHost = (env = process.env) => {
  const host = env.HOST || '127.0.0.1';
  if (env.VERCEL || env.VERCEL_ENV) return host;
  if (!loopbackHosts.has(host.toLowerCase()) && env.NODE_ENV !== 'production' && !env.PORT) {
    throw new Error('AfriStock est configuré en local uniquement : HOST doit rester sur localhost ou 127.0.0.1.');
  }
  return host;
};

export const getDataDirectory = (env = process.env) => {
  assertLocalDatabaseEnvironment(env);
  if (env.AFRISTOCK_DATA_DIR) {
    if (/^(\\\\|\/\/)/.test(env.AFRISTOCK_DATA_DIR)) {
      throw new Error('AFRISTOCK_DATA_DIR réseau refusé : choisissez un dossier local.');
    }
    return env.AFRISTOCK_DATA_DIR;
  }
  if (env.VERCEL || env.VERCEL_ENV || (process.platform !== 'win32' && !env.LOCALAPPDATA)) {
    return path.join(os.tmpdir(), 'AfriStock');
  }
  const localAppData = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'AfriStock');
};

export const getSqlitePath = (env = process.env) => {
  assertLocalDatabaseEnvironment(env);
  const configured = env.SQLITE_PATH?.trim();
  if (!configured) return path.join(getDataDirectory(env), 'afristock.sqlite');
  if (configured === ':memory:') return configured;
  if (/^(\\\\|\/\/|file:)/i.test(configured)
    || (/^[a-z][a-z0-9+.-]*:/i.test(configured) && !/^[a-zA-Z]:[\\/]/.test(configured))
    || !path.isAbsolute(configured)) {
    throw new Error('SQLITE_PATH doit être un chemin de fichier absolu local, pas une URL ou un partage réseau.');
  }
  return configured;
};

export const getSessionSecret = (env = process.env) => {
  const secret = env.SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error('SESSION_SECRET doit contenir au moins 32 octets aléatoires dans le fichier .env.');
  }
  return secret;
};
