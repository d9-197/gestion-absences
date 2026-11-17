// Tests de l'authentification contre une vraie base (ignorés si TEST_DB_HOST n'est pas défini).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { construireApp } from '../src/app.js';
import { creerMicrosoft } from '../src/auth/microsoft.js';
import { creerBaseDeTest, hote, options } from './aide-base.js';
import { demarrerFauxMicrosoft } from './faux-microsoft.js';

const config = { appUrl: 'http://app.test', cookieSecure: false, sessionDureeHeures: 12 };
const sansLimite = { connexion: { max: 10000, timeWindow: '1 minute' }, oubli: { max: 10000, timeWindow: '1 minute' } };
const MOT_DE_PASSE = 'un mot de passe solide';

let baseDeTest;
let pool;
let app;
let fauxMicrosoft;
const courriels = [];
const ids = {};

const post = (url, payload, cookies = {}) => app.inject({ method: 'POST', url, payload, cookies });
const get = (url, cookies = {}) => app.inject({ method: 'GET', url, cookies });
const cookie = (reponse, nom) => reponse.cookies.find((c) => c.name === nom);
const session = (reponse) => ({ absences_session: cookie(reponse, 'absences_session').value });

async function creerCompte(prenom, role = 'collaborateur') {
  const { rows } = await pool.query(
    'INSERT INTO collaborateurs (email, nom, prenom, equipe_id, role) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [`${prenom.toLowerCase()}@exemple.test`, 'Test', prenom, ids.equipe, role],
  );
  return rows[0].id;
}

// Demande un lien par e-mail, puis définit le mot de passe avec ce lien.
async function definirMotDePasse(email, motDePasse = MOT_DE_PASSE) {
  courriels.length = 0;
  await post('/api/auth/mot-de-passe/oubli', { email });
  const jeton = new URL(courriels[0].texte.match(/http\S+/)[0]).searchParams.get('jeton');
  return post('/api/auth/mot-de-passe/definir', { jeton, motDePasse });
}

const connecter = (email, motDePasse = MOT_DE_PASSE) => post('/api/auth/connexion', { email, motDePasse });

before(async () => {
  if (!hote) return;
  baseDeTest = await creerBaseDeTest();
  pool = baseDeTest.api;
  ids.equipe = (await pool.query(`INSERT INTO equipes (nom) VALUES ('Direction') RETURNING id`)).rows[0].id;
  ids.alice = await creerCompte('Alice');
  ids.diane = await creerCompte('Diane', 'directeur');

  fauxMicrosoft = await demarrerFauxMicrosoft({ clientId: 'client-test' });
  app = await construireApp({
    pool,
    config,
    logger: false,
    limites: sansLimite,
    courriel: { envoyer: async (message) => { courriels.push(message); } },
    microsoft: creerMicrosoft({
      emetteur: fauxMicrosoft.emetteur, clientId: 'client-test', clientSecret: 'secret',
      appUrl: config.appUrl, autoriserHttp: true,
    }),
  });
  app.get('/api/test/direction', { preHandler: [app.authentifier, app.exigerRole('directeur')] }, async () => ({ ok: true }));
});

after(async () => {
  await app?.close();
  await fauxMicrosoft?.arreter();
  await baseDeTest?.fermer();
});

test('sans session, /api/auth/moi répond 401', options, async () => {
  assert.equal((await get('/api/auth/moi')).statusCode, 401);
  assert.equal((await get('/api/auth/moi', { absences_session: 'jeton-invente' })).statusCode, 401);
});

test('parcours complet : lien par e-mail, mot de passe, connexion, profil', options, async () => {
  const definition = await definirMotDePasse('alice@exemple.test');
  assert.equal(definition.statusCode, 204);
  assert.equal(courriels[0].a, 'alice@exemple.test');

  const connexion = await connecter('Alice@Exemple.test'); // la casse de l'e-mail est ignorée
  assert.equal(connexion.statusCode, 204);
  const temoin = cookie(connexion, 'absences_session');
  assert.equal(temoin.httpOnly, true);
  assert.equal(temoin.sameSite, 'Lax');
  assert.equal(temoin.path, '/');

  const moi = await get('/api/auth/moi', session(connexion));
  assert.equal(moi.statusCode, 200);
  assert.deepEqual(moi.json(), {
    id: Number(ids.alice), email: 'alice@exemple.test', nom: 'Test', prenom: 'Alice',
    role: 'collaborateur', equipe: { id: Number(ids.equipe), nom: 'Direction' },
  });
});

