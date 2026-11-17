// Tests du mode test « autologin » contre une vraie base (ignorés si TEST_DB_HOST n'est pas défini).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { construireApp } from '../src/app.js';
import { creerBaseDeTest, hote, options } from './aide-base.js';

const config = { appUrl: 'http://app.test', cookieSecure: false, sessionDureeHeures: 12 };
const sansLimite = { connexion: { max: 10000, timeWindow: '1 minute' }, oubli: { max: 10000, timeWindow: '1 minute' } };

let baseDeTest;
let pool;
let ferme; // application standard : le mode test est désactivé
let ouvert; // application avec AUTOLOGIN_TEST
const ids = {};

const construire = (extra) => construireApp({
  pool, config, logger: false, limites: sansLimite, courriel: { envoyer: async () => {} }, ...extra,
});

before(async () => {
  if (!hote) return;
  baseDeTest = await creerBaseDeTest();
  pool = baseDeTest.api;
  const equipe = Number((await pool.query(`INSERT INTO equipes (nom) VALUES ('Direction') RETURNING id`)).rows[0].id);
  for (const [prenom, role, actif] of [['alice', 'collaborateur', true], ['diane', 'directeur', true], ['zoe', 'collaborateur', false]]) {
    ids[prenom] = Number((await pool.query(
      `INSERT INTO collaborateurs (email, nom, prenom, equipe_id, role, actif, mot_de_passe_hash)
       VALUES ($1, $2, $2, $3, $4, $5, 'scrypt$secret') RETURNING id`,
      [`${prenom}@exemple.test`, prenom, equipe, role, actif],
    )).rows[0].id);
  }
  ferme = await construire({});
  ouvert = await construire({ autologin: true });
});

after(async () => {
  await ferme?.close();
  await ouvert?.close();
  await baseDeTest?.fermer();
});

test('par défaut, le mode test n\'existe pas', options, async () => {
  assert.deepEqual((await ferme.inject({ method: 'GET', url: '/api/auth/config' })).json(), { microsoft: false, autologin: false });
  assert.equal((await ferme.inject({ method: 'GET', url: '/api/auth/autologin' })).statusCode, 404);
  const tentative = await ferme.inject({ method: 'POST', url: '/api/auth/autologin', payload: { collaborateurId: ids.diane } });
  assert.equal(tentative.statusCode, 404);
  assert.equal(tentative.cookies.length, 0);
});

test('activé : la liste ne contient que les comptes actifs, sans aucun secret', options, async () => {
  assert.equal((await ouvert.inject({ method: 'GET', url: '/api/auth/config' })).json().autologin, true);
  const reponse = await ouvert.inject({ method: 'GET', url: '/api/auth/autologin' });
  assert.equal(reponse.statusCode, 200);
  assert.deepEqual(reponse.json(), [
    { id: ids.alice, prenom: 'alice', nom: 'alice', role: 'collaborateur', equipe: 'Direction' },
    { id: ids.diane, prenom: 'diane', nom: 'diane', role: 'directeur', equipe: 'Direction' },
  ]);
  assert.ok(!reponse.body.includes('scrypt'));
  assert.ok(!reponse.body.includes('@exemple.test'));
});

test('activé : choisir un compte ouvre sa session, sans mot de passe', options, async () => {
  const connexion = await ouvert.inject({ method: 'POST', url: '/api/auth/autologin', payload: { collaborateurId: ids.diane } });
  assert.equal(connexion.statusCode, 204);
  const temoin = connexion.cookies.find((c) => c.name === 'absences_session');
  assert.equal(temoin.httpOnly, true);
  const moi = await ouvert.inject({ method: 'GET', url: '/api/auth/moi', cookies: { absences_session: temoin.value } });
  assert.equal(moi.statusCode, 200);
  assert.equal(moi.json().role, 'directeur');
  // La session est une session ordinaire : la déconnexion la ferme.
  await ouvert.inject({ method: 'POST', url: '/api/auth/deconnexion', cookies: { absences_session: temoin.value } });
  assert.equal((await ouvert.inject({ method: 'GET', url: '/api/auth/moi', cookies: { absences_session: temoin.value } })).statusCode, 401);
});

test('activé : compte désactivé, inconnu ou requête invalide refusés', options, async () => {
  for (const corps of [{ collaborateurId: ids.zoe }, { collaborateurId: 99999 }]) {
    const reponse = await ouvert.inject({ method: 'POST', url: '/api/auth/autologin', payload: corps });
    assert.equal(reponse.statusCode, 404);
    assert.equal(reponse.cookies.length, 0);
  }
  assert.equal((await ouvert.inject({ method: 'POST', url: '/api/auth/autologin', payload: {} })).statusCode, 400);
  assert.equal((await ouvert.inject({ method: 'POST', url: '/api/auth/autologin', payload: { collaborateurId: 'x' } })).statusCode, 400);
});

test('activé : les tentatives sont limitées, comme la connexion', options, async () => {
  const limite = await construire({ autologin: true, limites: { connexion: { max: 2, timeWindow: '1 minute' }, oubli: sansLimite.oubli } });
  const statuts = [];
  for (let i = 0; i < 4; i++) {
    statuts.push((await limite.inject({ method: 'POST', url: '/api/auth/autologin', payload: { collaborateurId: ids.alice } })).statusCode);
  }
  assert.deepEqual(statuts, [204, 204, 429, 429]);
  await limite.close();
});
