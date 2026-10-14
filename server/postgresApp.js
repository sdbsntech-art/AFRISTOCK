import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import crypto from 'node:crypto';
import pg from 'pg';
import connectPgSimple from 'connect-pg-simple';
import { CATEGORY_FAMILIES } from '../database/catalog.js';
import { DEFAULT_SHOP_NAME, fullName, publicUser } from './userProfile.js';
import { buildMonthlyAnalysis } from './reportEngine.js';

const { Pool } = pg;
const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error('SUPABASE_DB_URL doit contenir la chaîne de connexion PostgreSQL Supabase.');
const parsedDatabaseUrl = new URL(connectionString);
if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)) {
  throw new Error('SUPABASE_DB_URL doit être une chaîne de connexion PostgreSQL.');
}

const pool = new Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 10000,
});
pool.on('error', (error) => console.error(`[PostgreSQL] Erreur de connexion inactive : ${error.message}`));

const sessionSecret = process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production'
  ? null
  : crypto.randomBytes(32).toString('hex'));
if (!sessionSecret) throw new Error('SESSION_SECRET doit être défini sur Vercel.');

const app = express();
const PgSession = connectPgSimple(session);
const sessionStore = new PgSession({
  pool,
  schemaName: 'public',
  tableName: 'user_sessions',
  createTableIfMissing: false,
});

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.get('origin');
    const allowed = new Set([process.env.APP_ORIGIN, 'http://localhost:4173', 'http://127.0.0.1:4173'].filter(Boolean));
    if (origin && !allowed.has(origin)) return res.status(403).json({ error: 'Origine de la requête refusée.' });
    if (req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'Requête intersite refusée.' });
  }
  next();
});
app.use(express.json({ limit: '3mb' }));
app.use(session({
  name: 'afristock.sid',
  store: sessionStore,
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8,
  },
}));

