// Tests de l'administration contre une vraie base (ignorés si TEST_DB_HOST n'est pas défini).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { construireApp } from '../src/app.js';
import { hacher } from '../src/auth/mots-de-passe.js';
import { creerBaseDeTest, hote, options } from './aide-base.js';

const config = { appUrl: 'http://app.test', cookieSecure: false, sessionDureeHeures: 12 };
const sansLimite = { connexion: { max: 10000, timeWindow: '1 minute' }, oubli: { max: 10000, timeWindow: '1 minute' } };
const MOT_DE_PASSE = 'un mot de passe solide';

let baseDeTest;
let pool;
let app;
let directrice; // cookies de session de la directrice
let courrielEnPanne = false;
const courriels = [];
const ids = {};

const appel = (method, url, payload, cookies = directrice) => app.inject({ method, url, payload, cookies });
const lister = async (quoi) => (await appel('GET', `/api/admin/${quoi}`)).json();

async function connecter(email) {
  const reponse = await app.inject({ method: 'POST', url: '/api/auth/connexion', payload: { email, motDePasse: MOT_DE_PASSE } });
  assert.equal(reponse.statusCode, 204);
  return { absences_session: reponse.cookies.find((c) => c.name === 'absences_session').value };
}

async function creer(quoi, corps) {
  const reponse = await appel('POST', `/api/admin/${quoi}`, corps);
  assert.equal(reponse.statusCode, 201, reponse.body);
  return reponse.json();
}

before(async () => {
  if (!hote) return;
  baseDeTest = await creerBaseDeTest();
  pool = baseDeTest.api;
  ids.direction = (await pool.query(`INSERT INTO equipes (nom) VALUES ('Direction') RETURNING id`)).rows[0].id;
  const hachage = await hacher(MOT_DE_PASSE);
  ids.diane = Number((await pool.query(
    `INSERT INTO collaborateurs (email, nom, prenom, equipe_id, role, mot_de_passe_hash)
     VALUES ('diane@exemple.test', 'Martin', 'Diane', $1, 'directeur', $2) RETURNING id`,
    [ids.direction, hachage],
  )).rows[0].id);
  ids.direction = Number(ids.direction);

  app = await construireApp({
    pool, config, logger: false, limites: sansLimite,
    courriel: {
      envoyer: async (message) => {
        if (courrielEnPanne) throw new Error('SMTP injoignable');
        courriels.push(message);
      },
    },
  });
  directrice = await connecter('diane@exemple.test');
});

after(async () => {
  await app?.close();
  await baseDeTest?.fermer();
});

