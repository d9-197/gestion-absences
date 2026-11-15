// Tests du calendrier contre une vraie base (ignorés si TEST_DB_HOST n'est pas défini).
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
const sessions = {};
const ids = {};

const appel = (method, url, payload, cookies = sessions.diane) => app.inject({ method, url, payload, cookies });
const annee = async (an) => (await appel('GET', `/api/admin/calendrier?annee=${an}`)).json();
const duree = async (qui, corps) => (await appel('POST', '/api/calendrier/duree', corps, sessions[qui])).json();

before(async () => {
  if (!hote) return;
  baseDeTest = await creerBaseDeTest();
  pool = baseDeTest.api;
  const equipe = async (nom, parent = null) =>
    Number((await pool.query('INSERT INTO equipes (nom, parent_id) VALUES ($1, $2) RETURNING id', [nom, parent])).rows[0].id);
  ids.direction = await equipe('Direction');
  ids.technique = await equipe('Technique', ids.direction);
  ids.dev = await equipe('Développement', ids.technique);
  ids.commerce = await equipe('Commerce', ids.direction);

  app = await construireApp({ pool, config, logger: false, limites: sansLimite, courriel: { envoyer: async () => {} } });
  const hachage = await hacher(MOT_DE_PASSE);
  for (const [prenom, equipeId, role] of [
    ['diane', ids.direction, 'directeur'], ['alice', ids.dev, 'collaborateur'],
    ['bob', ids.technique, 'responsable'], ['chloe', ids.commerce, 'collaborateur'],
  ]) {
    await pool.query(
      'INSERT INTO collaborateurs (email, nom, prenom, equipe_id, role, mot_de_passe_hash) VALUES ($1, $2, $2, $3, $4, $5)',
      [`${prenom}@exemple.test`, prenom, equipeId, role, hachage],
    );
    const connexion = await app.inject({
      method: 'POST', url: '/api/auth/connexion', payload: { email: `${prenom}@exemple.test`, motDePasse: MOT_DE_PASSE },
    });
    sessions[prenom] = { absences_session: connexion.cookies.find((c) => c.name === 'absences_session').value };
  }
});

after(async () => {
  await app?.close();
  await baseDeTest?.fermer();
});

test('les dates sont lues comme du texte, sans décalage de fuseau', options, async () => {
  const { rows } = await pool.query(`SELECT DATE '2026-03-29' AS jour`);
  assert.equal(rows[0].jour, '2026-03-29');
});

test('une année est préremplie à sa première consultation', options, async () => {
  const calendrier = await annee(2026);
  assert.equal(calendrier.annee, 2026);
  assert.equal(calendrier.joursFeries.length, 11);
  assert.deepEqual(calendrier.joursFeries[1], { jour: '2026-04-06', libelle: 'Lundi de Pâques' });
  assert.deepEqual(calendrier.joursImposes, []);
});

test('un jour férié supprimé n\'est pas recréé, sauf rétablissement demandé', options, async () => {
  // Journée de solidarité : le lundi de Pentecôte est travaillé.
  assert.equal((await appel('DELETE', '/api/admin/jours-feries/2026-05-25')).statusCode, 204);
  assert.equal((await appel('DELETE', '/api/admin/jours-feries/2026-05-25')).statusCode, 404);
  assert.equal((await annee(2026)).joursFeries.length, 10);

  // Un autre processus (cache vide) ne le recrée pas non plus.
  const autre = await construireApp({ pool: baseDeTest.proprietaire, config, logger: false, courriel: { envoyer: async () => {} } });
  await autre.inject({ method: 'GET', url: '/api/admin/calendrier?annee=2026', cookies: sessions.diane });
  await autre.close();
  assert.equal((await annee(2026)).joursFeries.length, 10);

  const retabli = await appel('POST', '/api/admin/jours-feries/retablir', { annee: 2026 });
  assert.deepEqual(retabli.json(), { ajoutes: 1 });
  assert.equal((await annee(2026)).joursFeries.length, 11);
  assert.deepEqual((await appel('POST', '/api/admin/jours-feries/retablir', { annee: 2026 })).json(), { ajoutes: 0 });
});

