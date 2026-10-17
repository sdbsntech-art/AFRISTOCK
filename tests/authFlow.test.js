import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('first owner setup and seller authentication work on local HTTP in production mode', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'afristock-auth-'));
  const databasePath = path.join(directory, 'auth.sqlite');
  process.env.SQLITE_PATH = databasePath;
  process.env.SESSION_SECRET = crypto.randomBytes(48).toString('hex');
  process.env.SUPER_ADMIN_EMAIL = 'owner@example.local';
  process.env.NODE_ENV = 'production';

  const { app, closeSessionStore, pool } = await import('../server/app.js');
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const clients = new Map();

  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await closeSessionStore();
    await pool.end();
    for (const suffix of ['', '-shm', '-wal']) {
      const file = `${databasePath}${suffix}`;
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    fs.rmdirSync(directory);
  });

  const request = async (client, route, method = 'GET', body) => {
    const headers = { origin: baseUrl };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (clients.has(client)) headers.cookie = clients.get(client);

    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const cookies = response.headers.getSetCookie?.() || [];
    if (cookies.length) clients.set(client, cookies.map((cookie) => cookie.split(';')[0]).join('; '));

    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
    return { response, status: response.status, data };
  };

  const initialStatus = await request('owner', '/api/auth/status');
  assert.deepEqual(initialStatus.data, { setupRequired: true, setupBlocked: false });
  assert.match(initialStatus.response.headers.get('cache-control') || '', /no-store/);

  const unconfiguredOwner = await request('claim', '/api/signup', 'POST', {
    first_name: 'Unknown',
    last_name: 'Owner',
    username: 'unknownowner',
    email: 'unknown@example.local',
    password: 'Unknown-Password-2026!',
  });
  assert.equal(unconfiguredOwner.status, 403);

  const owner = await request('owner', '/api/signup', 'POST', {
    first_name: 'Local',
    last_name: 'Owner',
    username: 'localowner',
    email: 'owner@example.local',
    password: 'Owner-Password-2026!',
  });
  assert.equal(owner.status, 201, JSON.stringify(owner.data));
  assert.equal(owner.data.user.role, 'admin');
  assert.equal((await request('default-admin', '/api/login', 'POST', {
    identifier: 'admin',
    password: 'Admin@AfriStock2026!',
  })).status, 401);
  const cookie = owner.response.headers.getSetCookie?.().join(';') || '';
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.doesNotMatch(cookie, /Secure/i);
  assert.deepEqual((await request('owner', '/api/auth/status')).data, { setupRequired: false, setupBlocked: false });

  await pool.query(
    'INSERT INTO categories (name, family, user_id) VALUES (?, ?, ?)',
    ['Alimentation', 'Épicerie', owner.data.user.id],
  );
  const foodProduct = await request('owner', '/api/products', 'POST', {
    name: 'Haricots',
    category: 'Alimentation',
    brand: 'Nestlé',
    model: '',
    reference: '',
    quantity: 5,
    price_buy: 100,
    price_sale: 150,
    threshold: 2,
    location: '',
    description: '',
    compatible_models: '',
  });
  assert.equal(foodProduct.status, 201, JSON.stringify(foodProduct.data));
  const filteredFood = await request(
    'owner',
    `/api/products?category=Alimentation&brand=${encodeURIComponent('nestlé')}&minPrice=0&maxPrice=150`,
  );
  assert.equal(filteredFood.status, 200);
  assert.deepEqual(filteredFood.data.map((product) => product.name), ['Haricots']);
  assert.equal((await request('owner', '/api/products?minPrice=200&maxPrice=100')).status, 400);

  const publicRegistration = await request('attacker', '/api/signup', 'POST', {
    first_name: 'Public',
    last_name: 'User',
    username: 'publicuser',
    email: 'public@example.local',
    password: 'Public-Password-2026!',
  });
  assert.equal(publicRegistration.status, 403);
  assert.equal((await request('anonymous', '/api/admin/users')).status, 401);

  const seller = await request('owner', '/api/admin/users', 'POST', {
    first_name: 'Local',
    last_name: 'Seller',
    username: 'localseller',
    email: 'seller@example.local',
    role: 'seller',
  });
  assert.equal(seller.status, 201, JSON.stringify(seller.data));
  assert.equal(seller.data.user.role, 'seller');
  assert.equal(Boolean(seller.data.user.must_change_password), true);
  assert.ok(seller.data.temporaryPassword);

  const secondAdmin = await request('owner', '/api/admin/users', 'POST', {
    first_name: 'Second',
    last_name: 'Admin',
    username: 'secondadmin',
    email: 'secondadmin@example.local',
    role: 'admin',
  });
  assert.equal(secondAdmin.status, 403);

  const sellerPromotion = await request('owner', `/api/admin/users/${seller.data.user.id}`, 'PUT', {
    role: 'admin',
  });
  assert.equal(sellerPromotion.status, 403);
  assert.equal((await request('owner', `/api/admin/users/${owner.data.user.id}`, 'DELETE')).status, 400);

  assert.equal((await request('wrong-login', '/api/login', 'POST', {
    identifier: 'localseller',
    password: 'incorrect-password',
  })).status, 401);

  const sellerLogin = await request('seller', '/api/login', 'POST', {
    identifier: 'seller@example.local',
    password: seller.data.temporaryPassword,
  });
  assert.equal(sellerLogin.status, 200, JSON.stringify(sellerLogin.data));
  assert.equal(sellerLogin.data.user.role, 'seller');
  assert.equal(Boolean(sellerLogin.data.user.must_change_password), true);
  assert.equal((await request('seller', '/api/admin/users')).status, 403);
  await pool.query("UPDATE users SET role = 'admin' WHERE username = ?", ['localseller']);
  assert.equal((await request('seller', '/api/session')).data.user.role, 'seller');
  assert.equal((await request('seller', '/api/admin/users')).status, 403);
  await pool.query("UPDATE users SET role = 'seller' WHERE username = ?", ['localseller']);

  const passwordChange = await request('seller', '/api/auth/change-password', 'POST', {
    newPassword: 'Seller-Password-2026!',
  });
  assert.equal(passwordChange.status, 200, JSON.stringify(passwordChange.data));
  assert.equal(Boolean(passwordChange.data.user.must_change_password), false);

  await request('seller', '/api/logout', 'POST', {});
  clients.delete('seller');
  const sellerReLogin = await request('seller-again', '/api/login', 'POST', {
    identifier: 'localseller',
    password: 'Seller-Password-2026!',
  });
  assert.equal(sellerReLogin.status, 200, JSON.stringify(sellerReLogin.data));

  const [users] = await pool.query('SELECT username, role, password FROM users ORDER BY id');
  assert.equal(users.length, 2);
  assert.deepEqual(users.map(({ username, role }) => ({ username, role })), [
    { username: 'localowner', role: 'admin' },
    { username: 'localseller', role: 'seller' },
  ]);
  for (const user of users) assert.match(user.password, /^scrypt\$v=1\$/);
});
