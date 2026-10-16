import './loadEnv.js';
import express from 'express';
import session from 'express-session';
import crypto from 'node:crypto';
import { DEFAULT_SHOP_NAME, fullName, publicUser } from './userProfile.js';
import { buildMonthlyAnalysis } from './reportEngine.js';
import {
  hashPassword,
  isCurrentPasswordHash,
  verifyPassword,
  generateSecurePassword,
  validatePasswordStrength,
} from './security.js';
import { getSessionSecret } from './databaseConfig.js';
import { closeDatabase, openSqlite, pool, SqliteSessionStore, withTransaction } from './sqlite.js';

const sessionSecret = getSessionSecret();

const app = express();
const sessionStore = new SqliteSessionStore(openSqlite());

app.disable('x-powered-by');

// Normalise API URLs with or without the /api prefix.
app.use((req, _res, next) => {
  if (!req.url.startsWith('/api')) {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }
  next();
});

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Robots-Tag': 'noindex, nofollow',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  });
  if (req.path.startsWith('/api')) res.set('Cache-Control', 'no-store');
  next();
});

// Protection CSRF (vérification de l'origine) sur toutes les requêtes modifiant l'état.
const originKey = (value) => {
  try {
    const url = new URL(value.includes('://') ? value : `http://${value}`);
    const hostname = url.hostname === '127.0.0.1' || url.hostname === '[::1]' ? 'localhost' : url.hostname;
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    return `${hostname}:${port}`;
  } catch {
    return null;
  }
};