test('le jeton de session et le mot de passe ne sont pas stockés en clair', options, async () => {
  const connexion = await connecter('alice@exemple.test');
  const jeton = cookie(connexion, 'absences_session').value;
  const sessions = await pool.query('SELECT jeton_hash FROM sessions');
  assert.ok(sessions.rows.every((ligne) => ligne.jeton_hash !== jeton));
  const compte = await pool.query('SELECT mot_de_passe_hash FROM collaborateurs WHERE id = $1', [ids.alice]);
  assert.match(compte.rows[0].mot_de_passe_hash, /^scrypt\$/);
});

test('identifiants incorrects : même réponse dans tous les cas', options, async () => {
  const mauvais = await connecter('alice@exemple.test', 'mauvais mot de passe');
  const inconnu = await connecter('personne@exemple.test');
  const sansMotDePasse = await connecter('diane@exemple.test');
  for (const reponse of [mauvais, inconnu, sansMotDePasse]) {
    assert.equal(reponse.statusCode, 401);
    assert.equal(reponse.json().erreur, 'E-mail ou mot de passe incorrect');
    assert.equal(cookie(reponse, 'absences_session'), undefined);
  }
});

test('un lien de mot de passe ne sert qu\'une fois, expire, et impose 12 caractères', options, async () => {
  courriels.length = 0;
  await post('/api/auth/mot-de-passe/oubli', { email: 'alice@exemple.test' });
  const jeton = new URL(courriels[0].texte.match(/http\S+/)[0]).searchParams.get('jeton');

  assert.equal((await post('/api/auth/mot-de-passe/definir', { jeton, motDePasse: 'trop court' })).statusCode, 400);
  assert.equal((await post('/api/auth/mot-de-passe/definir', { jeton, motDePasse: MOT_DE_PASSE })).statusCode, 204);
  assert.equal((await post('/api/auth/mot-de-passe/definir', { jeton, motDePasse: MOT_DE_PASSE })).statusCode, 400);
  assert.equal((await post('/api/auth/mot-de-passe/definir', { jeton: 'invente', motDePasse: MOT_DE_PASSE })).statusCode, 400);

  courriels.length = 0;
  await post('/api/auth/mot-de-passe/oubli', { email: 'alice@exemple.test' });
  const expire = new URL(courriels[0].texte.match(/http\S+/)[0]).searchParams.get('jeton');
  await pool.query(`UPDATE jetons_mot_de_passe SET expire_le = now() - interval '1 minute' WHERE utilise_le IS NULL`);
  assert.equal((await post('/api/auth/mot-de-passe/definir', { jeton: expire, motDePasse: MOT_DE_PASSE })).statusCode, 400);
});

test('mot de passe oublié pour un e-mail inconnu : même réponse, aucun e-mail', options, async () => {
  courriels.length = 0;
  assert.equal((await post('/api/auth/mot-de-passe/oubli', { email: 'personne@exemple.test' })).statusCode, 204);
  assert.equal(courriels.length, 0);
});

test('changer le mot de passe ferme les sessions ouvertes', options, async () => {
  const avant = await connecter('alice@exemple.test');
  assert.equal((await get('/api/auth/moi', session(avant))).statusCode, 200);
  await definirMotDePasse('alice@exemple.test', 'un nouveau mot de passe');
  assert.equal((await get('/api/auth/moi', session(avant))).statusCode, 401);
  assert.equal((await connecter('alice@exemple.test')).statusCode, 401);
  assert.equal((await connecter('alice@exemple.test', 'un nouveau mot de passe')).statusCode, 204);
  await definirMotDePasse('alice@exemple.test'); // remet le mot de passe des autres tests
});

test('la déconnexion invalide la session côté serveur', options, async () => {
  const connexion = await connecter('alice@exemple.test');
  const deconnexion = await post('/api/auth/deconnexion', undefined, session(connexion));
  assert.equal(deconnexion.statusCode, 204);
  assert.equal(cookie(deconnexion, 'absences_session').value, '');
  // Le cookie rejoué ne fonctionne plus.
  assert.equal((await get('/api/auth/moi', session(connexion))).statusCode, 401);
});

test('une session expirée est refusée', options, async () => {
  const connexion = await connecter('alice@exemple.test');
  await pool.query(`UPDATE sessions SET expire_le = now() - interval '1 second' WHERE collaborateur_id = $1`, [ids.alice]);
  assert.equal((await get('/api/auth/moi', session(connexion))).statusCode, 401);
});

