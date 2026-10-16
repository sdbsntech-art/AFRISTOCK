const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const positiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const getLocalServerHost = (env = process.env) => {
  const host = env.HOST || '127.0.0.1';
  if (!loopbackHosts.has(host.toLowerCase())) {
    throw new Error('AfriStock est configuré en local uniquement : HOST doit rester sur localhost ou 127.0.0.1.');
  }
  return host;
};

export const getMySqlConfig = (env = process.env) => {
  assertLocalDatabaseEnvironment(env);
  const host = env.MYSQL_HOST || '127.0.0.1';

  return {
    host,
    port: positiveInteger(env.MYSQL_PORT, 3306),
    user: env.MYSQL_USER || 'afristock_app',
    password: env.MYSQL_PASSWORD || '',
    database: env.MYSQL_DATABASE || 'afristock',
    waitForConnections: true,
    connectionLimit: positiveInteger(env.MYSQL_POOL_SIZE, 10),
    queueLimit: 0,
    charset: 'utf8mb4',
    timezone: 'Z',
    dateStrings: true,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    connectTimeout: 15000,
  };
};

export const getMySqlAdminConfig = (env = process.env) => {
  assertLocalDatabaseEnvironment(env);
  return {
    host: env.MYSQL_HOST || '127.0.0.1',
    port: positiveInteger(env.MYSQL_PORT, 3306),
    user: env.MYSQL_ADMIN_USER || 'root',
    password: env.MYSQL_ADMIN_PASSWORD || '',
  };
};

const assertLocalDatabaseEnvironment = (env) => {
  if (env.VERCEL === '1' || env.VERCEL_ENV) {
    throw new Error('AfriStock utilise MySQL local uniquement et ne peut pas fonctionner sur Vercel.');
  }

  if (env.MYSQL_URL?.trim()) {
    throw new Error('MYSQL_URL distante est désactivée. Configurez MYSQL_HOST sur 127.0.0.1.');
  }

  const host = env.MYSQL_HOST || '127.0.0.1';
  if (!loopbackHosts.has(host.toLowerCase())) {
    throw new Error('Connexion MySQL distante refusée : MYSQL_HOST doit être localhost, 127.0.0.1 ou ::1.');
  }
};

export const getSessionSecret = (env = process.env) => {
  const secret = env.SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error('SESSION_SECRET doit contenir au moins 32 octets aléatoires dans le fichier .env.');
  }
  return secret;
};