const allowedOriginKeys = new Set(
  String(process.env.APP_ORIGIN || '')
    .split(',')
    .map((entry) => originKey(entry.trim()))
    .filter(Boolean),
);

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const isLoopbackHost = (value) => ['localhost', '127.0.0.1', '[::1]'].includes(value);
app.use((req, res, next) => {
  if (!unsafeMethods.has(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next(); // Requêtes non-navigateur (curl, tests internes).

  const originKeyed = originKey(origin);
  const requestKeyed = originKey(`${req.protocol}://${req.get('host') || ''}`);
  const isSameOrigin = Boolean(requestKeyed) && requestKeyed === originKeyed;
  const isAllowedOrigin = Boolean(originKeyed) && allowedOriginKeys.has(originKeyed);
  // En développement uniquement : autoriser les origines localhost (vite dev/preview sur n'importe quel port).
  const isLocalDevOrigin = process.env.NODE_ENV !== 'production' && (() => {
    try {
      return isLoopbackHost(new URL(origin).hostname);
    } catch {
      return false;
    }
  })();

  if (isSameOrigin || isAllowedOrigin || isLocalDevOrigin) return next();
  return res.status(403).json({ error: 'Origine de la requête refusée (protection CSRF).' });
});

app.use(express.json({ limit: '5mb' }));

app.use(session({
  name: 'afristock.sid',
  store: sessionStore,
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 1000 * 60 * 60 * 12, // 12 heures
  },
}));

// Limiteur de tentatives de connexion contre force brute
// - fenêtre glissante de 15 minutes, 15 tentatives max
// - clés IP **et** identifiant (contournement par identifiants multiples impossible)
// - purge périodique pour éviter toute fuite mémoire
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = 15;
const AUTH_MAX_KEYS = 20000;
const authAttempts = new Map();
let lastAuthPrune = 0;

const pruneAuthAttempts = (now) => {
  if (now - lastAuthPrune < 60 * 1000) return;
  lastAuthPrune = now;
  for (const [key, times] of authAttempts) {
    const recent = times.filter((time) => now - time < AUTH_WINDOW_MS);
    if (recent.length) authAttempts.set(key, recent);
    else authAttempts.delete(key);
  }
};

// keyBuilder : fonction optionnelle (req) => string | string[]
const limitAuthAttempts = (keyBuilder) => (req, res, next) => {
  const now = Date.now();
  pruneAuthAttempts(now);

  const built = keyBuilder ? keyBuilder(req) : null;
  const keys = [`ip:${req.ip}`, ...(Array.isArray(built) ? built : built ? [built] : [])]
    .map((key) => String(key).slice(0, 300));

  for (const key of keys) {
    const recent = (authAttempts.get(key) || []).filter((time) => now - time < AUTH_WINDOW_MS);
    if (recent.length >= AUTH_MAX_ATTEMPTS) {
      return res.status(429).json({ error: 'Trop de tentatives infructueuses. Réessayez dans 15 minutes.' });
    }
  }

  if (authAttempts.size > AUTH_MAX_KEYS) authAttempts.clear();

  for (const key of keys) {
    const recent = (authAttempts.get(key) || []).filter((time) => now - time < AUTH_WINDOW_MS);
    recent.push(now);
    authAttempts.set(key, recent);
  }
  next();
};

const loginAttemptKey = (req) => {
  const identifier = String(req.body?.identifier || '').trim().toLowerCase().slice(0, 254);
  return identifier ? `login:${identifier}` : null;
};

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

const getSessionUser = (req) => req.session?.user || null;

// Recharge l'utilisateur depuis la base à chaque requête protégée :
// un compte suspendu, désactivé ou rétrogradé perd ses droits immédiatement
// (et non à l'expiration du cookie de session, 12 h plus tard).
const resolveSessionUser = async (req) => {
  const sessionUser = getSessionUser(req);
  if (!sessionUser?.id) {
    return { error: { status: 401, message: 'Session expirée ou non authentifiée.' } };
  }

  const fresh = await loadUser(sessionUser.id);
  if (!fresh || fresh.status !== 'active') {
    await new Promise((resolve) => req.session.destroy(() => resolve()));
    return { error: { status: 401, message: 'Session expirée ou non authentifiée.' } };
  }

  const nextUser = publicUser(fresh);
  if (JSON.stringify(sessionUser) !== JSON.stringify(nextUser)) {
    req.session.user = nextUser;
  }
  return { user: nextUser };
};

const requireAuth = asyncRoute(async (req, res, next) => {
  const { user, error } = await resolveSessionUser(req);
  if (error) return res.status(error.status).json({ error: error.message });
  if (!user) return res.status(401).json({ error: 'Session expirée ou non authentifiée.' });
  next();
});

const requireAdmin = asyncRoute(async (req, res, next) => {
  const { user, error } = await resolveSessionUser(req);
  if (error) return res.status(error.status).json({ error: error.message });
  if (!user) return res.status(401).json({ error: 'Non authentifié.' });
  if (user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
  }
  next();
});

const setSessionUser = (req, user) => {
  req.session.user = publicUser(user);
  return req.session.user;
};

const regenerateSession = (req, user) => new Promise((resolve, reject) => {
  req.session.regenerate((error) => {
    if (error) return reject(error);
    resolve(setSessionUser(req, user));
  });
});

const loadUser = async (id) => {
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
  return rows[0] || null;
};

const getSetting = async (key) => {
  const [rows] = await pool.query('SELECT value FROM app_settings WHERE `key` = ?', [key]);
  return rows[0]?.value || '';
};

const setSetting = async (key, value) => {
  await pool.query(
    'INSERT INTO app_settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
    [key, value],
  );
};

// Enregistrement direct et instantané de chaque action dans la base de données
const logActivity = async (connOrPool, { userId, userName, action, entityType, entityId, description }) => {
  try {
    await (connOrPool || pool).query(
      'INSERT INTO activity_logs (user_id, user_name, action, entity_type, entity_id, description) VALUES (?, ?, ?, ?, ?, ?)',
      [userId || null, userName || 'Système', action, entityType, entityId || null, description],
    );
  } catch (err) {
    console.warn(`[Activity Log Error] ${err.message}`);
  }
};

const validId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const validNonNegativeInt = (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0;
const validText = (value, max = 200) => typeof value === 'string' && value.length <= max;
// Logo borné en taille pour éviter le remplissage abusif de la base (client : 1,8 Mo max).
const MAX_LOGO_CHARS = 2600000;
const validLogo = (value) => {
  if (!value) return true;
  if (typeof value !== 'string' || value.length > MAX_LOGO_CHARS) return false;
  return /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value)
    || /^https:\/\/lh3\.googleusercontent\.com\/[^\s"'<>\\]{1,2048}$/.test(value);
};

// Convert SQLite numeric values for API responses.
const numericRows = (rows, fields) => rows.map((row) => Object.fromEntries(
  Object.entries(row).map(([key, value]) => [key, fields.includes(key) && value !== null ? Number(value) : value]),
));
const numericRow = (row, fields) => (row ? numericRows([row], fields)[0] : null);

// =====================================================================
// AUTHENTIFICATION & SESSIONS
// =====================================================================

app.get('/api/auth/status', asyncRoute(async (_req, res) => {
  const [[result]] = await pool.query('SELECT COUNT(*) AS user_count FROM users');
  const noUsers = Number(result.user_count) === 0;
  res.set('Cache-Control', 'no-store');
  res.json({
    setupRequired: noUsers,
    setupBlocked: false,
  });
}));

app.get('/api/auth/google-config', asyncRoute(async (_req, res) => {
  res.json({ clientId: process.env.GOOGLE_CLIENT_ID || await getSetting('google_client_id') });
}));

app.get('/api/session', asyncRoute(async (req, res) => {
  const sessionUser = getSessionUser(req);
  if (!sessionUser?.id) return res.json({ user: null });
  const fresh = await loadUser(sessionUser.id);
  if (!fresh || fresh.status !== 'active') {
    req.session.destroy(() => {});
    return res.json({ user: null });
  }
  res.json({ user: setSessionUser(req, fresh) });
}));

app.post('/api/login', limitAuthAttempts(loginAttemptKey), asyncRoute(async (req, res, next) => {
  const identifier = String(req.body?.identifier || '').trim().slice(0, 254);
  const pass = String(req.body?.password || '');

  if (!identifier || !pass || pass.length > 256) {
    return res.status(400).json({ error: 'Identifiant et mot de passe requis.' });
  }

  const [rows] = await pool.query(
    'SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?',
    [identifier.toLowerCase(), identifier.toLowerCase()],
  );
  const user = rows[0];

  if (!user || !(await verifyPassword(pass, user.password))) {
    await logActivity(pool, {
      userId: user?.id || null,
      userName: user?.name || 'Inconnu',
      action: 'LOGIN_FAILED',
      entityType: 'user',
      entityId: user?.id || null,
      description: `Tentative de connexion échouée pour "${identifier}"`,
    });
    return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' });
  }

  if (user.status !== 'active') {
    return res.status(403).json({ error: 'Ce compte est inactif ou désactivé. Contactez l’administrateur.' });
  }

  // Si ancien hash non standard ou besoin de rehash
  if (!isCurrentPasswordHash(user.password)) {
    await pool.query('UPDATE users SET password = ? WHERE id = ?', [await hashPassword(pass), user.id]);
  }

  try {
    const sessionData = await regenerateSession(req, user);
    res.json({
      user: sessionData,
      message: user.must_change_password
        ? 'Connexion réussie. Veuillez définir votre nouveau mot de passe personnel.'
        : 'Connexion réussie.',
    });
  } catch (error) {
    next(error);
  }
}));

app.post('/api/logout', (req, res) => {
  req.session.destroy((error) => {
    res.clearCookie('afristock.sid');
    if (error) return res.status(500).json({ error: 'Impossible de fermer la session.' });
    res.json({ message: 'Déconnecté avec succès.' });
  });
});

app.post('/api/signup', limitAuthAttempts(), asyncRoute(async (req, res, next) => {
  const firstName = String(req.body?.first_name || '').trim();
  const lastName = String(req.body?.last_name || '').trim();
  const safeName = fullName(firstName, lastName, String(req.body?.name || '').trim());
  const username = String(req.body?.username || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const phone = String(req.body?.phone || '').trim();
  const shopName = String(req.body?.shop_name || '').trim() || DEFAULT_SHOP_NAME;
  const logo = String(req.body?.logo || '').trim();

  if (!firstName || !lastName || !username || !email || !password) {
    return res.status(400).json({ error: 'Prénom, nom, identifiant, email et mot de passe sont obligatoires.' });
  }
  if (!validText(firstName, 128) || !validText(lastName, 128) || !validText(phone, 64)
    || !validText(shopName, 254)) {
    return res.status(400).json({ error: 'Un ou plusieurs champs dépassent la longueur maximale autorisée.' });
  }

  const pwdError = validatePasswordStrength(password);
  if (pwdError) return res.status(400).json({ error: pwdError });
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    return res.status(400).json({ error: 'Identifiant invalide (3 à 32 caractères alphanumériques).' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'Adresse email invalide.' });
  }
  if (!validLogo(logo)) {
    return res.status(400).json({ error: 'Format de logo non autorisé.' });
  }

  const passwordHash = await hashPassword(password);
  let userId;
  try {
    userId = await withTransaction(async (connection) => {
      const [[result]] = await connection.query('SELECT COUNT(*) AS user_count FROM users');
      if (Number(result.user_count) !== 0) {
        const error = new Error('La création publique est fermée. Demandez un compte à l’administrateur.');
        error.status = 403;
        throw error;
      }

      const [created] = await connection.query(`
        INSERT INTO users (name, username, email, password, role, status, first_name, last_name, phone, shop_name, logo, must_change_password)
        VALUES (?, ?, ?, ?, 'admin', 'active', ?, ?, ?, ?, ?, 0)
      `, [
        safeName,
        username,
        email,
        passwordHash,
        firstName,
        lastName,
        phone,
        shopName,
        logo,
      ]);
      return created.insertId;
    });
  } catch (error) {
    if (error.status && error.status < 500) {
      return res.status(error.status).json({ error: error.message });
    }
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Un compte avec cet email ou cet identifiant existe déjà.' });
    }
    throw error;
  }

  const newUser = await loadUser(userId);
  try {
    res.status(201).json({
      user: await regenerateSession(req, newUser),
      message: 'Compte administrateur principal créé.',
    });
  } catch (error) {
    next(error);
  }
}));

app.post('/api/auth/google', limitAuthAttempts(), asyncRoute(async (req, res) => {
  const credential = String(req.body?.credential || '').trim();
  const clientId = process.env.GOOGLE_CLIENT_ID || await getSetting('google_client_id');
  if (!credential) return res.status(400).json({ error: 'Jeton Google manquant.' });
  if (!clientId) return res.status(400).json({ error: 'Configurez d’abord l’ID client Google dans Paramètres.' });

  try {
    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`, { signal: AbortSignal.timeout(5000) });
    const payload = await response.json();
    const verified = payload.email_verified === true || payload.email_verified === 'true';
    if (!response.ok || payload.aud !== clientId || !verified || !payload.sub || !payload.email) {
      return res.status(401).json({ error: 'Vérification Google refusée.' });
    }
    const email = String(payload.email).toLowerCase();
    const given = String(payload.given_name || '').trim();
    const family = String(payload.family_name || '').trim();
    const display = fullName(given, family, payload.name || email.split('@')[0]);

    const [rows] = await pool.query('SELECT * FROM users WHERE email = ? OR google_id = ?', [email, payload.sub]);
    let user = rows[0];

    if (!user) {
      return res.status(403).json({ error: 'La connexion Google ne crée pas de compte. Créez le premier compte administrateur avec le formulaire sécurisé.' });
    }
    if (!user.google_id) {
      await pool.query('UPDATE users SET google_id = ? WHERE id = ?', [payload.sub, user.id]);
      user = await loadUser(user.id);
    }

    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Ce compte est inactif ou désactivé.' });
    }

    res.json({ user: await regenerateSession(req, user), message: 'Connexion Google réussie.' });
  } catch (error) {
    console.error(`[Google Auth] Échec : ${error.message}`);
    res.status(500).json({ error: 'Impossible de vérifier le compte Google.' });
  }
}));

// Changement de mot de passe sécurisé (par l'utilisateur connecté)
app.post('/api/auth/change-password', requireAuth, asyncRoute(async (req, res) => {
  const currentUserId = getSessionUser(req).id;
  const user = await loadUser(currentUserId);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');

  // Si l'utilisateur n'est pas sous obligation 'must_change_password', on exige le mot de passe actuel
  if (!user.must_change_password) {
    if (!currentPassword) {
      return res.status(400).json({ error: 'Le mot de passe actuel est requis.' });
    }
    if (!(await verifyPassword(currentPassword, user.password))) {
      return res.status(401).json({ error: 'Le mot de passe actuel est incorrect.' });
    }
  }

  const pwdError = validatePasswordStrength(newPassword);
  if (pwdError) return res.status(400).json({ error: pwdError });

  // Hasher de manière ultra-sécurisée avec Scrypt
  const newHash = await hashPassword(newPassword);
  await pool.query('UPDATE users SET password = ?, must_change_password = 0 WHERE id = ?', [newHash, user.id]);

  await logActivity(pool, {
    userId: user.id,
    userName: user.name,
    action: 'PASSWORD_CHANGE',
    entityType: 'user',
    entityId: user.id,
    description: `Modification et sécurisation du mot de passe avec Scrypt`,
  });

  const updatedUser = await loadUser(user.id);
  setSessionUser(req, updatedUser);

  res.json({
    user: publicUser(updatedUser),
    message: 'Votre mot de passe a été modifié et sécurisé avec succès.',
  });
}));

// =====================================================================
// PANEL ADMINISTRATEUR : GESTION DES UTILISATEURS & PRODUITS VENDEURS
// =====================================================================

// 0. Récupérer le journal des modifications en direct (temps réel)
app.get('/api/admin/activity-logs', requireAdmin, asyncRoute(async (_req, res) => {
  const [rows] = await pool.query(`
    SELECT al.*, u.shop_name 
    FROM activity_logs al 
    LEFT JOIN users u ON u.id = al.user_id 
    ORDER BY al.created_at DESC LIMIT 80
  `);
  res.json(rows);
}));

// 1. Lister tous les utilisateurs avec statistiques complètes de vente et stock
app.get('/api/admin/users', requireAdmin, asyncRoute(async (_req, res) => {
  const [users] = await pool.query(`
    SELECT 
      u.id, u.name, u.first_name, u.last_name, u.username, u.email,
      u.phone, u.shop_name, u.role, u.status, u.must_change_password,
      u.created_at, u.updated_at,
      COUNT(DISTINCT p.id) AS product_count,
      COALESCE(SUM(p.quantity), 0) AS total_stock_units,
      COALESCE(SUM(p.quantity * p.price_buy), 0) AS total_inventory_cost,
      COALESCE(SUM(p.quantity * p.price_sale), 0) AS total_inventory_value,
      COALESCE(sales_summary.total_revenue, 0) AS total_sales_revenue,
      COALESCE(sales_summary.total_profit, 0) AS total_sales_profit,
      COALESCE(sales_summary.sales_count, 0) AS total_sales_count
    FROM users u
    LEFT JOIN products p ON p.user_id = u.id
    LEFT JOIN (
      SELECT 
        user_id,
        SUM(total_amount) AS total_revenue,
        SUM(total_profit) AS total_profit,
        COUNT(id) AS sales_count
      FROM sales
      GROUP BY user_id
    ) sales_summary ON sales_summary.user_id = u.id
    GROUP BY u.id, sales_summary.total_revenue, sales_summary.total_profit, sales_summary.sales_count
    ORDER BY u.role ASC, u.created_at DESC
  `);

  res.json(numericRows(users, [
    'product_count',
    'total_stock_units',
    'total_inventory_cost',
    'total_inventory_value',
    'total_sales_revenue',
    'total_sales_profit',
    'total_sales_count',
  ]));
}));

// 2. Voir un utilisateur spécifique et son détail
app.get('/api/admin/users/:id', requireAdmin, asyncRoute(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
  const user = await loadUser(Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

  const [[stockStats]] = await pool.query(`
    SELECT 
      COUNT(*) AS product_count,
      COALESCE(SUM(quantity), 0) AS stock_units,
      COALESCE(SUM(quantity * price_buy), 0) AS stock_cost,
      COALESCE(SUM(quantity * price_sale), 0) AS stock_value
    FROM products WHERE user_id = ?
  `, [user.id]);

  const [[salesStats]] = await pool.query(`
    SELECT 
      COUNT(*) AS sales_count,
      COALESCE(SUM(total_amount), 0) AS total_revenue,
      COALESCE(SUM(total_profit), 0) AS total_profit
    FROM sales WHERE user_id = ?
  `, [user.id]);

  res.json({
    user: publicUser(user),
    stockStats: numericRow(stockStats, ['product_count', 'stock_units', 'stock_cost', 'stock_value']),
    salesStats: numericRow(salesStats, ['sales_count', 'total_revenue', 'total_profit']),
  });
}));

// 3. Voir tous les produits vendus par un utilisateur spécifique
app.get('/api/admin/users/:id/products', requireAdmin, asyncRoute(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
  const userId = Number(req.params.id);

  const [products] = await pool.query(`
    SELECT p.*, c.family AS category_family
    FROM products p
    LEFT JOIN categories c ON c.name = p.category
    WHERE p.user_id = ?
    ORDER BY p.category ASC, p.name ASC
  `, [userId]);

  res.json(products.map((p) => ({
    ...p,
    profit_unit: Number(p.price_sale) - Number(p.price_buy),
    status: p.quantity <= 0 ? 'Rupture' : p.quantity <= p.threshold ? 'Stock faible' : 'Disponible',
  })));
}));

// 4. Créer un nouvel utilisateur / vendeur par l'admin
app.post('/api/admin/users', requireAdmin, asyncRoute(async (req, res) => {
  const sessionUser = getSessionUser(req);
  const firstName = String(req.body?.first_name || '').trim();
  const lastName = String(req.body?.last_name || '').trim();
  const safeName = fullName(firstName, lastName, String(req.body?.name || '').trim());
  const username = String(req.body?.username || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const phone = String(req.body?.phone || '').trim();
  const shopName = String(req.body?.shop_name || '').trim() || DEFAULT_SHOP_NAME;
  const role = req.body?.role === 'admin' ? 'admin' : 'seller';
  const rawPassword = String(req.body?.password || '').trim() || generateSecurePassword(12);

  if (!username || !email) {
    return res.status(400).json({ error: 'Identifiant et email sont obligatoires.' });
  }

  const [duplicate] = await pool.query('SELECT id FROM users WHERE email = ? OR username = ?', [email, username]);
  if (duplicate.length > 0) {
    return res.status(409).json({ error: 'Un compte avec cet identifiant ou cet email existe déjà.' });
  }

  const [result] = await pool.query(`
    INSERT INTO users (name, username, email, password, role, status, first_name, last_name, phone, shop_name, must_change_password)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 1)
  `, [
    safeName,
    username,
    email,
    await hashPassword(rawPassword),
    role,
    firstName,
    lastName,
    phone,
    shopName,
  ]);

  const createdUser = await loadUser(result.insertId);

  await logActivity(pool, {
    userId: sessionUser.id,
    userName: sessionUser.name,
    action: 'USER_CREATE',
    entityType: 'user',
    entityId: result.insertId,
    description: `Création du compte "${safeName}" (@${username}, rôle: ${role})`,
  });

  res.status(201).json({
    user: publicUser(createdUser),
    temporaryPassword: rawPassword,
    message: `Utilisateur créé avec succès. Mot de passe généré : ${rawPassword}`,
  });
}));

// 5. Modifier le profil, statut ou rôle d'un utilisateur par l'admin
app.put('/api/admin/users/:id', requireAdmin, asyncRoute(async (req, res) => {
  const sessionUser = getSessionUser(req);
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
  const userId = Number(req.params.id);
  const user = await loadUser(userId);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

  const firstName = String(req.body?.first_name ?? user.first_name).trim();
  const lastName = String(req.body?.last_name ?? user.last_name).trim();
  const username = String(req.body?.username ?? user.username).trim();
  const email = String(req.body?.email ?? user.email).trim().toLowerCase();
  const phone = String(req.body?.phone ?? user.phone).trim();
  const shopName = String(req.body?.shop_name ?? user.shop_name).trim() || DEFAULT_SHOP_NAME;
  const role = req.body?.role ? (req.body.role === 'admin' ? 'admin' : 'seller') : user.role;
  const status = ['active', 'inactive', 'suspended'].includes(req.body?.status) ? req.body.status : user.status;

  // Éviter de désactiver son propre compte admin
  if (userId === sessionUser.id && status !== 'active') {
    return res.status(400).json({ error: 'Vous ne pouvez pas désactiver votre propre compte administrateur.' });
  }

  try {
    await pool.query(`
      UPDATE users 
      SET name = ?, first_name = ?, last_name = ?, username = ?, email = ?, phone = ?, shop_name = ?, role = ?, status = ?
      WHERE id = ?
    `, [
      fullName(firstName, lastName),
      firstName,
      lastName,
      username,
      email,
      phone,
      shopName,
      role,
      status,
      userId,
    ]);

    await logActivity(pool, {
      userId: sessionUser.id,
      userName: sessionUser.name,
      action: 'USER_UPDATE',
      entityType: 'user',
      entityId: userId,
      description: `Mise à jour du compte "${user.name}" (Statut: ${status}, Rôle: ${role})`,
    });

    const updated = await loadUser(userId);
    res.json({ user: publicUser(updated), message: 'Utilisateur mis à jour avec succès.' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Cet identifiant ou cet email est déjà utilisé.' });
    }
    throw error;
  }
}));

// 6. Réinitialisation automatique et sécurisée du mot de passe par l'administrateur
app.post('/api/admin/users/:id/reset-password', requireAdmin, asyncRoute(async (req, res) => {
  const sessionUser = getSessionUser(req);
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
  const userId = Number(req.params.id);
  const user = await loadUser(userId);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

  // Génération automatique d'un mot de passe sécurisé à haute entropie
  const tempPassword = generateSecurePassword(12);
  const hashed = await hashPassword(tempPassword);

  // Mettre à jour et forcer le changement à la prochaine connexion
  await pool.query('UPDATE users SET password = ?, must_change_password = 1 WHERE id = ?', [hashed, userId]);

  // Enregistrer dans la table d'audit password_resets (jamais le mot de passe en clair)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  await pool.query(`
    INSERT INTO password_resets (user_id, token, temp_password, expires_at)
    VALUES (?, ?, NULL, ?)
  `, [userId, crypto.randomBytes(24).toString('hex'), expiresAt]);

  await logActivity(pool, {
    userId: sessionUser.id,
    userName: sessionUser.name,
    action: 'PASSWORD_RESET',
    entityType: 'user',
    entityId: userId,
    description: `Réinitialisation automatique du mot de passe pour "${user.name}" (@${user.username})`,
  });

  res.json({
    user_id: userId,
    username: user.username,
    temporaryPassword: tempPassword,
    message: `Mot de passe réinitialisé automatiquement pour ${user.name}. Nouveau mot de passe temporaire : ${tempPassword}`,
  });
}));

// 7. Supprimer un compte vendeur par l'admin
app.delete('/api/admin/users/:id', requireAdmin, asyncRoute(async (req, res) => {
  const sessionUser = getSessionUser(req);
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
  const userId = Number(req.params.id);

  if (userId === sessionUser.id) {
    return res.status(400).json({ error: 'Impossible de supprimer votre propre compte.' });
  }

  const user = await loadUser(userId);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

  await logActivity(pool, {
    userId: sessionUser.id,
    userName: sessionUser.name,
    action: 'USER_DELETE',
    entityType: 'user',
    entityId: userId,
    description: `Suppression du compte utilisateur "${user.name}" (id=${userId})`,
  });

  await pool.query('DELETE FROM users WHERE id = ?', [userId]);
  res.json({ message: 'Compte vendeur et ses données associées supprimés.' });
}));

// =====================================================================
// PROFIL & PARAMETRES
// =====================================================================

app.get('/api/profile', requireAuth, asyncRoute(async (req, res) => {
  const user = await loadUser(getSessionUser(req).id);
  res.json({ user: publicUser(user) });
}));

app.put('/api/profile', requireAuth, asyncRoute(async (req, res) => {
  const current = await loadUser(getSessionUser(req).id);
  if (!current) return res.status(404).json({ error: 'Profil introuvable.' });

  const firstName = String(req.body?.first_name || '').trim();
  const lastName = String(req.body?.last_name || '').trim();
  const phone = String(req.body?.phone || '').trim();
  const shopName = String(req.body?.shop_name || '').trim() || DEFAULT_SHOP_NAME;
  const logo = req.body?.logo === undefined ? current.logo : String(req.body.logo || '').trim();
  const username = String(req.body?.username || current.username).trim();
  const email = String(req.body?.email || current.email).trim().toLowerCase();

  if (!firstName || !lastName || !username || !email) {
    return res.status(400).json({ error: 'Prénom, nom, identifiant et email sont obligatoires.' });
  }
  if (!validLogo(logo) || ![firstName, lastName, phone, shopName, username, email].every((v) => validText(v, 254))) {
    return res.status(400).json({ error: 'Données invalides ou logo trop volumineux.' });
  }

  try {
    await pool.query(`
      UPDATE users 
      SET name = ?, first_name = ?, last_name = ?, phone = ?, shop_name = ?, logo = ?, username = ?, email = ?
      WHERE id = ?
    `, [fullName(firstName, lastName), firstName, lastName, phone, shopName, logo, username, email, current.id]);

    const updated = await loadUser(current.id);
    res.json({ user: setSessionUser(req, updated), message: 'Profil enregistré avec succès.' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Email ou identifiant déjà utilisé.' });
    }
    throw error;
  }
}));

app.put('/api/settings/google', requireAdmin, asyncRoute(async (req, res) => {
  const clientId = String(req.body?.clientId || '').trim();
  await setSetting('google_client_id', clientId);
  res.json({ clientId, message: clientId ? 'Connexion Google activée.' : 'ID Google retiré.' });
}));

// =====================================================================
// RAYONS & CATÉGORIES
// =====================================================================

app.get('/api/catalog/families', requireAuth, asyncRoute(async (req, res) => {
  const sessionUser = getSessionUser(req);
  const sellerId = sessionUser.role === 'admin' && validId(req.query.seller_id)
    ? Number(req.query.seller_id)
    : (sessionUser.role === 'admin' ? null : sessionUser.id);
  let query = `
    SELECT c.family, COUNT(DISTINCT c.id) AS category_count,
      COUNT(DISTINCT p.id) AS product_count, COALESCE(SUM(p.quantity), 0) AS stock_count
    FROM categories c
    LEFT JOIN products p ON p.category = c.name AND p.user_id = c.user_id
  `;
  const params = [];
  if (sellerId) {
    query += ' WHERE c.user_id = ?';
    params.push(sellerId);
  } else if (sessionUser.role !== 'admin') {
    query += ' WHERE c.user_id = ? OR c.user_id IS NULL';
    params.push(sessionUser.id);
  }
  query += ' GROUP BY c.family ORDER BY c.family ASC';
  const [rows] = await pool.query(query, params);
  res.json(numericRows(rows, ['category_count', 'product_count', 'stock_count']).map((row) => ({
    id: row.family,
    label: row.family,
    hint: `${row.category_count} catégorie${row.category_count === 1 ? '' : 's'}`,
    product_count: row.product_count,
    stock_count: row.stock_count,
  })));
}));

app.get('/api/categories', requireAuth, asyncRoute(async (req, res) => {
  const { family } = req.query;
  const sessionUser = getSessionUser(req);
  const conditions = [];
  const params = [];
  if (sessionUser.role !== 'admin') {
    conditions.push('(user_id = ? OR user_id IS NULL)');
    params.push(sessionUser.id);
  }
  if (family) {
    conditions.push('family = ?');
    params.push(String(family));
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [rows] = await pool.query(`SELECT * FROM categories ${where} ORDER BY family ASC, name ASC`, params);
  res.json(rows);
}));

app.post('/api/categories', requireAuth, asyncRoute(async (req, res) => {
  const label = String(req.body?.name || '').trim();
  const family = String(req.body?.family || '').trim();
  if (!label || !family) return res.status(400).json({ error: 'Le nom et le rayon de la catégorie sont obligatoires.' });
  if (label.length > 191 || family.length > 191) {
    return res.status(400).json({ error: 'Le nom et le rayon sont limités à 191 caractères.' });
  }

  try {
    const [result] = await pool.query('INSERT INTO categories (name, family, user_id) VALUES (?, ?, ?)', [
      label,
      family,
      getSessionUser(req).id,
    ]);
    const [inserted] = await pool.query('SELECT * FROM categories WHERE id = ?', [result.insertId]);
    res.status(201).json({ category: inserted[0], message: 'Catégorie créée avec succès.' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Cette catégorie existe déjà dans votre boutique.' });
    throw error;
  }
}));

app.put('/api/categories/:id', requireAuth, asyncRoute(async (req, res) => {
  const label = String(req.body?.name || '').trim();
  const family = String(req.body?.family || '').trim();
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
  if (!label || !family) return res.status(400).json({ error: 'Le nom et le rayon de la catégorie sont obligatoires.' });
  if (label.length > 191 || family.length > 191) {
    return res.status(400).json({ error: 'Le nom et le rayon sont limités à 191 caractères.' });
  }

  const sessionUser = getSessionUser(req);
  const ownerCondition = sessionUser.role === 'admin' ? '' : ' AND user_id = ?';
  const params = [label, family, Number(req.params.id)];
  if (sessionUser.role !== 'admin') params.push(sessionUser.id);
  try {
    const [result] = await pool.query(
      `UPDATE categories SET name = ?, family = ? WHERE id = ?${ownerCondition}`,
      params,
    );
    if (!result.affectedRows) {
      const [same] = await pool.query(
        `SELECT id FROM categories WHERE id = ?${ownerCondition}`,
        sessionUser.role === 'admin' ? [Number(req.params.id)] : [Number(req.params.id), sessionUser.id],
      );
      if (!same.length) return res.status(404).json({ error: 'Catégorie introuvable.' });
    }
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Cette catégorie existe déjà dans votre boutique.' });
    throw error;
  }
  const [rows] = await pool.query('SELECT * FROM categories WHERE id = ?', [Number(req.params.id)]);
  if (!rows.length) return res.status(404).json({ error: 'Catégorie introuvable.' });
  res.json({ category: rows[0], message: 'Catégorie mise à jour.' });
}));

app.delete('/api/categories/:id', requireAuth, asyncRoute(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
  const sessionUser = getSessionUser(req);
  const ownerCondition = sessionUser.role === 'admin' ? '' : ' AND user_id = ?';
  const params = sessionUser.role === 'admin' ? [Number(req.params.id)] : [Number(req.params.id), sessionUser.id];
  const [resDel] = await pool.query(`DELETE FROM categories WHERE id = ?${ownerCondition}`, params);
  if (!resDel.affectedRows) return res.status(404).json({ error: 'Catégorie introuvable.' });
  res.json({ message: 'Catégorie supprimée.' });
}));

// =====================================================================
// GESTION DU STOCK PRODUITS (MULTI-UTILISATEURS & ADMIN)
// =====================================================================

const mapProduct = (product) => ({
  ...product,
  profit_unit: Number(product.price_sale) - Number(product.price_buy),
  status: product.quantity <= 0 ? 'Rupture' : product.quantity <= product.threshold ? 'Stock faible' : 'Disponible',
});

app.get('/api/products', requireAuth, asyncRoute(async (req, res) => {
  const sessionUser = getSessionUser(req);
  const { search, category, family, brand, stockStatus, minPrice, maxPrice, seller_id } = req.query;

  const conditions = [];
  const params = [];

  // Filtrage par utilisateur : les vendeurs ne voient QUE leur stock, l'admin peut tout voir ou filtrer par vendeur
  if (sessionUser.role !== 'admin') {
    conditions.push('p.user_id = ?');
    params.push(sessionUser.id);
  } else if (seller_id && validId(seller_id)) {
    conditions.push('p.user_id = ?');
    params.push(Number(seller_id));
  }

  if (search) {
    const term = `%${String(search).trim().toLowerCase().replace(/[%_]/g, '')}%`;
    conditions.push(`(
      LOWER(p.name) LIKE ? OR 
      LOWER(p.category) LIKE ? OR 
      LOWER(p.brand) LIKE ? OR 
      LOWER(p.model) LIKE ? OR 
      LOWER(COALESCE(p.reference, '')) LIKE ? OR 
      LOWER(COALESCE(p.description, '')) LIKE ? OR 
      LOWER(COALESCE(p.compatible_models, '')) LIKE ?
    )`);
    for (let i = 0; i < 7; i++) params.push(term);
  }

  if (category) {
    conditions.push('p.category = ?');
    params.push(category);
  }
  if (family) {
    conditions.push('c.family = ?');
    params.push(family);
  }
  if (brand) {
    conditions.push('p.brand = ?');
    params.push(brand);
  }
  if (stockStatus === 'low') conditions.push('p.quantity > 0 AND p.quantity <= p.threshold');
  if (stockStatus === 'out') conditions.push('p.quantity <= 0');
  if (stockStatus === 'available') conditions.push('p.quantity > p.threshold');
  if (minPrice && Number.isFinite(Number(minPrice))) {
    conditions.push('p.price_sale >= ?');
    params.push(Number(minPrice));
  }
  if (maxPrice && Number.isFinite(Number(maxPrice))) {
    conditions.push('p.price_sale <= ?');
    params.push(Number(maxPrice));
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [products] = await pool.query(`
    SELECT p.*, c.family AS category_family,
           u.shop_name AS seller_shop, u.name AS seller_name, u.username AS seller_username
    FROM products p
    LEFT JOIN categories c ON c.name = p.category AND (c.user_id = p.user_id OR c.user_id IS NULL)
    LEFT JOIN users u ON u.id = p.user_id
    ${whereClause}
    ORDER BY p.category ASC, p.name ASC
  `, params);

  res.json(products.map(mapProduct));
}));

app.get('/api/products/:id', requireAuth, asyncRoute(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
  const sessionUser = getSessionUser(req);
  const prodId = Number(req.params.id);

  let query = 'SELECT p.*, u.shop_name AS seller_shop, u.name AS seller_name FROM products p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ?';
  const params = [prodId];

  if (sessionUser.role !== 'admin') {
    query += ' AND p.user_id = ?';
    params.push(sessionUser.id);
  }

  const [rows] = await pool.query(query, params);
  if (!rows.length) return res.status(404).json({ error: 'Produit introuvable.' });
  res.json(mapProduct(rows[0]));
}));

const readProductInput = (body) => ({
  name: String(body.name || '').trim(),
  category: String(body.category || '').trim(),
  brand: String(body.brand || '').trim(),
  model: String(body.model || '').trim(),
  reference: String(body.reference || '').trim(),
  quantity: Number(body.quantity || 0),
  price_buy: Number(body.price_buy || 0),
  price_sale: Number(body.price_sale || 0),
  threshold: Number(body.threshold || 0),
  location: String(body.location || '').trim(),
  description: String(body.description || '').trim(),
  compatible_models: String(body.compatible_models || '').trim(),
});

const categoryBelongsToUser = async (categoryName, userId) => {
  const [rows] = await pool.query(
    'SELECT id FROM categories WHERE name = ? AND (user_id = ? OR user_id IS NULL) LIMIT 1',
    [categoryName, userId],
  );
  return rows.length > 0;
};

app.post('/api/products', requireAuth, asyncRoute(async (req, res) => {
  const sessionUser = getSessionUser(req);
  const p = readProductInput(req.body || {});

  if (!p.name || !p.category || !p.brand || !p.model) {
    return res.status(400).json({ error: 'Nom, catégorie, marque et modèle sont obligatoires.' });
  }
  if (![p.quantity, p.threshold, p.price_buy, p.price_sale].every(validNonNegativeInt)) {
    return res.status(400).json({ error: 'Quantité, seuil et prix doivent être des entiers positifs ou nuls.' });
  }
  if (!validText(p.name, 255) || !validText(p.category, 191) || !validText(p.brand, 191)
    || !validText(p.model, 191) || !validText(p.reference, 191) || !validText(p.location, 255)) {
    return res.status(400).json({ error: 'Un ou plusieurs champs dépassent la longueur maximale autorisée.' });
  }

  // Déterminer le user_id cible (admin peut assigner à un vendeur spécifique)
  let targetUserId = sessionUser.id;
  if (sessionUser.role === 'admin' && req.body?.user_id && validId(req.body.user_id)) {
    targetUserId = Number(req.body.user_id);
    const target = await loadUser(targetUserId);
    if (!target || target.status !== 'active') {
      return res.status(400).json({ error: 'La boutique destinataire est introuvable ou inactive.' });
    }
  }
  if (!await categoryBelongsToUser(p.category, targetUserId)) {
    return res.status(400).json({ error: 'Choisissez une catégorie créée dans votre boutique.' });
  }

  const created = await withTransaction(async (conn) => {
    const [result] = await conn.query(`
      INSERT INTO products (
        user_id, name, category, brand, model, reference, quantity,
        price_buy, price_sale, threshold, location, description, compatible_models
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      targetUserId,
      p.name,
      p.category,
      p.brand,
      p.model,
      p.reference || null,
      p.quantity,
      p.price_buy,
      p.price_sale,
      p.threshold,
      p.location,
      p.description,
      p.compatible_models,
    ]);

    const newId = result.insertId;
    await conn.query(`
      INSERT INTO stock_movements (user_id, product_id, type, quantity, note)
      VALUES (?, ?, 'entry', ?, 'Création initiale du produit')
    `, [targetUserId, newId, p.quantity]);

    await logActivity(conn, {
      userId: targetUserId,
      userName: sessionUser.name,
      action: 'PRODUCT_CREATE',
      entityType: 'product',
      entityId: newId,
      description: `Ajout du produit "${p.name}" (${p.brand} ${p.model}) - Stock: ${p.quantity}, Prix: ${p.price_sale} FCFA`,
    });

    const [rows] = await conn.query('SELECT * FROM products WHERE id = ?', [newId]);
    return rows[0];
  });

  res.status(201).json({ product: mapProduct(created), message: 'Produit ajouté avec succès.' });
}));