test('un compte désactivé perd sa session et ne peut plus se connecter', options, async () => {
  const id = await creerCompte('Bruno');
  await definirMotDePasse('bruno@exemple.test');
  const connexion = await connecter('bruno@exemple.test');
  assert.equal((await get('/api/auth/moi', session(connexion))).statusCode, 200);
  await pool.query('UPDATE collaborateurs SET actif = false WHERE id = $1', [id]);
  assert.equal((await get('/api/auth/moi', session(connexion))).statusCode, 401);
  assert.equal((await connecter('bruno@exemple.test')).statusCode, 401);
  courriels.length = 0;
  await post('/api/auth/mot-de-passe/oubli', { email: 'bruno@exemple.test' });
  assert.equal(courriels.length, 0);
});

test('exigerRole réserve une route à un rôle', options, async () => {
  const alice = await connecter('alice@exemple.test');
  assert.equal((await get('/api/test/direction')).statusCode, 401);
  assert.equal((await get('/api/test/direction', session(alice))).statusCode, 403);
  await definirMotDePasse('diane@exemple.test');
  const diane = await connecter('diane@exemple.test');
  assert.equal((await get('/api/test/direction', session(diane))).statusCode, 200);
});

test('les tentatives de connexion sont limitées', options, async () => {
  const limitee = await construireApp({
    pool, config, logger: false, courriel: { envoyer: async () => {} },
    limites: { connexion: { max: 3, timeWindow: '1 minute' }, oubli: { max: 3, timeWindow: '1 minute' } },
  });
  const essai = () => limitee.inject({
    method: 'POST', url: '/api/auth/connexion', payload: { email: 'alice@exemple.test', motDePasse: 'faux' },
  });
  const statuts = [];
  for (let i = 0; i < 5; i++) statuts.push((await essai()).statusCode);
  assert.deepEqual(statuts, [401, 401, 401, 429, 429]);
  await limitee.close();
});

// --- Connexion Microsoft, contre un faux fournisseur OpenID Connect ----------

async function allerChezMicrosoft() {
  const depart = await get('/api/auth/microsoft');
  assert.equal(depart.statusCode, 302);
  return { depart, temoin: { absences_oidc: cookie(depart, 'absences_oidc').value } };
}

const retour = ({ code, state }, cookies) =>
  get(`/api/auth/microsoft/retour?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`, cookies);

test('Microsoft : la demande part avec PKCE, état et nonce', options, async () => {
  const { depart } = await allerChezMicrosoft();
  const demande = new URL(depart.headers.location);
  assert.equal(demande.origin, fauxMicrosoft.emetteur);
  assert.equal(demande.searchParams.get('redirect_uri'), 'http://app.test/api/auth/microsoft/retour');
  assert.equal(demande.searchParams.get('code_challenge_method'), 'S256');
  for (const cle of ['code_challenge', 'state', 'nonce']) assert.ok(demande.searchParams.get(cle));
  assert.equal(cookie(depart, 'absences_oidc').httpOnly, true);
});

test('Microsoft : première connexion rattachée par e-mail, les suivantes par identifiant', options, async () => {
  const id = await creerCompte('Carla');
  const premiere = await allerChezMicrosoft();
  const reponse = await retour(
    fauxMicrosoft.autoriser(premiere.depart.headers.location, { oid: 'oid-carla', preferred_username: 'Carla@exemple.test' }),
    premiere.temoin,
  );
  assert.equal(reponse.statusCode, 302);
  assert.equal(reponse.headers.location, '/');
  assert.equal((await get('/api/auth/moi', session(reponse))).json().prenom, 'Carla');
  const compte = await pool.query('SELECT microsoft_oid FROM collaborateurs WHERE id = $1', [id]);
  assert.equal(compte.rows[0].microsoft_oid, 'oid-carla');

  // L'adresse e-mail change dans l'annuaire : l'identifiant Microsoft suffit.
  const seconde = await allerChezMicrosoft();
  const suivante = await retour(
    fauxMicrosoft.autoriser(seconde.depart.headers.location, { oid: 'oid-carla', preferred_username: 'carla.autre@exemple.test' }),
    seconde.temoin,
  );
  assert.equal(suivante.headers.location, '/');
  assert.equal((await get('/api/auth/moi', session(suivante))).json().id, Number(id));
});

test('Microsoft : un compte inconnu de l\'outil est refusé', options, async () => {
  const { depart, temoin } = await allerChezMicrosoft();
  const reponse = await retour(
    fauxMicrosoft.autoriser(depart.headers.location, { oid: 'oid-inconnu', preferred_username: 'intrus@exemple.test' }),
    temoin,
  );
  assert.equal(reponse.headers.location, '/connexion?erreur=compte-inconnu');
  assert.equal(cookie(reponse, 'absences_session'), undefined);
});