const authAttempts = new Map();
const limitAuthAttempts = (req, res, next) => {
  const key = req.ip;
  const now = Date.now();
  const recent = (authAttempts.get(key) || []).filter((time) => now - time < 15 * 60 * 1000);
  if (recent.length >= 10) return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans 15 minutes.' });
  recent.push(now);
  authAttempts.set(key, recent);
  next();
};

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$v=1$N=32768$r=8$p=1$${salt}$${key.toString('hex')}`;
};
const verifyPassword = (password, stored) => {
  if (stored?.startsWith('scrypt:')) {
    const [, salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const actual = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
  }
  if (!stored?.startsWith('scrypt$v=1$N=32768$r=8$p=1$')) return stored === password;
  const [, , , , , salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  const actual = crypto.scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const expected = Buffer.from(hash, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
};

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const getSessionUser = (req) => req.session?.user || null;
const requireAuth = (req, res, next) => {
  if (!getSessionUser(req)) return res.status(401).json({ error: 'Non authentifié' });
  next();
};
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
const validId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const validNonNegativeInt = (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0;
const validText = (value, max = 200) => typeof value === 'string' && value.length <= max;
const validLogo = (value) => !value || /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value) || /^https:\/\/lh3\.googleusercontent\.com\//i.test(value);
const likeValue = (value = '') => `%${String(value).trim().toLowerCase()}%`;
const numericRows = (rows, fields) => rows.map((row) => Object.fromEntries(
  Object.entries(row).map(([key, value]) => [key, fields.includes(key) && value !== null ? Number(value) : value]),
));
const numericRow = (row, fields) => numericRows([row], fields)[0];
const loadUser = async (id) => (await pool.query('SELECT * FROM users WHERE id = $1', [id])).rows[0] || null;
const getSetting = async (key) => (await pool.query('SELECT value FROM app_settings WHERE key = $1', [key])).rows[0]?.value || '';
const setSetting = async (key, value) => pool.query(
  'INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
  [key, value],
);
const withTransaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
const monthBounds = (month) => {
  const match = String(month || '').match(/^(\d{4})-(\d{2})$/);
  const now = new Date();
  const year = match ? Number(match[1]) : now.getFullYear();
  const mon = match ? Number(match[2]) : now.getMonth() + 1;
  const start = `${year}-${String(mon).padStart(2, '0')}-01`;
  const prevMonth = mon === 1 ? 12 : mon - 1;
  const prevYear = mon === 1 ? year - 1 : year;
  const prevStart = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
  return { year, month: mon, start, prevStart, key: `${year}-${String(mon).padStart(2, '0')}` };
};

const monthStats = async (start, endExclusive) => {
  const stats = (await pool.query(`
    SELECT COALESCE(SUM(total_amount), 0) AS revenue,
           COALESCE(SUM(total_profit), 0) AS profit,
           COUNT(*) AS sales_count,
           COALESCE(SUM(items_count), 0) AS items_sold
    FROM sales WHERE sale_date >= $1::date AND sale_date < $2::date
  `, [start, endExclusive])).rows[0];
  const topProducts = (await pool.query(`
    SELECT p.name, p.category, SUM(si.quantity) AS total_quantity, SUM(si.subtotal) AS total_amount
    FROM sale_items si JOIN products p ON p.id = si.product_id JOIN sales s ON s.id = si.sale_id
    WHERE s.sale_date >= $1::date AND s.sale_date < $2::date
    GROUP BY p.id ORDER BY total_quantity DESC LIMIT 5
  `, [start, endExclusive])).rows;
  const topCategories = (await pool.query(`
    SELECT p.category AS name, SUM(si.quantity) AS total_quantity, SUM(si.subtotal) AS total_amount
    FROM sale_items si JOIN products p ON p.id = si.product_id JOIN sales s ON s.id = si.sale_id
    WHERE s.sale_date >= $1::date AND s.sale_date < $2::date
    GROUP BY p.category ORDER BY total_quantity DESC LIMIT 5
  `, [start, endExclusive])).rows;
  const daily = (await pool.query(`
    SELECT to_char(sale_date, 'DD') AS label, SUM(total_amount) AS total_amount
    FROM sales
    WHERE sale_date >= $1::date AND sale_date < $2::date
    GROUP BY sale_date::date ORDER BY sale_date::date ASC
  `, [start, endExclusive])).rows;
  return {
    ...numericRow(stats, ['revenue', 'profit', 'sales_count', 'items_sold']),
    topProduct: topProducts[0] ? numericRow(topProducts[0], ['total_quantity', 'total_amount']) : null,
    topCategory: topCategories[0] ? numericRow(topCategories[0], ['total_quantity', 'total_amount']) : null,
    topProducts: numericRows(topProducts, ['total_quantity', 'total_amount']),
    topCategories: numericRows(topCategories, ['total_quantity', 'total_amount']),
    daily: numericRows(daily, ['total_amount']),
  };
};

app.get('/api/auth/google-config', asyncRoute(async (_req, res) => {
  res.json({ clientId: process.env.GOOGLE_CLIENT_ID || await getSetting('google_client_id') });
}));

app.get('/api/session', asyncRoute(async (req, res) => {
  const sessionUser = getSessionUser(req);
  if (!sessionUser?.id) return res.json({ user: null });
  res.json({ user: publicUser(await loadUser(sessionUser.id) || sessionUser) });
}));

app.post('/api/login', limitAuthAttempts, asyncRoute(async (req, res, next) => {
  const identifier = String(req.body?.identifier || '').trim();
  const pass = String(req.body?.password || '');
  let user = (await pool.query('SELECT * FROM users WHERE email = $1 OR username = $2', [identifier.toLowerCase(), identifier])).rows[0];
  if (!user || !verifyPassword(pass, user.password)) return res.status(401).json({ error: 'Identifiants incorrects.' });
  if (user.password.startsWith('scrypt:')) {
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashPassword(pass), user.id]);
    user = await loadUser(user.id);
  }
  try {
    res.json({ user: await regenerateSession(req, user), message: 'Connexion réussie.' });
  } catch (error) {
    next(error);
  }
}));

app.post('/api/logout', (req, res) => {
  req.session.destroy((error) => {
    res.clearCookie('afristock.sid', { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production' });
    if (error) return res.status(500).json({ error: 'Impossible de fermer la session.' });
    res.json({ message: 'Déconnecté.' });
  });
});

app.post('/api/signup', limitAuthAttempts, asyncRoute(async (req, res, next) => {
  const firstName = String(req.body?.first_name || '').trim();
  const lastName = String(req.body?.last_name || '').trim();
  const safeName = fullName(firstName, lastName, String(req.body?.name || '').trim());
  const username = String(req.body?.username || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const phone = String(req.body?.phone || '').trim();
  const shopName = String(req.body?.shop_name || '').trim() || DEFAULT_SHOP_NAME;
  const logo = String(req.body?.logo || '').trim();

  if (!firstName || !lastName || !username || !email || !password) return res.status(400).json({ error: 'Prénom, nom, identifiant, email et mot de passe sont requis.' });
  if (password.length < 10 || password.length > 256) return res.status(400).json({ error: 'Le mot de passe doit contenir entre 10 et 256 caractères.' });
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) return res.status(400).json({ error: 'Identifiant invalide (3 à 32 caractères).' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Adresse email invalide.' });
  if (logo.length > 3500000) return res.status(400).json({ error: 'Le logo est trop lourd. Utilisez une image plus légère.' });
  if (!validLogo(logo)) return res.status(400).json({ error: 'Format de logo non autorisé.' });

  const duplicate = (await pool.query('SELECT id FROM users WHERE email = $1 OR username = $2', [email, username])).rows[0];
  if (duplicate) return res.status(409).json({ error: 'Un compte vendeur avec cet email ou cet identifiant existe déjà.' });
  const result = await pool.query(`
    INSERT INTO users (name, username, email, password, first_name, last_name, phone, shop_name, logo)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `, [safeName, username, email, hashPassword(password), firstName, lastName, phone, shopName, logo]);
  try {
    res.status(201).json({ user: await regenerateSession(req, result.rows[0]), message: 'Compte vendeur créé.' });
  } catch (error) {
    next(error);
  }
}));

app.post('/api/auth/google', limitAuthAttempts, asyncRoute(async (req, res) => {
  const credential = String(req.body?.credential || '').trim();
  const clientId = process.env.GOOGLE_CLIENT_ID || await getSetting('google_client_id');
  if (!credential) return res.status(400).json({ error: 'Jeton Google manquant.' });
  if (!clientId) return res.status(400).json({ error: 'Configurez d’abord l’ID client Google dans Paramètres.' });

  try {
    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`, { signal: AbortSignal.timeout(5000) });
    const payload = await response.json();
    const verified = payload.email_verified === true || payload.email_verified === 'true';
    if (!response.ok || payload.aud !== clientId || !verified || !payload.sub || !payload.email || !['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) {
      return res.status(401).json({ error: 'Connexion Google refusée.' });
    }
    const email = String(payload.email).toLowerCase();
    const given = String(payload.given_name || '').trim();
    const family = String(payload.family_name || '').trim();
    const display = fullName(given, family, payload.name || email.split('@')[0]);
    let user = (await pool.query('SELECT * FROM users WHERE email = $1 OR google_id = $2', [email, payload.sub])).rows[0];
    if (!user) {
      const usernameBase = email.split('@')[0].replace(/[^a-z0-9]/gi, '').slice(0, 18) || 'vendeur';
      let username = usernameBase;
      let suffix = 1;
      while ((await pool.query('SELECT id FROM users WHERE username = $1', [username])).rows[0]) {
        username = `${usernameBase}${suffix}`;
        suffix += 1;
      }
      user = (await pool.query(`
        INSERT INTO users (name, username, email, password, first_name, last_name, phone, shop_name, logo, google_id)
        VALUES ($1, $2, $3, $4, $5, $6, '', $7, $8, $9)
        RETURNING *
      `, [display, username, email, hashPassword(crypto.randomBytes(32).toString('hex')), given || display, family, DEFAULT_SHOP_NAME, validLogo(payload.picture) ? payload.picture : '', payload.sub])).rows[0];
    } else if (!user.google_id) {
      user = (await pool.query('UPDATE users SET google_id = $1 WHERE id = $2 RETURNING *', [payload.sub, user.id])).rows[0];
    }
    res.json({ user: await regenerateSession(req, user), message: 'Connexion Google réussie.' });
  } catch (error) {
    console.error(`[Google Auth] Échec de vérification : ${error.message}`);
    res.status(500).json({ error: 'Impossible de vérifier le compte Google.' });
  }
}));

