const localSessionSecret = 'afristock_super_secret_session_key_2026';

const positiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const getMySqlConfig = (env = process.env) => {
  const isProduction = env.NODE_ENV === 'production';
  if (isProduction && !env.MYSQL_URL && !env.MYSQL_HOST) {
    throw new Error('MYSQL_URL ou MYSQL_HOST doit être configurée dans les variables d’environnement de production.');
  }

  let config;
  let isRemote = false;

  if (env.MYSQL_URL) {
    let url;
    try {
      url = new URL(env.MYSQL_URL);
    } catch {
      throw new Error('MYSQL_URL doit être une URL MySQL valide.');
    }

    if (!['mysql:', 'mysql2:'].includes(url.protocol)) {
      throw new Error('MYSQL_URL doit utiliser le protocole mysql:// ou mysql2://.');
    }

    const database = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if (!url.hostname || !url.username || !database) {
      throw new Error('MYSQL_URL doit contenir un hôte, un utilisateur et une base de données.');
    }

    config = {
      host: url.hostname,
      port: positiveInteger(url.port, 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database,
    };
    isRemote = !['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if (isProduction && !isRemote) {
      throw new Error('MYSQL_URL doit pointer vers une base MySQL hébergée, pas vers localhost.');
    }
  } else {
    const host = env.MYSQL_HOST || '127.0.0.1';
    config = {
      host,
      port: positiveInteger(env.MYSQL_PORT, 3306),
      user: env.MYSQL_USER || 'root',
      password: env.MYSQL_PASSWORD || '',
      database: env.MYSQL_DATABASE || 'afristock',
    };
    isRemote = !['localhost', '127.0.0.1', '::1'].includes(host);
    if (isProduction && !isRemote) {
      throw new Error('MYSQL_HOST doit pointer vers une base MySQL hébergée dans le Cloud, pas vers 127.0.0.1.');
    }
  }

  const useSsl = env.MYSQL_SSL === 'true' || (isRemote && env.MYSQL_SSL !== 'false');

  return {
    ...config,
    waitForConnections: true,
    connectionLimit: positiveInteger(env.MYSQL_POOL_SIZE, isProduction ? 1 : 10),
    queueLimit: 0,
    charset: 'utf8mb4',
    timezone: 'Z',
    dateStrings: true,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    connectTimeout: 15000,
    ...(useSsl
      ? {
          ssl: {
            rejectUnauthorized: env.MYSQL_SSL_REJECT_UNAUTHORIZED === 'true',
            ...(env.MYSQL_SSL_CA ? { ca: env.MYSQL_SSL_CA } : {}),
          },
        }
      : {}),
  };
};

export const getSessionSecret = (env = process.env) => {
  return env.SESSION_SECRET || localSessionSecret;
};