test('Microsoft : une autre identité ne peut pas prendre un compte déjà lié', options, async () => {
  const { depart, temoin } = await allerChezMicrosoft();
  const reponse = await retour(
    fauxMicrosoft.autoriser(depart.headers.location, { oid: 'oid-usurpateur', email: 'carla@exemple.test' }),
    temoin,
  );
  assert.equal(reponse.headers.location, '/connexion?erreur=compte-inconnu');
});

test('Microsoft : état falsifié, cookie absent ou code rejoué sont refusés', options, async () => {
  const identite = { oid: 'oid-carla', preferred_username: 'carla@exemple.test' };

  const a = await allerChezMicrosoft();
  const parametresA = fauxMicrosoft.autoriser(a.depart.headers.location, identite);
  const falsifie = await retour({ ...parametresA, state: 'autre-etat' }, a.temoin);
  assert.equal(falsifie.headers.location, '/connexion?erreur=microsoft');

  const b = await allerChezMicrosoft();
  const parametresB = fauxMicrosoft.autoriser(b.depart.headers.location, identite);
  const sansCookie = await retour(parametresB, {});
  assert.equal(sansCookie.headers.location, '/connexion?erreur=microsoft');

  // Le retour d'une autre personne (autre cookie, donc autre vérifieur PKCE) est refusé.
  const c = await allerChezMicrosoft();
  const d = await allerChezMicrosoft();
  const parametresC = fauxMicrosoft.autoriser(c.depart.headers.location, identite);
  const croise = await retour({ code: parametresC.code, state: new URL(d.depart.headers.location).searchParams.get('state') }, d.temoin);
  assert.equal(croise.headers.location, '/connexion?erreur=microsoft');

  for (const reponse of [falsifie, sansCookie, croise]) assert.equal(cookie(reponse, 'absences_session'), undefined);
});

test('sans configuration Microsoft, les routes répondent 404', options, async () => {
  const sans = await construireApp({ pool, config, logger: false, courriel: { envoyer: async () => {} } });
  assert.deepEqual((await sans.inject({ method: 'GET', url: '/api/auth/config' })).json(), { microsoft: false, autologin: false });
  assert.equal((await sans.inject({ method: 'GET', url: '/api/auth/microsoft' })).statusCode, 404);
  assert.deepEqual((await get('/api/auth/config')).json(), { microsoft: true, autologin: false });
  await sans.close();
});

// --- Script de création du premier directeur ---------------------------------

test('creer-directeur crée le premier directeur et refuse d\'en créer un second', options, async () => {
  const autre = await creerBaseDeTest();
  try {
    const { host, port, database, user, password } = autre.connexionApi;
    const env = {
      ...process.env, DB_HOST: host, DB_PORT: String(port), DB_NAME: database, DB_USER: user, DB_PASSWORD: password,
      APP_URL: 'http://app.test', SMTP_HOST: 'smtp.invalid', SMTP_FROM: 'absences@exemple.test',
    };
    const lancer = (...args) => promisify(execFile)(process.execPath, ['scripts/creer-directeur.js', ...args], { env });

    const { stdout } = await lancer('chef@exemple.test', 'Chantal', 'Chef');
    const lien = stdout.match(/http\S+/)[0];
    assert.match(lien, /^http:\/\/app\.test\/definir-mot-de-passe\?jeton=/);
    const cree = await autre.api.query(
      `SELECT c.role, e.nom AS equipe, e.responsable_id = c.id AS responsable
       FROM collaborateurs c JOIN equipes e ON e.id = c.equipe_id WHERE c.email = 'chef@exemple.test'`,
    );
    assert.deepEqual(cree.rows[0], { role: 'directeur', equipe: 'Direction', responsable: true });

    // Le lien affiché permet bien de définir le mot de passe puis de se connecter.
    const autreApp = await construireApp({
      pool: autre.api, config, logger: false, limites: sansLimite, courriel: { envoyer: async () => {} },
    });
    const jeton = new URL(lien).searchParams.get('jeton');
    const definition = await autreApp.inject({
      method: 'POST', url: '/api/auth/mot-de-passe/definir', payload: { jeton, motDePasse: MOT_DE_PASSE },
    });
    assert.equal(definition.statusCode, 204);
    const connexion = await autreApp.inject({
      method: 'POST', url: '/api/auth/connexion', payload: { email: 'chef@exemple.test', motDePasse: MOT_DE_PASSE },
    });
    assert.equal(connexion.statusCode, 204);
    await autreApp.close();

    await assert.rejects(lancer('second@exemple.test', 'Sam', 'Second'), /Un directeur existe déjà/);
  } finally {
    await autre.fermer();
  }
});