app.put('/api/products/:id', requireAuth, asyncRoute(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
  const sessionUser = getSessionUser(req);
  const prodId = Number(req.params.id);
  const p = readProductInput(req.body || {});

  // Vérifier propriété si pas admin
  const [existing] = await pool.query('SELECT * FROM products WHERE id = ?', [prodId]);
  if (!existing.length) return res.status(404).json({ error: 'Produit introuvable.' });

  if (sessionUser.role !== 'admin' && existing[0].user_id !== sessionUser.id) {
    return res.status(403).json({ error: 'Vous n’êtes pas autorisé à modifier ce produit.' });
  }
  if (!p.name || !p.category || !p.brand || !p.model) {
    return res.status(400).json({ error: 'Nom, catégorie, marque et modèle sont obligatoires.' });
  }
  if (![p.quantity, p.threshold, p.price_buy, p.price_sale].every(validNonNegativeInt)) {
    return res.status(400).json({ error: 'Quantité, seuil et prix doivent être des entiers positifs ou nuls.' });
  }
  if (!validText(p.name, 255) || !validText(p.category, 191) || !validText(p.brand, 191)
    || !validText(p.model, 191) || !validText(p.reference, 191) || !validText(p.location, 255)) {
    return res.status(400).json({ error: 'Un ou plusieurs champs dépassent la longueur maximale autorisée.' });
  }
  if (!await categoryBelongsToUser(p.category, Number(existing[0].user_id))) {
    return res.status(400).json({ error: 'Choisissez une catégorie créée dans la boutique propriétaire du produit.' });
  }

  await pool.query(`
    UPDATE products SET
      name = ?, category = ?, brand = ?, model = ?, reference = ?,
      quantity = ?, price_buy = ?, price_sale = ?, threshold = ?,
      location = ?, description = ?, compatible_models = ?
    WHERE id = ?
  `, [
    p.name,
    p.category,
    p.brand,
    p.model,
    p.reference || null,
    p.quantity,
    p.price_buy,
    p.price_sale,
    p.threshold,
    p.location,
    p.description,
    p.compatible_models,
    prodId,
  ]);

  await logActivity(pool, {
    userId: sessionUser.id,
    userName: sessionUser.name,
    action: 'PRODUCT_UPDATE',
    entityType: 'product',
    entityId: prodId,
    description: `Mise à jour du produit "${p.name}" - Stock: ${p.quantity}, Prix vente: ${p.price_sale} FCFA`,
  });

  const [updated] = await pool.query('SELECT * FROM products WHERE id = ?', [prodId]);
  res.json({ product: mapProduct(updated[0]), message: 'Produit mis à jour.' });
}));

