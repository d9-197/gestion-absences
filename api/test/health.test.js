import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construireApp } from '../src/app.js';

const config = { appUrl: 'http://app.test', cookieSecure: false, sessionDureeHeures: 12 };
const construire = (pool) => construireApp({ pool, config, courriel: { envoyer: async () => {} }, logger: false });

test('GET /api/health répond ok quand la base répond', async () => {
  const app = await construire({ query: async () => ({ rows: [] }) });
  const reponse = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(reponse.statusCode, 200);
  assert.deepEqual(reponse.json(), { statut: 'ok', base: 'ok' });
});

test('GET /api/health répond 503 quand la base est injoignable', async () => {
  const app = await construire({ query: async () => { throw new Error('connexion refusée'); } });
  const reponse = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(reponse.statusCode, 503);
  assert.equal(reponse.json().base, 'injoignable');
});
