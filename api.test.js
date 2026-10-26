'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

// Use a throw-away database file and an unreachable Ollama so tests never touch real data.
process.env.DATA_FILE = path.join(os.tmpdir(), 'voltshare-test-' + Date.now() + '.json');
process.env.OLLAMA_URL = 'http://127.0.0.1:9/api/chat';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';

const { createServer, splitAmount } = require('../server');

let server, base;
test.before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => server.close());

async function call(method, url, body, token) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* not json */ }
  return { status: res.status, data };
}

test('commission split is 80/20 and calculated by the server', () => {
  assert.deepStrictEqual(splitAmount(120, 1), { estimatedPrice: 120, hostShare: 96, platformFee: 24 });
  assert.deepStrictEqual(splitAmount(40, 2), { estimatedPrice: 80, hostShare: 64, platformFee: 16 });
});

test('register, login and authorization', async () => {
  const weak = await call('POST', '/api/auth/register', { name: 'A', email: 'a@example.com', password: 'short' });
  assert.strictEqual(weak.status, 400);

  const reg = await call('POST', '/api/auth/register', { name: 'Asha', email: 'Asha@Example.com', password: 'password123' });
  assert.strictEqual(reg.status, 201);
  assert.ok(reg.data.token);
  assert.strictEqual(reg.data.user.passwordHash, undefined, 'password hash must never be returned');

  const dup = await call('POST', '/api/auth/register', { name: 'Asha', email: 'asha@example.com', password: 'password123' });
  assert.strictEqual(dup.status, 409);

  const bad = await call('POST', '/api/auth/login', { email: 'asha@example.com', password: 'wrong-password' });
  assert.strictEqual(bad.status, 401);

  const good = await call('POST', '/api/auth/login', { email: 'asha@example.com', password: 'password123' });
  assert.strictEqual(good.status, 200);

  assert.strictEqual((await call('GET', '/api/profile')).status, 401);
  assert.strictEqual((await call('GET', '/api/me', null, 'not.a.token')).status, 401);
});

test('profile is validated and saved per user', async () => {
  const { data } = await call('POST', '/api/auth/register', { name: 'Ravi', email: 'ravi@example.com', password: 'password123' });
  const t = data.token;
  assert.strictEqual((await call('PUT', '/api/profile', { vehicle: 'Rocket', connector: '' }, t)).status, 400);
  assert.strictEqual((await call('PUT', '/api/profile', { vehicle: 'E-scooter', connector: 'Type 2', battery: 150 }, t)).status, 400);
  const ok = await call('PUT', '/api/profile', { vehicle: 'E-scooter', connector: '3-pin (scooter)', battery: 12, maxPrice: 100 }, t);
  assert.strictEqual(ok.status, 200);
  assert.deepStrictEqual((await call('GET', '/api/profile', null, t)).data.profile, ok.data.profile);
});

test('booking requests: commission, conflicts and ownership', async () => {
  const a = (await call('POST', '/api/auth/register', { name: 'Uma', email: 'uma@example.com', password: 'password123' })).data.token;
  const b = (await call('POST', '/api/auth/register', { name: 'Vik', email: 'vik@example.com', password: 'password123' })).data.token;

  assert.strictEqual((await call('POST', '/api/requests', { chargerId: 1 })).status, 401);

  const r1 = await call('POST', '/api/requests', { chargerId: 1, hours: 1, price: 1, status: 'COMPLETED', hostShare: 999 }, a);
  assert.strictEqual(r1.status, 201);
  assert.strictEqual(r1.data.request.status, 'PENDING', 'status sent by the client is ignored');
  assert.strictEqual(r1.data.request.estimatedPrice, 120, 'price sent by the client is ignored');
  assert.strictEqual(r1.data.request.hostShare, 96);
  assert.strictEqual(r1.data.request.platformFee, 24);

  assert.strictEqual((await call('POST', '/api/requests', { chargerId: 1 }, a)).status, 409, 'duplicate pending request');
  assert.strictEqual((await call('POST', '/api/requests', { chargerId: 3 }, a)).status, 409, 'unavailable charger');
  assert.strictEqual((await call('POST', '/api/requests', { chargerId: 2, hours: 99 }, a)).status, 400);
  assert.strictEqual((await call('POST', '/api/requests', { chargerId: 999 }, a)).status, 404);

  const id = r1.data.request.id;
  assert.strictEqual((await call('POST', `/api/requests/${id}/cancel`, null, b)).status, 404, 'other users cannot cancel it');
  assert.strictEqual((await call('GET', '/api/requests/mine', null, b)).data.requests.length, 0);
  const done = await call('POST', `/api/requests/${id}/cancel`, null, a);
  assert.strictEqual(done.status, 200);
  assert.strictEqual(done.data.request.status, 'CANCELLED');
  assert.strictEqual((await call('POST', `/api/requests/${id}/cancel`, null, a)).status, 409, 'cannot cancel twice');
});

test('chargers list and filters', async () => {
  const all = await call('GET', '/api/chargers');
  assert.strictEqual(all.data.chargers.length, 6);
  assert.ok(all.data.chargers.every((c) => c.isDemo === true));
  const f = await call('GET', '/api/chargers?connector=Type%202&maxPrice=100&available=true');
  assert.deepStrictEqual(f.data.chargers.map((c) => c.id), [5]);
});

test('chat returns 503 (not a fake answer) when the AI model is not running', async () => {
  const r = await call('POST', '/api/chat', { message: 'hello' });
  assert.strictEqual(r.status, 503);
  assert.strictEqual((await call('POST', '/api/chat', { message: '' })).status, 400);
});

test('static files are served and path traversal is blocked', async () => {
  const page = await fetch(base + '/');
  assert.strictEqual(page.status, 200);
  assert.ok((await page.text()).includes('VoltShare'));

  const status = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: '/%2e%2e/server.js' }, (res) => { res.resume(); resolve(res.statusCode); });
  });
  assert.notStrictEqual(status, 200);
});