app.get('/api/profile', requireAuth, asyncRoute(async (req, res) => {
  res.json({ user: publicUser(await loadUser(getSessionUser(req).id)) });
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
  if (!firstName || !lastName || !username || !email) return res.status(400).json({ error: 'Prénom, nom, identifiant et email sont requis.' });
  if (!validLogo(logo) || ![firstName, lastName, phone, shopName, username, email].every((value) => validText(value, 254))) {
    return res.status(400).json({ error: 'Profil invalide ou trop volumineux.' });
  }
  try {
    const user = (await pool.query(`
      UPDATE users
      SET name = $1, first_name = $2, last_name = $3, phone = $4, shop_name = $5,
          logo = $6, username = $7, email = $8
      WHERE id = $9 RETURNING *
    `, [fullName(firstName, lastName), firstName, lastName, phone, shopName, logo, username, email, current.id])).rows[0];
    res.json({ user: setSessionUser(req, user), message: 'Profil boutique mis à jour.' });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Email ou identifiant déjà utilisé.' });
    throw error;
  }
}));

app.put('/api/settings/google', requireAuth, asyncRoute(async (req, res) => {
  const clientId = String(req.body?.clientId || '').trim();
  await setSetting('google_client_id', clientId);
  res.json({ clientId, message: clientId ? 'Connexion Google activée.' : 'ID Google retiré.' });
}));

