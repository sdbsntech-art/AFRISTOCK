const localSessionSecret = 'afristock_super_secret_session_key_2026';

const positiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

// Configuration MySQL locale (Laragon / 127.0.0.1)
export const getMySqlConfig = (env = process.env) => {
  return {
    host: env.MYSQL_HOST || '127.0.0.1',
    port: positiveInteger(env.MYSQL_PORT, 3306),
    user: env.MYSQL_USER || 'root',
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

export const getSessionSecret = (env = process.env) => {
  return env.SESSION_SECRET || localSessionSecret;
};
