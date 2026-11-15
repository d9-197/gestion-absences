import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construireApp } from '../src/app.js';

test('GET /api/health répond ok quand la base répond', async () => {
  const app = construireApp({ pool: { query: async () => ({ rows: [] }) }, logger: false });
  const reponse = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(reponse.statusCode, 200);
  assert.deepEqual(reponse.json(), { statut: 'ok', base: 'ok' });
});

test('GET /api/health répond 503 quand la base est injoignable', async () => {
  const pool = { query: async () => { throw new Error('connexion refusée'); } };
  const app = construireApp({ pool, logger: false });
  const reponse = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(reponse.statusCode, 503);
  assert.equal(reponse.json().base, 'injoignable');
});