app.get('/api/reports/monthly', requireAuth, asyncRoute(async (req, res) => {
  const seller = publicUser(await loadUser(getSessionUser(req).id));
  const bounds = monthBounds(req.query.month);
  const nextMonth = bounds.month === 12 ? 1 : bounds.month + 1;
  const nextYear = bounds.month === 12 ? bounds.year + 1 : bounds.year;
  const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  const [current, previous, lowStock] = await Promise.all([
    monthStats(bounds.start, end),
    monthStats(bounds.prevStart, bounds.start),
    pool.query('SELECT id, name, quantity, threshold FROM products WHERE quantity <= threshold ORDER BY quantity ASC LIMIT 8'),
  ]);
  const lowStockProducts = lowStock.rows;
  const monthLabel = new Date(`${bounds.key}-01T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const analysis = buildMonthlyAnalysis({ seller, monthLabel, current: { ...current, lowStock: lowStockProducts }, previous });
  res.json({ seller, month: bounds.key, monthLabel, current: { ...current, lowStock: lowStockProducts }, previous, analysis });
}));

app.get('/api/catalog/families', requireAuth, asyncRoute(async (_req, res) => {
  const result = await pool.query(`
    SELECT c.family, COUNT(p.id) AS product_count, COALESCE(SUM(p.quantity), 0) AS stock_count
    FROM categories c LEFT JOIN products p ON p.category = c.name GROUP BY c.family
  `);
  const map = new Map(numericRows(result.rows, ['product_count', 'stock_count']).map((row) => [row.family, row]));
  res.json(CATEGORY_FAMILIES.map((family) => ({
    ...family,
    product_count: Number(map.get(family.id)?.product_count || 0),
    stock_count: Number(map.get(family.id)?.stock_count || 0),
  })));
}));

app.get('/api/categories', requireAuth, asyncRoute(async (req, res) => {
  const { family } = req.query;
  const result = family
    ? await pool.query('SELECT * FROM categories WHERE family = $1 ORDER BY name ASC', [family])
    : await pool.query('SELECT * FROM categories ORDER BY family ASC, name ASC');
  res.json(result.rows);
}));

app.post('/api/categories', requireAuth, asyncRoute(async (req, res) => {
  const label = String(req.body?.name || '').trim();
  const family = String(req.body?.family || 'autres').trim() || 'autres';
  if (!label) return res.status(400).json({ error: 'Le nom de la catégorie est requis.' });
  try {
    const result = await pool.query('INSERT INTO categories (name, family) VALUES ($1, $2) RETURNING *', [label, family]);
    res.status(201).json({ category: result.rows[0], message: 'Catégorie ajoutée.' });
  } catch (error) {
    if (error.code === '23505') return res.status(400).json({ error: 'Cette catégorie existe déjà.' });
    throw error;
  }
}));

app.put('/api/categories/:id', requireAuth, asyncRoute(async (req, res) => {
  const label = String(req.body?.name || '').trim();
  const family = String(req.body?.family || 'autres').trim() || 'autres';
  if (!label) return res.status(400).json({ error: 'Le nom de la catégorie est requis.' });
  const result = await pool.query('UPDATE categories SET name = $1, family = $2 WHERE id = $3 RETURNING *', [label, family, Number(req.params.id)]);
  if (!result.rowCount) return res.status(404).json({ error: 'Catégorie introuvable.' });
  res.json({ category: result.rows[0], message: 'Catégorie modifiée.' });
}));

app.delete('/api/categories/:id', requireAuth, asyncRoute(async (req, res) => {
  const result = await pool.query('DELETE FROM categories WHERE id = $1', [Number(req.params.id)]);
  if (!result.rowCount) return res.status(404).json({ error: 'Catégorie introuvable.' });
  res.json({ message: 'Catégorie supprimée.' });
}));

const mapProduct = (product) => ({
  ...product,
  profit_unit: Number(product.price_sale) - Number(product.price_buy),
  status: product.quantity <= 0 ? 'Rupture' : product.quantity <= product.threshold ? 'Stock faible' : 'Disponible',
});

app.get('/api/products', requireAuth, asyncRoute(async (req, res) => {
  const { search, category, family, brand, stockStatus, minPrice, maxPrice } = req.query;
  const conditions = [];
  const params = [];
  const add = (condition, value) => {
    params.push(value);
    conditions.push(condition.replace('?', `$${params.length}`));
  };
  if (search) {
    const term = likeValue(search);
    const fields = ["p.name", "p.category", "p.brand", "p.model", "COALESCE(p.reference, '')", "COALESCE(p.description, '')", "COALESCE(p.compatible_models, '')", "CAST(p.price_sale AS TEXT)"];
    const slots = fields.map((field) => {
      params.push(term);
      return `lower(${field}) LIKE $${params.length}`;
    });
    conditions.push(`(${slots.join(' OR ')})`);
  }
  if (category) add('p.category = ?', category);
  if (family) add('c.family = ?', family);
  if (brand) add('p.brand = ?', brand);
  if (stockStatus === 'low') conditions.push('p.quantity > 0 AND p.quantity <= p.threshold');
  if (stockStatus === 'out') conditions.push('p.quantity <= 0');
  if (stockStatus === 'available') conditions.push('p.quantity > p.threshold');
  if (minPrice) add('p.price_sale >= ?', Number(minPrice));
  if (maxPrice) add('p.price_sale <= ?', Number(maxPrice));
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await pool.query(`
    SELECT p.*, c.family AS category_family FROM products p
    LEFT JOIN categories c ON c.name = p.category ${where}
    ORDER BY p.category ASC, p.name ASC
  `, params);
  res.json(result.rows.map(mapProduct));
}));

app.get('/api/products/:id', requireAuth, asyncRoute(async (req, res) => {
  const result = await pool.query('SELECT * FROM products WHERE id = $1', [Number(req.params.id)]);
  if (!result.rowCount) return res.status(404).json({ error: 'Produit introuvable.' });
  res.json(mapProduct(result.rows[0]));
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
const productFields = ['name', 'category', 'brand', 'model', 'reference', 'quantity', 'price_buy', 'price_sale', 'threshold', 'location', 'description', 'compatible_models'];
const validProduct = (product) => Boolean(product.name && product.category && product.brand && product.model)
  && [product.quantity, product.threshold, product.price_buy, product.price_sale].every(validNonNegativeInt)
  && [product.name, product.category, product.brand, product.model, product.reference, product.location, product.description, product.compatible_models].every((value) => validText(value, 2000));
const productValues = (product) => productFields.map((field) => product[field]);

app.post('/api/products', requireAuth, asyncRoute(async (req, res) => {
  const product = readProductInput(req.body || {});
  if (!product.name || !product.category || !product.brand || !product.model) return res.status(400).json({ error: 'Nom, catégorie, marque et modèle sont obligatoires.' });
  if (![product.quantity, product.threshold, product.price_buy, product.price_sale].every(validNonNegativeInt)) return res.status(400).json({ error: 'Stock, seuil et prix doivent être des nombres entiers positifs ou nuls.' });
  if (![product.name, product.category, product.brand, product.model, product.reference, product.location, product.description, product.compatible_models].every((value) => validText(value, 2000))) return res.status(400).json({ error: 'Un champ produit est trop long.' });
  const inserted = await withTransaction(async (client) => {
    const result = await client.query(`
      INSERT INTO products (${productFields.join(', ')}) VALUES (${productFields.map((_, i) => `$${i + 1}`).join(', ')})
      RETURNING *
    `, productValues(product));
    const row = result.rows[0];
    await client.query("INSERT INTO stock_movements (product_id, type, quantity, note) VALUES ($1, 'entry', $2, 'Ajout initial')", [row.id, row.quantity]);
    return row;
  });
  res.status(201).json({ product: inserted, message: 'Produit ajouté avec succès.' });
}));

app.put('/api/products/:id', requireAuth, asyncRoute(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Identifiant produit invalide.' });
  const product = readProductInput(req.body || {});
  if (!validProduct(product)) return res.status(400).json({ error: 'Champs obligatoires ou valeurs invalides.' });
  const setClause = productFields.map((field, i) => `${field} = $${i + 1}`).join(', ');
  const result = await pool.query(`UPDATE products SET ${setClause} WHERE id = $${productFields.length + 1} RETURNING *`, [...productValues(product), Number(req.params.id)]);
  if (!result.rowCount) return res.status(404).json({ error: 'Produit introuvable.' });
  res.json({ product: result.rows[0], message: 'Produit mis à jour.' });
}));

app.post('/api/products/:id/add-stock', requireAuth, asyncRoute(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Identifiant produit invalide.' });
  const quantity = Number(req.body?.quantity || 0);
  const note = String(req.body?.note || 'Réception').trim() || 'Réception';
  if (!Number.isSafeInteger(quantity) || quantity <= 0) return res.status(400).json({ error: 'La quantité doit être un entier supérieur à 0.' });
  const result = await withTransaction(async (client) => {
    const product = (await client.query('UPDATE products SET quantity = quantity + $1 WHERE id = $2 RETURNING *', [quantity, Number(req.params.id)])).rows[0];
    if (!product) return null;
    await client.query("INSERT INTO stock_movements (product_id, type, quantity, note) VALUES ($1, 'entry', $2, $3)", [product.id, quantity, note]);
    return product;
  });
  if (!result) return res.status(404).json({ error: 'Produit introuvable.' });
  res.json({ product: result, message: 'Stock mis à jour.' });
}));

app.delete('/api/products/:id', requireAuth, asyncRoute(async (req, res) => {
  const result = await pool.query('DELETE FROM products WHERE id = $1', [Number(req.params.id)]);
  if (!result.rowCount) return res.status(404).json({ error: 'Produit introuvable.' });
  res.json({ message: 'Produit supprimé.' });
}));

app.post('/api/sales', requireAuth, asyncRoute(async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: 'Aucun produit sélectionné.' });
  try {
    const sale = await withTransaction(async (client) => {
      const saleRow = (await client.query('INSERT INTO sales (total_amount, total_profit, items_count) VALUES (0, 0, 0) RETURNING *')).rows[0];
      let totalAmount = 0;
      let totalProfit = 0;
      let itemCount = 0;
      for (const item of items) {
        if (!validId(item?.id)) throw new Error('Identifiant produit invalide.');
        const product = (await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [Number(item.id)])).rows[0];
        if (!product) throw new Error(`Produit introuvable: ${item.id}`);
        const quantity = Number(item.quantity || 0);
        if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > product.quantity) throw new Error(`Stock insuffisant pour ${product.name}`);
        const unitProfit = Number(product.price_sale) - Number(product.price_buy);
        const subtotal = Number(product.price_sale) * quantity;
        const profit = unitProfit * quantity;
        await client.query('INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal, profit) VALUES ($1, $2, $3, $4, $5, $6)', [saleRow.id, product.id, quantity, product.price_sale, subtotal, profit]);
        await client.query('UPDATE products SET quantity = quantity - $1 WHERE id = $2', [quantity, product.id]);
        await client.query("INSERT INTO stock_movements (product_id, type, quantity, note) VALUES ($1, 'sale', $2, 'Vente caisse')", [product.id, quantity]);
        totalAmount += subtotal;
        totalProfit += profit;
        itemCount += quantity;
      }
      return (await client.query('UPDATE sales SET total_amount = $1, total_profit = $2, items_count = $3 WHERE id = $4 RETURNING *', [totalAmount, totalProfit, itemCount, saleRow.id])).rows[0];
    });
    res.status(201).json({ sale, message: 'Vente enregistrée avec succès.' });
  } catch (error) {
    if (error.message.startsWith('Stock insuffisant') || error.message.startsWith('Produit introuvable') || error.message === 'Identifiant produit invalide.') {
      return res.status(400).json({ error: error.message });
    }
    throw error;
  }
}));

app.get('/api/sales', requireAuth, asyncRoute(async (req, res) => {
  const { range, product, category, date } = req.query;
  const filters = [];
  const params = [];
  const add = (clause, value) => {
    params.push(value);
    filters.push(clause.replace('?', `$${params.length}`));
  };
  if (product) add('lower(p.name) LIKE ?', likeValue(product));
  if (category) add('lower(p.category) LIKE ?', likeValue(category));
  if (date) add('s.sale_date::date = ?::date', date);
  if (range === 'today') filters.push('s.sale_date::date = CURRENT_DATE');
  else if (range === 'yesterday') filters.push("s.sale_date::date = CURRENT_DATE - INTERVAL '1 day'");
  else if (range === 'week') filters.push("s.sale_date::date >= CURRENT_DATE - INTERVAL '6 days'");
  else if (range === 'month') filters.push("s.sale_date::date >= CURRENT_DATE - INTERVAL '30 days'");
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = (await pool.query(`
    SELECT s.*, si.product_id, si.quantity, si.unit_price, si.subtotal, si.profit,
           p.name AS product_name, p.category AS product_category
    FROM sales s LEFT JOIN sale_items si ON si.sale_id = s.id
    LEFT JOIN products p ON p.id = si.product_id ${where}
    ORDER BY s.sale_date DESC
  `, params)).rows;
  const sales = [];
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.id)) {
      map.set(row.id, { id: row.id, sale_date: row.sale_date, total_amount: Number(row.total_amount), total_profit: Number(row.total_profit), items_count: row.items_count, items: [] });
      sales.push(map.get(row.id));
    }
    if (row.product_id) {
      map.get(row.id).items.push({
        product_id: row.product_id,
        product_name: row.product_name,
        product_category: row.product_category,
        quantity: row.quantity,
        unit_price: Number(row.unit_price),
        subtotal: Number(row.subtotal),
        profit: Number(row.profit),
      });
    }
  }
  res.json(sales);
}));

app.get('/api/dashboard', requireAuth, asyncRoute(async (_req, res) => {
  const [todaySales, totalProducts, totalStock, estimatedProfit, lowStockProducts, topProducts, salesTrend, familyStock] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(total_amount), 0) AS total_amount, COALESCE(SUM(items_count), 0) AS items_count, COALESCE(SUM(total_profit), 0) AS total_profit FROM sales WHERE sale_date::date = CURRENT_DATE`),
    pool.query('SELECT COUNT(*) AS total FROM products'),
    pool.query('SELECT COALESCE(SUM(quantity), 0) AS total FROM products'),
    pool.query('SELECT COALESCE(SUM((price_sale - price_buy) * quantity), 0) AS total FROM products'),
    pool.query('SELECT * FROM products WHERE quantity <= threshold ORDER BY quantity ASC LIMIT 8'),
    pool.query(`SELECT p.name, p.category, COALESCE(SUM(si.quantity), 0) AS sold FROM products p LEFT JOIN sale_items si ON si.product_id = p.id GROUP BY p.id ORDER BY sold DESC LIMIT 5`),
    pool.query(`SELECT to_char(sale_date, 'DD') AS day, SUM(total_amount) AS total_amount FROM sales WHERE sale_date >= now() - INTERVAL '6 days' GROUP BY sale_date::date ORDER BY sale_date::date ASC`),
    pool.query(`SELECT c.family, COALESCE(SUM(p.quantity), 0) AS stock FROM categories c LEFT JOIN products p ON p.category = c.name GROUP BY c.family`),
  ]);
  res.json({
    todaySales: todaySales.rows[0],
    totalProducts: numericRow(totalProducts.rows[0], ['total']),
    totalStock: numericRow(totalStock.rows[0], ['total']),
    estimatedProfit: Number(estimatedProfit.rows[0].total || 0),
    lowStockProducts: lowStockProducts.rows,
    topProducts: numericRows(topProducts.rows, ['sold']),
    salesTrend: numericRows(salesTrend.rows, ['total_amount']),
    familyStock: numericRows(familyStock.rows, ['stock']),
    currency: 'FCFA',
  });
}));