app.post('/api/products/:id/add-stock', requireAuth, asyncRoute(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
  const sessionUser = getSessionUser(req);
  const prodId = Number(req.params.id);
  const quantity = Number(req.body?.quantity || 0);
  const note = String(req.body?.note || 'Réception').trim() || 'Réception';

  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'La quantité doit être un nombre entier supérieur à 0.' });
  }

  const [existing] = await pool.query('SELECT * FROM products WHERE id = ?', [prodId]);
  if (!existing.length) return res.status(404).json({ error: 'Produit introuvable.' });

  if (sessionUser.role !== 'admin' && existing[0].user_id !== sessionUser.id) {
    return res.status(403).json({ error: 'Accès non autorisé.' });
  }

  const updated = await withTransaction(async (conn) => {
    await conn.query('UPDATE products SET quantity = quantity + ? WHERE id = ?', [quantity, prodId]);
    await conn.query(`
      INSERT INTO stock_movements (user_id, product_id, type, quantity, note)
      VALUES (?, ?, 'entry', ?, ?)
    `, [existing[0].user_id, prodId, quantity, note]);

    await logActivity(conn, {
      userId: sessionUser.id,
      userName: sessionUser.name,
      action: 'STOCK_ENTRY',
      entityType: 'product',
      entityId: prodId,
      description: `Réception de +${quantity} pièces pour "${existing[0].name}" (${note})`,
    });

    const [rows] = await conn.query('SELECT * FROM products WHERE id = ?', [prodId]);
    return rows[0];
  });

  res.json({ product: mapProduct(updated), message: 'Stock approvisionné avec succès.' });
}));