test('jours fériés : ajout, renommage, doublon et dates invalides', options, async () => {
  const ajout = await appel('POST', '/api/admin/jours-feries', { jour: '2026-12-26', libelle: ' Saint-Étienne ' });
  assert.equal(ajout.statusCode, 201);
  assert.deepEqual(ajout.json(), { jour: '2026-12-26', libelle: 'Saint-Étienne' });

  const renomme = await appel('PATCH', '/api/admin/jours-feries/2026-12-26', { libelle: 'Lendemain de Noël' });
  assert.equal(renomme.json().libelle, 'Lendemain de Noël');
  // Le rétablissement ne touche pas aux jours ajoutés ou renommés.
  await appel('POST', '/api/admin/jours-feries/retablir', { annee: 2026 });
  assert.equal((await annee(2026)).joursFeries.at(-1).libelle, 'Lendemain de Noël');

  const doublon = await appel('POST', '/api/admin/jours-feries', { jour: '2026-12-25', libelle: 'Noël bis' });
  assert.equal(doublon.statusCode, 409);
  assert.equal(doublon.json().erreur, 'Ce jour est déjà férié');

  assert.equal((await appel('POST', '/api/admin/jours-feries', { jour: '2026-02-30', libelle: 'X' })).statusCode, 400);
  assert.equal((await appel('POST', '/api/admin/jours-feries', { jour: '26/12/2026', libelle: 'X' })).statusCode, 400);
  assert.equal((await appel('PATCH', '/api/admin/jours-feries/2031-01-02', { libelle: 'X' })).statusCode, 404);
  assert.equal((await appel('GET', '/api/admin/calendrier?annee=1999')).statusCode, 400);
  assert.equal((await appel('DELETE', '/api/admin/jours-feries/2026-12-26')).statusCode, 204);
});

test('jours imposés : création, modification, doublon et suppression', options, async () => {
  const pont = await appel('POST', '/api/admin/jours-imposes', {
    jour: '2026-05-15', libelle: "Pont de l'Ascension", equipeId: null, avecDecompte: true,
  });
  assert.equal(pont.statusCode, 201);
  assert.deepEqual(pont.json(), { id: pont.json().id, jour: '2026-05-15', libelle: "Pont de l'Ascension", equipeId: null, avecDecompte: true });
  ids.pont = pont.json().id;

  const doublon = await appel('POST', '/api/admin/jours-imposes', { jour: '2026-05-15', libelle: 'Bis', equipeId: null, avecDecompte: false });
  assert.equal(doublon.statusCode, 409);
  assert.match(doublon.json().erreur, /existe déjà à cette date/);

  // Même date, autre périmètre : accepté.
  const fermeture = await appel('POST', '/api/admin/jours-imposes', {
    jour: '2026-07-13', libelle: 'Fermeture technique', equipeId: ids.technique, avecDecompte: false,
  });
  assert.equal(fermeture.statusCode, 201);
  ids.fermeture = fermeture.json().id;

  const modifie = await appel('PATCH', `/api/admin/jours-imposes/${ids.pont}`, { avecDecompte: false });
  assert.equal(modifie.json().avecDecompte, false);
  assert.equal(modifie.json().libelle, "Pont de l'Ascension");

  assert.equal((await appel('POST', '/api/admin/jours-imposes', { jour: '2026-05-15', libelle: 'X', equipeId: 99999, avecDecompte: true })).statusCode, 400);
  assert.equal((await appel('POST', '/api/admin/jours-imposes', { jour: '2026-05-15', libelle: 'X' })).statusCode, 400);
  assert.equal((await appel('PATCH', '/api/admin/jours-imposes/99999', { libelle: 'X' })).statusCode, 404);

  assert.deepEqual((await annee(2026)).joursImposes.map((j) => j.jour), ['2026-05-15', '2026-07-13']);
});

test('l\'administration du calendrier est réservée aux directeurs', options, async () => {
  for (const qui of ['alice', 'bob']) {
    assert.equal((await appel('GET', '/api/admin/calendrier?annee=2026', undefined, sessions[qui])).statusCode, 403);
    assert.equal((await appel('DELETE', '/api/admin/jours-feries/2026-12-25', undefined, sessions[qui])).statusCode, 403);
    assert.equal((await appel('DELETE', `/api/admin/jours-imposes/${ids.pont}`, undefined, sessions[qui])).statusCode, 403);
  }
  assert.equal((await appel('GET', '/api/calendrier?debut=2026-01-01&fin=2026-12-31', undefined, {})).statusCode, 401);
});