test('l\'administration est réservée aux directeurs', options, async () => {
  const routes = [
    ['GET', '/api/admin/equipes'], ['GET', '/api/admin/collaborateurs'], ['GET', '/api/admin/types-absence'],
    ['POST', '/api/admin/equipes'], ['PATCH', '/api/admin/collaborateurs/1'], ['DELETE', '/api/admin/types-absence/1'],
  ];
  for (const [methode, url] of routes) {
    assert.equal((await appel(methode, url, { nom: 'x' }, {})).statusCode, 401, `${methode} ${url}`);
  }

  for (const role of ['collaborateur', 'responsable']) {
    const email = `${role}@exemple.test`;
    await pool.query(
      `INSERT INTO collaborateurs (email, nom, prenom, equipe_id, role, mot_de_passe_hash) VALUES ($1, 'Test', $2, $3, $2, $4)`,
      [email, role, ids.direction, await hacher(MOT_DE_PASSE)],
    );
    const session = await connecter(email);
    for (const [methode, url] of routes) {
      assert.equal((await appel(methode, url, { nom: 'x' }, session)).statusCode, 403, `${role} ${methode} ${url}`);
    }
  }
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM equipes`)).rows[0].n, 1);
});

// --- Équipes -----------------------------------------------------------------

test('équipes : création, arborescence et liste', options, async () => {
  const technique = await creer('equipes', { nom: '  Technique  ', parentId: ids.direction });
  assert.deepEqual(technique, {
    id: technique.id, nom: 'Technique', parentId: ids.direction, responsableId: null,
    actif: true, nbCollaborateurs: 0, delegueIds: [], delegations: [],
  });
  const dev = await creer('equipes', { nom: 'Développement', parentId: technique.id });
  ids.technique = technique.id;
  ids.dev = dev.id;

  const equipes = await lister('equipes');
  assert.deepEqual(equipes.map((e) => e.nom), ['Développement', 'Direction', 'Technique']);
  assert.equal(equipes.find((e) => e.id === ids.direction).nbCollaborateurs, 3);
});

test('équipes : doublon, boucle et références inconnues sont refusés', options, async () => {
  const doublon = await appel('POST', '/api/admin/equipes', { nom: 'technique' });
  assert.equal(doublon.statusCode, 409);
  assert.equal(doublon.json().erreur, 'Une équipe porte déjà ce nom');

  const boucle = await appel('PATCH', `/api/admin/equipes/${ids.technique}`, { parentId: ids.dev });
  assert.equal(boucle.statusCode, 409);
  assert.match(boucle.json().erreur, /sous-équipes/);

  assert.equal((await appel('POST', '/api/admin/equipes', { nom: 'Orpheline', parentId: 99999 })).statusCode, 400);
  assert.equal((await appel('POST', '/api/admin/equipes', { nom: '   ' })).statusCode, 400);
  assert.equal((await appel('PATCH', '/api/admin/equipes/99999', { nom: 'X' })).statusCode, 404);
  assert.equal((await appel('PATCH', `/api/admin/equipes/${ids.dev}`, {})).statusCode, 400);
});

test('équipes : le responsable et les délégués doivent pouvoir valider', options, async () => {
  const alice = await creer('collaborateurs', { email: 'alice@exemple.test', nom: 'Durand', prenom: 'Alice', equipeId: ids.dev });
  const bob = await creer('collaborateurs', { email: 'bob@exemple.test', nom: 'Petit', prenom: 'Bob', equipeId: ids.technique, role: 'responsable' });
  const carla = await creer('collaborateurs', { email: 'carla@exemple.test', nom: 'Roux', prenom: 'Carla', equipeId: ids.technique, role: 'responsable' });
  Object.assign(ids, { alice: alice.id, bob: bob.id, carla: carla.id });

  const refus = await appel('PATCH', `/api/admin/equipes/${ids.dev}`, { responsableId: alice.id });
  assert.equal(refus.statusCode, 400);
  assert.match(refus.json().erreur, /Alice Durand doit être actif et avoir le rôle responsable ou directeur/);

  const ok = await appel('PATCH', `/api/admin/equipes/${ids.dev}`, { responsableId: bob.id });
  assert.equal(ok.json().responsableId, bob.id);

  assert.equal((await appel('PUT', `/api/admin/equipes/${ids.dev}/delegues`, { delegueIds: [alice.id] })).statusCode, 400);
  const delegues = await appel('PUT', `/api/admin/equipes/${ids.dev}/delegues`, { delegueIds: [carla.id, ids.diane] });
  assert.deepEqual(delegues.json().delegueIds, [ids.diane, carla.id].sort((a, b) => a - b));
  // La liste est remplacée, pas complétée.
  const remplace = await appel('PUT', `/api/admin/equipes/${ids.dev}/delegues`, { delegueIds: [carla.id] });
  assert.deepEqual(remplace.json().delegueIds, [carla.id]);
});

test('équipes : désactivation et suppression protégées', options, async () => {
  const occupee = await appel('PATCH', `/api/admin/equipes/${ids.dev}`, { actif: false });
  assert.equal(occupee.statusCode, 409);
  assert.match(occupee.json().erreur, /encore des collaborateurs/);
  const parente = await appel('PATCH', `/api/admin/equipes/${ids.direction}`, { actif: false });
  assert.equal(parente.statusCode, 409);

  const suppression = await appel('DELETE', `/api/admin/equipes/${ids.dev}`);
  assert.equal(suppression.statusCode, 409);
  assert.match(suppression.json().erreur, /désactivez-la plutôt/);

  const vide = await creer('equipes', { nom: 'Vide' });
  assert.equal((await appel('PATCH', `/api/admin/equipes/${vide.id}`, { actif: false })).json().actif, false);
  // On ne rattache pas un collaborateur à une équipe désactivée.
  const rattachement = await appel('PATCH', `/api/admin/collaborateurs/${ids.alice}`, { equipeId: vide.id });
  assert.equal(rattachement.statusCode, 400);
  assert.equal((await appel('DELETE', `/api/admin/equipes/${vide.id}`)).statusCode, 204);
  assert.equal((await appel('DELETE', `/api/admin/equipes/${vide.id}`)).statusCode, 404);
});

// --- Collaborateurs ----------------------------------------------------------

test('collaborateurs : création, invitation par e-mail et liste', options, async () => {
  courriels.length = 0;
  const emma = await creer('collaborateurs', {
    email: ' Emma@exemple.test ', nom: 'Blanc', prenom: 'Emma', equipeId: ids.dev, inviter: true,
  });
  assert.deepEqual(emma, {
    id: emma.id, email: 'Emma@exemple.test', nom: 'Blanc', prenom: 'Emma', equipeId: ids.dev,
    role: 'collaborateur', actif: true, aMotDePasse: false, aMicrosoft: false, invitationEnvoyee: true,
  });
  ids.emma = emma.id;
  assert.equal(courriels.length, 1);
  assert.equal(courriels[0].a, 'Emma@exemple.test');

  // Le lien de l'invitation permet de choisir son mot de passe, puis de se connecter.
  const jeton = new URL(courriels[0].texte.match(/http\S+/)[0]).searchParams.get('jeton');
  const definition = await app.inject({
    method: 'POST', url: '/api/auth/mot-de-passe/definir', payload: { jeton, motDePasse: MOT_DE_PASSE },
  });
  assert.equal(definition.statusCode, 204);
  ids.sessionEmma = await connecter('emma@exemple.test');

  const liste = await lister('collaborateurs');
  assert.equal(liste.find((c) => c.id === emma.id).aMotDePasse, true);
  // Aucun secret ne sort de l'API.
  assert.ok(!JSON.stringify(liste).includes('scrypt'));
  assert.deepEqual(liste.map((c) => c.nom), [...liste.map((c) => c.nom)].sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' })));
});

test('collaborateurs : données invalides et doublons refusés', options, async () => {
  const base = { email: 'neuf@exemple.test', nom: 'Neuf', prenom: 'Nina', equipeId: ids.dev };
  assert.equal((await appel('POST', '/api/admin/collaborateurs', { ...base, email: 'pas-un-email' })).statusCode, 400);
  assert.equal((await appel('POST', '/api/admin/collaborateurs', { ...base, role: 'administrateur' })).statusCode, 400);
  assert.equal((await appel('POST', '/api/admin/collaborateurs', { ...base, equipeId: 99999 })).statusCode, 400);
  assert.equal((await appel('POST', '/api/admin/collaborateurs', { ...base, nom: undefined })).statusCode, 400);
  // Les champs inconnus ou sensibles sont ignorés : rien n'est modifié.
  assert.equal((await appel('PATCH', `/api/admin/collaborateurs/${ids.alice}`, { mot_de_passe_hash: 'x' })).statusCode, 400);
  const melange = await appel('PATCH', `/api/admin/collaborateurs/${ids.alice}`, { prenom: 'Alice', mot_de_passe_hash: 'x' });
  assert.equal(melange.statusCode, 200);
  const stocke = await pool.query('SELECT mot_de_passe_hash FROM collaborateurs WHERE id = $1', [ids.alice]);
  assert.equal(stocke.rows[0].mot_de_passe_hash, null);

  const doublon = await appel('POST', '/api/admin/collaborateurs', { ...base, email: 'ALICE@exemple.test' });
  assert.equal(doublon.statusCode, 409);
  assert.equal(doublon.json().erreur, 'Un collaborateur a déjà cette adresse e-mail');
  assert.equal((await appel('PATCH', '/api/admin/collaborateurs/99999', { nom: 'X' })).statusCode, 404);
});

test('collaborateurs : modification partielle', options, async () => {
  const modifie = await appel('PATCH', `/api/admin/collaborateurs/${ids.alice}`, { nom: ' Dupont ', equipeId: ids.technique });
  assert.equal(modifie.statusCode, 200);
  assert.equal(modifie.json().nom, 'Dupont');
  assert.equal(modifie.json().equipeId, ids.technique);
  assert.equal(modifie.json().prenom, 'Alice');
  await appel('PATCH', `/api/admin/collaborateurs/${ids.alice}`, { equipeId: ids.dev });
});

test('collaborateurs : un directeur ne peut pas se retirer lui-même', options, async () => {
  for (const corps of [{ actif: false }, { role: 'responsable' }]) {
    const reponse = await appel('PATCH', `/api/admin/collaborateurs/${ids.diane}`, corps);
    assert.equal(reponse.statusCode, 409);
    assert.match(reponse.json().erreur, /propre rôle/);
  }
  assert.equal((await appel('PATCH', `/api/admin/collaborateurs/${ids.diane}`, { prenom: 'Diane' })).statusCode, 200);
});

test('collaborateurs : le responsable d\'une équipe ne peut être ni rétrogradé ni désactivé', options, async () => {
  for (const corps of [{ role: 'collaborateur' }, { actif: false }]) {
    const reponse = await appel('PATCH', `/api/admin/collaborateurs/${ids.bob}`, corps);
    assert.equal(reponse.statusCode, 409);
    assert.match(reponse.json().erreur, /responsable de « Développement »/);
  }
});

test('collaborateurs : rétrograder un délégué retire ses délégations', options, async () => {
  const reponse = await appel('PATCH', `/api/admin/collaborateurs/${ids.carla}`, { role: 'collaborateur' });
  assert.equal(reponse.statusCode, 200);
  const dev = (await lister('equipes')).find((e) => e.id === ids.dev);
  assert.deepEqual(dev.delegueIds, []);
});

test('collaborateurs : la désactivation ferme la session et bloque la connexion', options, async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/api/auth/moi', cookies: ids.sessionEmma })).statusCode, 200);
  const reponse = await appel('PATCH', `/api/admin/collaborateurs/${ids.emma}`, { actif: false });
  assert.equal(reponse.json().actif, false);
  assert.equal((await app.inject({ method: 'GET', url: '/api/auth/moi', cookies: ids.sessionEmma })).statusCode, 401);
  const sessions = await pool.query('SELECT count(*)::int AS n FROM sessions WHERE collaborateur_id = $1', [ids.emma]);
  assert.equal(sessions.rows[0].n, 0);
  const connexion = await app.inject({
    method: 'POST', url: '/api/auth/connexion', payload: { email: 'emma@exemple.test', motDePasse: MOT_DE_PASSE },
  });
  assert.equal(connexion.statusCode, 401);
  assert.equal((await appel('POST', `/api/admin/collaborateurs/${ids.emma}/invitation`)).statusCode, 409);
});

test('collaborateurs : invitation renvoyée, et panne d\'e-mail signalée', options, async () => {
  courriels.length = 0;
  assert.equal((await appel('POST', `/api/admin/collaborateurs/${ids.alice}/invitation`)).statusCode, 204);
  assert.equal(courriels[0].a, 'alice@exemple.test');

  courrielEnPanne = true;
  try {
    const envoi = await appel('POST', `/api/admin/collaborateurs/${ids.alice}/invitation`);
    assert.equal(envoi.statusCode, 502);
    // À la création, le compte est tout de même créé et la panne est signalée.
    const cree = await creer('collaborateurs', {
      email: 'fred@exemple.test', nom: 'Noir', prenom: 'Fred', equipeId: ids.dev, inviter: true,
    });
    assert.equal(cree.invitationEnvoyee, false);
  } finally {
    courrielEnPanne = false;
  }
});

// --- Types d'absence ---------------------------------------------------------

test('types d\'absence : liste de départ, création et modification', options, async () => {
  const types = await lister('types-absence');
  assert.deepEqual(types.map((t) => t.libelle), [
    'Congés payés', 'RTT', 'Congés spéciaux', 'Sans solde', 'Maladie', 'Jour non travaillé (temps partiel)',
  ]);

  const formation = await creer('types-absence', { libelle: ' Formation ', delaiPrevenanceJours: 15 });
  assert.deepEqual(formation, {
    id: formation.id, libelle: 'Formation', approbationRequise: true, confidentiel: false,
    delaiPrevenanceJours: 15, actif: true, ordre: 70, utilise: false,
  });
  ids.formation = formation.id;

  const modifie = await appel('PATCH', `/api/admin/types-absence/${formation.id}`, {
    approbationRequise: false, delaiPrevenanceJours: null, actif: false,
  });
  assert.equal(modifie.statusCode, 200);
  assert.deepEqual(
    [modifie.json().approbationRequise, modifie.json().delaiPrevenanceJours, modifie.json().actif, modifie.json().libelle],
    [false, null, false, 'Formation'],
  );
});

test('types d\'absence : doublon et valeurs invalides refusés', options, async () => {
  const doublon = await appel('POST', '/api/admin/types-absence', { libelle: 'maladie' });
  assert.equal(doublon.statusCode, 409);
  assert.equal(doublon.json().erreur, "Un type d'absence porte déjà ce libellé");
  assert.equal((await appel('POST', '/api/admin/types-absence', { libelle: 'X', delaiPrevenanceJours: -1 })).statusCode, 400);
  assert.equal((await appel('POST', '/api/admin/types-absence', { libelle: '' })).statusCode, 400);
  assert.equal((await appel('PATCH', '/api/admin/types-absence/99999', { libelle: 'X' })).statusCode, 404);
});

test('types d\'absence : un type utilisé ne se supprime pas, un type libre oui', options, async () => {
  const conges = (await lister('types-absence')).find((t) => t.libelle === 'Congés payés');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO demandes (collaborateur_id, equipe_id, type_id, date_debut, date_fin, duree_demi_journees, saisie_par_id)
       VALUES ($1, $2, $3, '2030-03-04', '2030-03-05', 4, $1) RETURNING id`,
      [ids.alice, ids.dev, conges.id],
    );
    await client.query(`INSERT INTO evenements_demande (demande_id, type, auteur_id) VALUES ($1, 'soumission', $2)`, [rows[0].id, ids.alice]);
    await client.query('COMMIT');
  } finally {
    client.release();
  }

  assert.equal((await lister('types-absence')).find((t) => t.id === conges.id).utilise, true);
  const refus = await appel('DELETE', `/api/admin/types-absence/${conges.id}`);
  assert.equal(refus.statusCode, 409);
  assert.match(refus.json().erreur, /désactivez-le plutôt/);

  assert.equal((await appel('DELETE', `/api/admin/types-absence/${ids.formation}`)).statusCode, 204);
  assert.equal((await appel('DELETE', `/api/admin/types-absence/${ids.formation}`)).statusCode, 404);
});