app.delete('/api/products/:id', requireAuth, asyncRoute(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
  const sessionUser = getSessionUser(req);
  const prodId = Number(req.params.id);

  const [existing] = await pool.query('SELECT * FROM products WHERE id = ?', [prodId]);
  if (!existing.length) return res.status(404).json({ error: 'Produit introuvable.' });

  if (sessionUser.role !== 'admin' && existing[0].user_id !== sessionUser.id) {
    return res.status(403).json({ error: 'Vous ne pouvez pas supprimer un produit qui ne vous appartient pas.' });
  }

  await logActivity(pool, {
    userId: sessionUser.id,
    userName: sessionUser.name,
    action: 'PRODUCT_DELETE',
    entityType: 'product',
    entityId: prodId,
    description: `Suppression du produit "${existing[0].name}"`,
  });

  await pool.query('DELETE FROM products WHERE id = ?', [prodId]);
  res.json({ message: 'Produit retiré du stock avec succès.' });
}));

// =====================================================================
// CAISSE & ENREGISTREMENT DES VENTES
// =====================================================================

app.post('/api/sales', requireAuth, asyncRoute(async (req, res) => {
  const sessionUser = getSessionUser(req);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: 'Aucun article sélectionné dans le panier.' });
  if (items.length > 300) return res.status(400).json({ error: 'Panier trop volumineux : 300 lignes maximum par ticket.' });

  const paymentMethod = String(req.body?.payment_method || 'cash')
    .trim()
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .slice(0, 64) || 'cash';
  const customerName = String(req.body?.customer_name || '')
    .trim()
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .slice(0, 191);

  try {
    const saleResult = await withTransaction(async (conn) => {
      // 1. Créer le ticket de vente lié au vendeur connecté
      const [saleInsert] = await conn.query(
        'INSERT INTO sales (user_id, total_amount, total_profit, items_count, customer_name, payment_method) VALUES (?, 0, 0, 0, ?, ?)',
        [sessionUser.id, customerName || null, paymentMethod],
      );
      const saleId = saleInsert.insertId;

      let totalAmount = 0;
      let totalProfit = 0;
      let itemsCount = 0;

      for (const item of items) {
        if (!validId(item?.id)) throw new Error('Identifiant article invalide.');
        const [prodRows] = await conn.query('SELECT * FROM products WHERE id = ? FOR UPDATE', [Number(item.id)]);
        const product = prodRows[0];
        if (!product) throw new Error(`Article introuvable : ${item.id}`);

        // Vérifier que le vendeur vend bien ses propres produits
        if (sessionUser.role !== 'admin' && product.user_id !== sessionUser.id) {
          throw new Error(`Vous ne pouvez vendre que vos propres articles (${product.name}).`);
        }

        const qty = Number(item.quantity || 0);
        if (!Number.isSafeInteger(qty) || qty <= 0 || qty > product.quantity) {
          throw new Error(`Stock insuffisant pour ${product.name} (disponible : ${product.quantity}).`);
        }

        const unitProfit = Number(product.price_sale) - Number(product.price_buy);
        const subtotal = Number(product.price_sale) * qty;
        const profit = unitProfit * qty;

        await conn.query(`
          INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal, profit)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [saleId, product.id, qty, product.price_sale, subtotal, profit]);

        await conn.query('UPDATE products SET quantity = quantity - ? WHERE id = ?', [qty, product.id]);

        await conn.query(`
          INSERT INTO stock_movements (user_id, product_id, type, quantity, note)
          VALUES (?, ?, 'sale', ?, 'Vente caisse ticket #${saleId}')
        `, [sessionUser.id, product.id, qty]);

        totalAmount += subtotal;
        totalProfit += profit;
        itemsCount += qty;
      }

      await conn.query(
        'UPDATE sales SET total_amount = ?, total_profit = ?, items_count = ? WHERE id = ?',
        [totalAmount, totalProfit, itemsCount, saleId],
      );

      await logActivity(conn, {
        userId: sessionUser.id,
        userName: sessionUser.name,
        action: 'SALE_COMPLETED',
        entityType: 'sale',
        entityId: saleId,
        description: `Vente caisse validée : ${itemsCount} article(s), total ${totalAmount} FCFA, marge ${totalProfit} FCFA`,
      });

      const [finalSale] = await conn.query('SELECT * FROM sales WHERE id = ?', [saleId]);
      return finalSale[0];
    });

    res.status(201).json({ sale: saleResult, message: 'Vente validée et encaissée avec succès.' });
  } catch (error) {
    if (error.message.startsWith('Stock insuffisant') || error.message.startsWith('Article introuvable') || error.message.includes('propres articles')) {
      return res.status(400).json({ error: error.message });
    }
    throw error;
  }
}));

app.get('/api/sales', requireAuth, asyncRoute(async (req, res) => {
  const sessionUser = getSessionUser(req);
  const { range, product, category, date, seller_id } = req.query;

  const filters = [];
  const params = [];

  // Isolation par utilisateur
  if (sessionUser.role !== 'admin') {
    filters.push('s.user_id = ?');
    params.push(sessionUser.id);
  } else if (seller_id && validId(seller_id)) {
    filters.push('s.user_id = ?');
    params.push(Number(seller_id));
  }

  if (product) {
    filters.push('LOWER(p.name) LIKE ?');
    params.push(`%${String(product).trim().toLowerCase().replace(/[%_]/g, '')}%`);
  }
  if (category) {
    filters.push('LOWER(p.category) LIKE ?');
    params.push(`%${String(category).trim().toLowerCase().replace(/[%_]/g, '')}%`);
  }
  if (date) {
    filters.push('DATE(s.sale_date) = ?');
    params.push(date);
  }

  if (range === 'today') filters.push('DATE(s.sale_date) = CURDATE()');
  else if (range === 'yesterday') filters.push('DATE(s.sale_date) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)');
  else if (range === 'week') filters.push('DATE(s.sale_date) >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)');
  else if (range === 'month') filters.push('DATE(s.sale_date) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)');

  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const [rows] = await pool.query(`
    SELECT s.*, si.product_id, si.quantity, si.unit_price, si.subtotal, si.profit,
           p.name AS product_name, p.category AS product_category,
           u.shop_name AS seller_shop, u.name AS seller_name
    FROM sales s
    LEFT JOIN users u ON u.id = s.user_id
    LEFT JOIN sale_items si ON si.sale_id = s.id
    LEFT JOIN products p ON p.id = si.product_id
    ${whereClause}
    ORDER BY s.sale_date DESC
  `, params);

  const sales = [];
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.id)) {
      const saleObj = {
        id: row.id,
        user_id: row.user_id,
        seller_shop: row.seller_shop,
        seller_name: row.seller_name,
        sale_date: row.sale_date,
        total_amount: Number(row.total_amount),
        total_profit: Number(row.total_profit),
        items_count: Number(row.items_count),
        payment_method: row.payment_method,
        customer_name: row.customer_name || '',
        items: [],
      };
      map.set(row.id, saleObj);
      sales.push(saleObj);
    }
    if (row.product_id) {
      map.get(row.id).items.push({
        product_id: row.product_id,
        product_name: row.product_name,
        product_category: row.product_category,
        quantity: Number(row.quantity),
        unit_price: Number(row.unit_price),
        subtotal: Number(row.subtotal),
        profit: Number(row.profit),
      });
    }
  }

  res.json(sales);
}));

// =====================================================================
// TABLEAU DE BORD & STATISTIQUES (MULTI-TENANT & VUE ADMIN)
// =====================================================================

app.get('/api/dashboard', requireAuth, asyncRoute(async (req, res) => {
  const sessionUser = getSessionUser(req);
  const sellerId = sessionUser.role === 'admin' && validId(req.query.seller_id)
    ? Number(req.query.seller_id)
    : (sessionUser.role === 'admin' ? null : sessionUser.id);

  const whereUserProd = sellerId ? 'WHERE user_id = ?' : '';
  const whereUserSale = sellerId ? 'WHERE user_id = ?' : '';
  const whereUserSaleDate = sellerId ? 'WHERE user_id = ? AND DATE(sale_date) = CURDATE()' : 'WHERE DATE(sale_date) = CURDATE()';
  const paramUser = sellerId ? [sellerId] : [];

  const [
    [todaySales],
    [totalProducts],
    [totalStock],
    [estimatedProfit],
    lowStockProducts,
    topProducts,
    salesTrend,
    familyStock,
  ] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(total_amount), 0) AS total_amount, COALESCE(SUM(items_count), 0) AS items_count, COALESCE(SUM(total_profit), 0) AS total_profit FROM sales ${whereUserSaleDate}`, paramUser),
    pool.query(`SELECT COUNT(*) AS total FROM products ${whereUserProd}`, paramUser),
    pool.query(`SELECT COALESCE(SUM(quantity), 0) AS total FROM products ${whereUserProd}`, paramUser),
    pool.query(`SELECT COALESCE(SUM((price_sale - price_buy) * quantity), 0) AS total FROM products ${whereUserProd}`, paramUser),
    pool.query(`SELECT * FROM products ${sellerId ? 'WHERE user_id = ? AND' : 'WHERE'} quantity <= threshold ORDER BY quantity ASC LIMIT 8`, paramUser),
    pool.query(`
      SELECT p.name, p.category, COALESCE(SUM(si.quantity), 0) AS sold
      FROM products p
      LEFT JOIN sale_items si ON si.product_id = p.id
      ${sellerId ? 'WHERE p.user_id = ?' : ''}
      GROUP BY p.id, p.name, p.category ORDER BY sold DESC LIMIT 5
    `, paramUser),
    pool.query(`
      SELECT DATE_FORMAT(sale_date, '%d') AS day, SUM(total_amount) AS total_amount
      FROM sales
      ${sellerId ? 'WHERE user_id = ? AND' : 'WHERE'} sale_date >= DATE_SUB(NOW(), INTERVAL 6 DAY)
      GROUP BY DATE(sale_date), DATE_FORMAT(sale_date, '%d') ORDER BY DATE(sale_date) ASC
    `, paramUser),
    pool.query(`
      SELECT c.family, COALESCE(SUM(p.quantity), 0) AS stock
      FROM categories c
      LEFT JOIN products p ON p.category = c.name ${sellerId ? 'AND p.user_id = ?' : ''}
      GROUP BY c.family
    `, paramUser),
  ]);

  res.json({
    todaySales: todaySales[0],
    totalProducts: numericRow(totalProducts[0], ['total']),
    totalStock: numericRow(totalStock[0], ['total']),
    estimatedProfit: Number(estimatedProfit[0]?.total || 0),
    lowStockProducts: lowStockProducts[0],
    topProducts: numericRows(topProducts[0], ['sold']),
    salesTrend: numericRows(salesTrend[0], ['total_amount']),
    familyStock: numericRows(familyStock[0], ['stock']),
    currency: 'FCFA',
  });
}));