test('chacun voit le calendrier de son équipe : un jour imposé vaut pour l\'équipe et ses sous-équipes', options, async () => {
  const vu = async (qui) =>
    (await appel('GET', '/api/calendrier?debut=2026-05-01&fin=2026-07-31', undefined, sessions[qui])).json();

  const alice = await vu('alice'); // Développement, sous-équipe de Technique
  assert.deepEqual(alice.joursImposes, [
    { jour: '2026-05-15', libelle: "Pont de l'Ascension", avecDecompte: false },
    { jour: '2026-07-13', libelle: 'Fermeture technique', avecDecompte: false },
  ]);
  assert.deepEqual(alice.joursFeries.map((f) => f.jour), ['2026-05-01', '2026-05-08', '2026-05-14', '2026-05-25', '2026-07-14']);

  assert.equal((await vu('bob')).joursImposes.length, 2); // Technique elle-même
  assert.deepEqual((await vu('chloe')).joursImposes.map((j) => j.jour), ['2026-05-15']); // Commerce : seulement l'entreprise
  assert.deepEqual((await vu('diane')).joursImposes.map((j) => j.jour), ['2026-05-15']); // Direction : équipe parente, non concernée
});

test('durée : week-ends, fériés et jours imposés selon l\'équipe', options, async () => {
  // Semaine de l'Ascension : jeudi férié, vendredi pont pour tous.
  assert.deepEqual(await duree('alice', { dateDebut: '2026-05-11', dateFin: '2026-05-15' }), { demiJournees: 6, jours: 3 });
  // Lundi 13 juillet fermé pour Technique seulement, mardi 14 férié.
  const periode = { dateDebut: '2026-07-13', dateFin: '2026-07-15' };
  assert.equal((await duree('alice', periode)).jours, 1);
  assert.equal((await duree('chloe', periode)).jours, 2);
  assert.deepEqual(
    await duree('chloe', { dateDebut: '2026-07-10', debutDemiJournee: 'apres_midi', dateFin: '2026-07-13', finDemiJournee: 'matin' }),
    { demiJournees: 2, jours: 1 },
  );
});

test('durée : une période à cheval sur deux ans préremplit les deux années', options, async () => {
  // Du lundi 28 décembre 2026 au vendredi 1er janvier 2027 (férié).
  assert.equal((await duree('chloe', { dateDebut: '2026-12-28', dateFin: '2027-01-01' })).jours, 4);
  const prefilled = await pool.query('SELECT annee FROM annees_calendrier ORDER BY annee');
  assert.deepEqual(prefilled.rows.map((r) => r.annee), [2026, 2027]);
});

test('durée et calendrier : périodes invalides refusées', options, async () => {
  const post = (corps) => appel('POST', '/api/calendrier/duree', corps, sessions.alice);
  assert.equal((await post({ dateDebut: '2026-05-15', dateFin: '2026-05-11' })).statusCode, 400);
  assert.equal((await post({ dateDebut: '2026-05-15' })).statusCode, 400);
  assert.equal((await post({ dateDebut: '2026-05-11', dateFin: '2026-05-15', debutDemiJournee: 'soir' })).statusCode, 400);
  assert.equal((await post({ dateDebut: '2026-01-01', dateFin: '2029-01-01' })).statusCode, 400);
  assert.equal((await appel('GET', '/api/calendrier?debut=2026-01-01', undefined, sessions.alice)).statusCode, 400);
});

test('supprimer un jour imposé le retire du calcul', options, async () => {
  assert.equal((await appel('DELETE', `/api/admin/jours-imposes/${ids.fermeture}`)).statusCode, 204);
  assert.equal((await appel('DELETE', `/api/admin/jours-imposes/${ids.fermeture}`)).statusCode, 404);
  assert.equal((await duree('alice', { dateDebut: '2026-07-13', dateFin: '2026-07-15' })).jours, 2);
});