app.get('/api/stats', requireAuth, asyncRoute(async (req, res) => {
  const range = req.query.range || 'today';
  const interval = { week: '6 days', month: '30 days', year: '365 days' }[range];
  const predicate = range === 'today' || !interval
    ? 'sale_date::date = CURRENT_DATE'
    : `sale_date::date >= CURRENT_DATE - INTERVAL '${interval}'`;
  const saleJoinPredicate = predicate.replaceAll('sale_date', 's.sale_date');
  const [stats, topProduct, topCategory, trend] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(total_amount), 0) AS revenue, COALESCE(SUM(total_profit), 0) AS profit, COUNT(*) AS sales_count, COALESCE(SUM(items_count), 0) AS items_sold FROM sales WHERE ${predicate}`),
    pool.query(`SELECT p.name, SUM(si.quantity) AS total_quantity FROM sale_items si JOIN products p ON p.id = si.product_id JOIN sales s ON s.id = si.sale_id WHERE ${saleJoinPredicate} GROUP BY p.id ORDER BY total_quantity DESC LIMIT 1`),
    pool.query(`SELECT p.category AS name, SUM(si.quantity) AS total_quantity FROM sale_items si JOIN products p ON p.id = si.product_id JOIN sales s ON s.id = si.sale_id WHERE ${saleJoinPredicate} GROUP BY p.category ORDER BY total_quantity DESC LIMIT 1`),
    pool.query(`SELECT to_char(sale_date, 'DD') AS label, SUM(total_amount) AS total_amount FROM sales WHERE ${predicate} GROUP BY sale_date::date ORDER BY sale_date::date ASC`),
  ]);
  res.json({
    stats: numericRow(stats.rows[0], ['revenue', 'profit', 'sales_count', 'items_sold']),
    topProduct: topProduct.rows[0] ? numericRow(topProduct.rows[0], ['total_quantity']) : null,
    topCategory: topCategory.rows[0] ? numericRow(topCategory.rows[0], ['total_quantity']) : null,
    trend: numericRows(trend.rows, ['total_amount']),
  });
}));

app.get('/api/stock-movements', requireAuth, asyncRoute(async (_req, res) => {
  const result = await pool.query(`
    SELECT sm.*, p.name AS product_name FROM stock_movements sm
    JOIN products p ON p.id = sm.product_id ORDER BY sm.created_at DESC LIMIT 50
  `);
  res.json(result.rows);
}));

app.use((error, _req, res, _next) => {
  console.error(`[API] ${error.message}`);
  if (error.code === '23505') return res.status(409).json({ error: 'Cette valeur existe déjà.' });
  if (error.code === '23503') return res.status(409).json({ error: 'Cette donnée est utilisée par un autre élément.' });
  res.status(500).json({ error: 'Une erreur serveur est survenue.' });
});

export { app, pool };