app.get('/api/stats', requireAuth, asyncRoute(async (req, res) => {
  const sessionUser = getSessionUser(req);
  const sellerId = sessionUser.role === 'admin' && validId(req.query.seller_id)
    ? Number(req.query.seller_id)
    : (sessionUser.role === 'admin' ? null : sessionUser.id);

  const range = req.query.range || 'today';
  let dateClause = 'DATE(sale_date) = CURDATE()';
  if (range === 'week') dateClause = 'DATE(sale_date) >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)';
  else if (range === 'month') dateClause = 'DATE(sale_date) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)';
  else if (range === 'year') dateClause = 'DATE(sale_date) >= DATE_SUB(CURDATE(), INTERVAL 365 DAY)';

  const whereSale = sellerId ? `WHERE user_id = ? AND ${dateClause}` : `WHERE ${dateClause}`;
  const whereJoinSale = sellerId ? `WHERE s.user_id = ? AND ${dateClause.replaceAll('sale_date', 's.sale_date')}` : `WHERE ${dateClause.replaceAll('sale_date', 's.sale_date')}`;
  const param = sellerId ? [sellerId] : [];

  const [[statsRows], [topProductRows], [topCategoryRows], [trendRows]] = await Promise.all([
    pool.query(`
      SELECT COALESCE(SUM(total_amount), 0) AS revenue,
             COALESCE(SUM(total_profit), 0) AS profit,
             COUNT(*) AS sales_count,
             COALESCE(SUM(items_count), 0) AS items_sold
      FROM sales ${whereSale}
    `, param),
    pool.query(`
      SELECT p.name, SUM(si.quantity) AS total_quantity
      FROM sale_items si
      JOIN products p ON p.id = si.product_id
      JOIN sales s ON s.id = si.sale_id
      ${whereJoinSale}
      GROUP BY p.id, p.name ORDER BY total_quantity DESC LIMIT 1
    `, param),
    pool.query(`
      SELECT p.category AS name, SUM(si.quantity) AS total_quantity
      FROM sale_items si
      JOIN products p ON p.id = si.product_id
      JOIN sales s ON s.id = si.sale_id
      ${whereJoinSale}
      GROUP BY p.category ORDER BY total_quantity DESC LIMIT 1
    `, param),
    pool.query(`
      SELECT DATE_FORMAT(sale_date, '%d') AS label, SUM(total_amount) AS total_amount
      FROM sales ${whereSale}
      GROUP BY DATE(sale_date), DATE_FORMAT(sale_date, '%d') ORDER BY DATE(sale_date) ASC
    `, param),
  ]);

  res.json({
    stats: numericRow(statsRows[0], ['revenue', 'profit', 'sales_count', 'items_sold']),
    topProduct: topProductRows[0] ? numericRow(topProductRows[0], ['total_quantity']) : null,
    topCategory: topCategoryRows[0] ? numericRow(topCategoryRows[0], ['total_quantity']) : null,
    trend: numericRows(trendRows, ['total_amount']),
  });
}));

