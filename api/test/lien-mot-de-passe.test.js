// Test du script lien-mot-de-passe contre une vraie base (ignoré si TEST_DB_HOST n'est pas défini).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { construireApp } from '../src/app.js';
import { creerBaseDeTest, hote, options } from './aide-base.js';

const MOT_DE_PASSE = 'un mot de passe solide';
let baseDeTest;
let env;
let app;

const lancer = (...args) => promisify(execFile)(process.execPath, ['scripts/lien-mot-de-passe.js', ...args], { env });
const jeton = (lien) => new URL(lien).searchParams.get('jeton');

before(async () => {
  if (!hote) return;
  baseDeTest = await creerBaseDeTest();
  const { host, port, database, user, password } = baseDeTest.connexionApi;
  env = {
    ...process.env, DB_HOST: host, DB_PORT: String(port), DB_NAME: database, DB_USER: user, DB_PASSWORD: password,
    APP_URL: 'http://192.168.1.12:3002', SMTP_HOST: 'smtp.invalid', SMTP_FROM: 'absences@exemple.test',
  };
  const equipe = (await baseDeTest.api.query(`INSERT INTO equipes (nom) VALUES ('Direction') RETURNING id`)).rows[0].id;
  for (const [prenom, role, actif] of [['alice', 'collaborateur', true], ['bob', 'responsable', true], ['zoe', 'collaborateur', false]]) {
    await baseDeTest.api.query(
      'INSERT INTO collaborateurs (email, nom, prenom, equipe_id, role, actif) VALUES ($1, $2, $2, $3, $4, $5)',
      [`${prenom}@exemple.test`, prenom, equipe, role, actif],
    );
  }
  app = await construireApp({
    pool: baseDeTest.api, logger: false, courriel: { envoyer: async () => {} },
    config: { appUrl: env.APP_URL, cookieSecure: false, sessionDureeHeures: 12 },
  });
});

after(async () => {
  await app?.close();
  await baseDeTest?.fermer();
});

const definir = (lien) => app.inject({
  method: 'POST', url: '/api/auth/mot-de-passe/definir', payload: { jeton: jeton(lien), motDePasse: MOT_DE_PASSE },
});
const connecter = (email) => app.inject({
  method: 'POST', url: '/api/auth/connexion', payload: { email, motDePasse: MOT_DE_PASSE },
});

test('sans argument, le script liste les comptes et leur accès', options, async () => {
  const { stdout } = await lancer();
  assert.match(stdout, /alice@exemple\.test\talice alice\tcollaborateur\taucun accès défini/);
  assert.match(stdout, /zoe@exemple\.test\tzoe zoe\tcollaborateur \(désactivé\)/);
});

test('un lien pour un compte permet de choisir son mot de passe puis de se connecter', options, async () => {
  const { stdout } = await lancer('Alice@Exemple.test');
  const lien = stdout.match(/http\S+/)[0];
  assert.match(lien, /^http:\/\/192\.168\.1\.12:3002\/definir-mot-de-passe\?jeton=/);
  assert.equal((await connecter('alice@exemple.test')).statusCode, 401);
  assert.equal((await definir(lien)).statusCode, 204);
  assert.equal((await connecter('alice@exemple.test')).statusCode, 204);
  // À usage unique.
  assert.equal((await definir(lien)).statusCode, 400);
  // Le jeton n'est pas stocké en clair.
  const { rows } = await baseDeTest.api.query('SELECT jeton_hash FROM jetons_mot_de_passe');
  assert.ok(rows.every((r) => r.jeton_hash !== jeton(lien)));
});

test('--sans-mot-de-passe ne concerne que les comptes actifs sans accès', options, async () => {
  const { stdout } = await lancer('--sans-mot-de-passe');
  assert.match(stdout, /bob bob <bob@exemple\.test>/);
  assert.doesNotMatch(stdout, /alice@exemple\.test/); // déjà un mot de passe
  assert.doesNotMatch(stdout, /zoe@exemple\.test/); // désactivée
  assert.equal((await definir(stdout.match(/http\S+/)[0])).statusCode, 204);
  assert.equal((await connecter('bob@exemple.test')).statusCode, 204);
  await assert.rejects(lancer('--sans-mot-de-passe'), /Tous les comptes actifs ont déjà un accès/);
});

test('compte inconnu ou désactivé : échec explicite', options, async () => {
  await assert.rejects(lancer('personne@exemple.test'), /Aucun compte actif pour personne@exemple\.test/);
  await assert.rejects(lancer('zoe@exemple.test'), /Aucun compte actif/);
});