// =====================================================================
// RAPPORT MENSUEL
// =====================================================================

const monthBounds = (monthStr) => {
  const match = String(monthStr || '').match(/^(\d{4})-(\d{2})$/);
  const now = new Date();
  const year = match ? Number(match[1]) : now.getFullYear();
  const mon = match ? Number(match[2]) : now.getMonth() + 1;
  const start = `${year}-${String(mon).padStart(2, '0')}-01`;
  const prevMonth = mon === 1 ? 12 : mon - 1;
  const prevYear = mon === 1 ? year - 1 : year;
  const prevStart = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
  return { year, month: mon, start, prevStart, key: `${year}-${String(mon).padStart(2, '0')}` };
};

const getMonthStats = async (start, endExclusive, sellerId) => {
  const whereUser = sellerId ? 'AND s.user_id = ?' : '';
  const params = sellerId ? [start, endExclusive, sellerId] : [start, endExclusive];

  const [[statsRows]] = await pool.query(`
    SELECT COALESCE(SUM(total_amount), 0) AS revenue,
           COALESCE(SUM(total_profit), 0) AS profit,
           COUNT(*) AS sales_count,
           COALESCE(SUM(items_count), 0) AS items_sold
    FROM sales s WHERE s.sale_date >= ? AND s.sale_date < ? ${whereUser}
  `, params);

  const [topProducts] = await pool.query(`
    SELECT p.name, p.category, SUM(si.quantity) AS total_quantity, SUM(si.subtotal) AS total_amount
    FROM sale_items si
    JOIN products p ON p.id = si.product_id
    JOIN sales s ON s.id = si.sale_id
    WHERE s.sale_date >= ? AND s.sale_date < ? ${whereUser}
    GROUP BY p.id, p.name, p.category ORDER BY total_quantity DESC LIMIT 5
  `, params);

  const [topCategories] = await pool.query(`
    SELECT p.category AS name, SUM(si.quantity) AS total_quantity, SUM(si.subtotal) AS total_amount
    FROM sale_items si
    JOIN products p ON p.id = si.product_id
    JOIN sales s ON s.id = si.sale_id
    WHERE s.sale_date >= ? AND s.sale_date < ? ${whereUser}
    GROUP BY p.category ORDER BY total_quantity DESC LIMIT 5
  `, params);

  const [daily] = await pool.query(`
    SELECT DATE_FORMAT(sale_date, '%d') AS label, SUM(total_amount) AS total_amount
    FROM sales s
    WHERE s.sale_date >= ? AND s.sale_date < ? ${whereUser}
    GROUP BY DATE(sale_date), DATE_FORMAT(sale_date, '%d') ORDER BY DATE(sale_date) ASC
  `, params);

  return {
    ...numericRow(statsRows[0], ['revenue', 'profit', 'sales_count', 'items_sold']),
    topProduct: topProducts[0] ? numericRow(topProducts[0], ['total_quantity', 'total_amount']) : null,
    topCategory: topCategories[0] ? numericRow(topCategories[0], ['total_quantity', 'total_amount']) : null,
    topProducts: numericRows(topProducts, ['total_quantity', 'total_amount']),
    topCategories: numericRows(topCategories, ['total_quantity', 'total_amount']),
    daily: numericRows(daily, ['total_amount']),
  };
};

app.get('/api/reports/monthly', requireAuth, asyncRoute(async (req, res) => {
  const sessionUser = getSessionUser(req);
  const requestedSeller = sessionUser.role === 'admin' && validId(req.query.seller_id)
    ? Number(req.query.seller_id)
    : null;
  const targetUserId = requestedSeller ?? sessionUser.id;
  const seller = publicUser(await loadUser(targetUserId));
  if (!seller) return res.status(404).json({ error: 'Vendeur introuvable.' });

  const bounds = monthBounds(req.query.month);
  const nextMonth = bounds.month === 12 ? 1 : bounds.month + 1;
  const nextYear = bounds.month === 12 ? bounds.year + 1 : bounds.year;
  const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  const [current, previous, [lowStockRows]] = await Promise.all([
    getMonthStats(bounds.start, end, targetUserId),
    getMonthStats(bounds.prevStart, bounds.start, targetUserId),
    pool.query('SELECT id, name, quantity, threshold FROM products WHERE user_id = ? AND quantity <= threshold ORDER BY quantity ASC LIMIT 8', [targetUserId]),
  ]);

  const monthLabel = new Date(`${bounds.key}-01T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const analysis = buildMonthlyAnalysis({
    seller,
    monthLabel,
    current: { ...current, lowStock: lowStockRows },
    previous,
  });

  res.json({
    seller,
    month: bounds.key,
    monthLabel,
    current: { ...current, lowStock: lowStockRows },
    previous,
    analysis,
  });
}));

// Mouvements de stock
app.get('/api/stock-movements', requireAuth, asyncRoute(async (req, res) => {
  const sessionUser = getSessionUser(req);
  const targetUserId = sessionUser.role === 'admin'
    ? (validId(req.query.seller_id) ? Number(req.query.seller_id) : null)
    : sessionUser.id;

  const query = targetUserId
    ? `
      SELECT sm.*, p.name AS product_name
      FROM stock_movements sm
      JOIN products p ON p.id = sm.product_id
      WHERE sm.user_id = ?
      ORDER BY sm.created_at DESC LIMIT 50
    `
    : `
      SELECT sm.*, p.name AS product_name, u.shop_name, u.name AS user_name
      FROM stock_movements sm
      JOIN products p ON p.id = sm.product_id
      JOIN users u ON u.id = sm.user_id
      ORDER BY sm.created_at DESC LIMIT 50
    `;

  const [rows] = await pool.query(query, targetUserId ? [targetUserId] : []);
  res.json(rows);
}));

// 404 JSON pour toute route /api inconnue
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Route API introuvable.' });
});

// Gestion globale des erreurs
app.use((error, _req, res, _next) => {
  console.error(`[API Error] ${error.message}`);
  if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Cet élément existe déjà dans la base de données.' });
  if (error.code === 'ER_ROW_IS_REFERENCED_2' || /FOREIGN KEY constraint failed/i.test(error.message || '')) {
    return res.status(409).json({ error: 'Cette donnée est utilisée par d’autres éléments.' });
  }
  // Erreurs de lecture du corps de requête (JSON invalide, corps trop volumineux)
  if (error.status && error.status < 500) {
    const message = error.type === 'entity.too.large'
      ? 'Requête trop volumineuse.'
      : 'Requête invalide.';
    return res.status(error.status).json({ error: message });
  }
  // Ne jamais exposer les détails internes (SQL, chemins, variables) en production.
  const isProduction = process.env.NODE_ENV === 'production';
  return res.status(500).json({
    error: isProduction || !error.message
      ? 'Une erreur serveur inattendue est survenue.'
      : error.message,
  });
});

export const closeSessionStore = async () => {
  await sessionStore.close();
  closeDatabase();
};

export { app, pool };
