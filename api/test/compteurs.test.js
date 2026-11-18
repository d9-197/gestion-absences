// Compteurs de congés indicatifs, contre une vraie base.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { construireApp } from '../src/app.js';
import { hacher } from '../src/auth/mots-de-passe.js';
import { creerBaseDeTest, hote, options } from './aide-base.js';

const config = { appUrl: 'http://app.test', cookieSecure: false, sessionDureeHeures: 12 };
const sansLimite = { connexion: { max: 10000, timeWindow: '1 minute' }, oubli: { max: 10000, timeWindow: '1 minute' } };
const MOT_DE_PASSE = 'un mot de passe solide';
const AUJOURDHUI = '2026-11-17'; // période des congés payés : 2026-06-01 → 2027-05-31

let baseDeTest;
let pool;
let app;
const sessions = {};
const ids = {};
const appel = (qui, method, url, payload) => app.inject({ method, url, payload, cookies: sessions[qui] ?? {} });
const soldes = async (qui, collaborateurId) => (await appel(qui, 'GET', `/api/compteurs${collaborateurId ? `?collaborateurId=${collaborateurId}` : ''}`)).json();

before(async () => {
  if (!hote) return;
  baseDeTest = await creerBaseDeTest();
  pool = baseDeTest.api;
  const equipe = async (nom, parent = null) =>
    Number((await pool.query('INSERT INTO equipes (nom, parent_id) VALUES ($1, $2) RETURNING id', [nom, parent])).rows[0].id);
  ids.direction = await equipe('Direction');
  ids.technique = await equipe('Technique', ids.direction);
  const hachage = await hacher(MOT_DE_PASSE);
  const personne = async (prenom, equipeId, role) => {
    ids[prenom] = Number((await pool.query(
      `INSERT INTO collaborateurs (email, nom, prenom, equipe_id, role, mot_de_passe_hash) VALUES ($1, $2, $2, $3, $4, $5) RETURNING id`,
      [`${prenom}@exemple.test`, prenom, equipeId, role, hachage],
    )).rows[0].id);
  };
  await personne('diane', ids.direction, 'directeur');
  await personne('bob', ids.technique, 'responsable');
  await personne('alice', ids.technique, 'collaborateur');
  await personne('chloe', ids.direction, 'collaborateur');
  await pool.query('UPDATE equipes SET responsable_id = $2 WHERE id = $1', [ids.direction, ids.diane]);
  await pool.query('UPDATE equipes SET responsable_id = $2 WHERE id = $1', [ids.technique, ids.bob]);
  ids.conges = Number((await pool.query(`SELECT id FROM types_absence WHERE libelle = 'Congés payés'`)).rows[0].id);
  ids.rtt = Number((await pool.query(`SELECT id FROM types_absence WHERE libelle = 'RTT'`)).rows[0].id);
  app = await construireApp({
    pool, config, logger: false, limites: sansLimite, aujourdhui: () => AUJOURDHUI, courriel: { envoyer: async () => {} },
  });
  for (const prenom of ['diane', 'bob', 'alice', 'chloe']) {
    const connexion = await app.inject({ method: 'POST', url: '/api/auth/connexion', payload: { email: `${prenom}@exemple.test`, motDePasse: MOT_DE_PASSE } });
    sessions[prenom] = { absences_session: connexion.cookies.find((c) => c.name === 'absences_session').value };
  }
});

after(async () => {
  await app?.close();
  await baseDeTest?.fermer();
});

test('compteurs : désactivés par défaut, rien n\'est calculé', options, async () => {
  const r = await soldes('alice');
  assert.equal(r.actif, false);
  assert.deepEqual(r.soldes, []);
  assert.match(r.mention, /bulletins de paie font foi/);
  assert.equal((await appel('alice', 'GET', '/api/admin/compteurs')).statusCode, 403);
});

test('compteurs : configuration par type, réservée aux directeurs', options, async () => {
  const patch = (corps) => appel('diane', 'PATCH', `/api/admin/types-absence/${ids.conges}`, corps);
  assert.equal((await appel('alice', 'PATCH', `/api/admin/types-absence/${ids.conges}`, { compteurActif: true })).statusCode, 403);
  const r = await patch({ compteurActif: true, dotationAnnuelle: 24, debutPeriodeMois: 6, reportAutomatique: true });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().dotationAnnuelle, 24);
  assert.equal((await patch({ debutPeriodeMois: 13 })).statusCode, 400);
  assert.equal((await patch({ dotationAnnuelle: 10.3 })).statusCode, 400);
  assert.equal((await appel('diane', 'PUT', '/api/admin/compteurs/actif', { actif: true })).statusCode, 200);
  const s = await soldes('alice');
  assert.equal(s.actif, true);
  assert.deepEqual(s.soldes.map((x) => x.libelle), ['Congés payés']); // RTT : pas de compteur
});

test('solde : acquisition mensuelle depuis le début de période, absences déduites', options, async () => {
  // Juin → novembre 2026 : 6 premiers du mois × 24/12 = 12 jours acquis, rien de pris.
  let s = (await soldes('alice')).soldes[0];
  assert.equal(s.acquis, 12);
  assert.equal(s.solde, 12);
  assert.equal(s.report, 0);
  assert.deepEqual(s.periode, { debut: '2026-06-01', fin: '2027-05-31' });

  // Une demande en attente (lundi 23 → mardi 24 novembre : 2 jours) est déduite et signalée.
  const d = await appel('alice', 'POST', '/api/demandes', { typeId: ids.conges, dateDebut: '2026-11-23', dateFin: '2026-11-24' });
  assert.equal(d.statusCode, 201, d.body);
  s = (await soldes('alice')).soldes[0];
  assert.equal(s.enAttente, 2);
  assert.equal(s.solde, 10);
  assert.equal(s.pris, 0);
  await appel('bob', 'POST', `/api/demandes/${d.json().id}/decision`, { decision: 'approbation' });
  s = (await soldes('alice')).soldes[0];
  assert.equal(s.pris, 2);
  assert.equal(s.enAttente, 0);
  assert.equal(s.solde, 10);
  // Le valideur lit, un autre collaborateur non.
  assert.equal((await soldes('bob', ids.alice)).soldes[0].solde, 10);
  assert.equal((await appel('chloe', 'GET', `/api/compteurs?collaborateurId=${ids.alice}`)).statusCode, 404);
});

test('avertissement non bloquant quand une demande dépasse le solde acquis', options, async () => {
  // Du 1er décembre au 8 janvier : 7 premiers du mois acquis au 1er décembre = 14 j − 2 j pris = 12 j ; 29 jours ouvrés demandés.
  const corps = { typeId: ids.conges, dateDebut: '2026-12-01', dateFin: '2027-01-08' };
  const apercu = await appel('alice', 'POST', '/api/demandes/previsualisation', corps);
  assert.equal(apercu.statusCode, 200, apercu.body);
  const w = apercu.json().avertissements.find((a) => a.code === 'solde_insuffisant');
  assert.ok(w, JSON.stringify(apercu.json().avertissements));
  assert.match(w.message, /bulletins de paie font foi/);
  // Non bloquant : la demande est enregistrée.
  assert.equal((await appel('alice', 'POST', '/api/demandes', corps)).statusCode, 201);
  // Un type sans compteur ne déclenche rien.
  const rtt = await appel('alice', 'POST', '/api/demandes/previsualisation', { ...corps, typeId: ids.rtt });
  assert.ok(!rtt.json().avertissements.some((a) => a.code === 'solde_insuffisant'));
});

test('recalage : par le salarié, tracé, remplace le calcul', options, async () => {
  const avant = (await soldes('alice')).soldes[0];
  const r = await appel('alice', 'PUT', '/api/compteurs/recalage', { typeId: ids.conges, dateEffet: '2026-11-10', joursRestants: 5 });
  assert.equal(r.statusCode, 200, r.body);
  const s = r.json().soldes[0];
  assert.equal(s.recalage.joursRestants, 5);
  assert.equal(s.acquis, 0); // aucun 1er du mois entre le 10 et le 17 novembre
  assert.ok(s.solde < avant.solde);
  const essai = (corps, qui = 'alice') => appel(qui, 'PUT', '/api/compteurs/recalage', { typeId: ids.conges, dateEffet: '2026-11-10', joursRestants: 5, ...corps });
  assert.equal((await essai({ dateEffet: '2026-11-18' })).statusCode, 400);
  assert.equal((await essai({ dateEffet: '2026-05-31' })).statusCode, 400);
  assert.equal((await essai({ joursRestants: 5.3 })).statusCode, 400);
  assert.equal((await essai({ typeId: ids.rtt })).statusCode, 400);
  assert.equal((await essai({ collaborateurId: ids.chloe })).statusCode, 403);
  assert.equal((await essai({ collaborateurId: ids.chloe }, 'diane')).statusCode, 200);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM recalages_solde')).rows[0].n, 2);
  await assert.rejects(pool.query('UPDATE recalages_solde SET jours_restants = 99'), /permission denied|ajout seul/);
});

test('dotation par salarié et report manuel', options, async () => {
  const put = (url, corps) => appel('diane', 'PUT', `/api/admin/compteurs/${url}`, corps);
  assert.equal((await put('dotation', { collaborateurId: ids.bob, typeId: ids.conges, jours: 12 })).statusCode, 204);
  const bob = (await soldes('bob')).soldes[0];
  assert.equal(bob.dotation, 12);
  assert.equal(bob.dotationPersonnelle, true);
  assert.equal(bob.acquis, 6); // 6 mois × 12/12
  assert.equal((await put('dotation', { collaborateurId: ids.bob, typeId: ids.conges, jours: null })).statusCode, 204);
  assert.equal((await soldes('bob')).soldes[0].dotation, 24);

  // Report manuel : refusé tant que le type reporte automatiquement.
  assert.equal((await put('report', { collaborateurId: ids.bob, typeId: ids.conges, jours: 3 })).statusCode, 409);
  await appel('diane', 'PATCH', `/api/admin/types-absence/${ids.conges}`, { reportAutomatique: false });
  assert.equal((await soldes('bob')).soldes[0].report, 0);
  assert.equal((await put('report', { collaborateurId: ids.bob, typeId: ids.conges, jours: 3 })).statusCode, 204);
  const b = (await soldes('bob')).soldes[0];
  assert.equal(b.report, 3);
  assert.equal(b.solde, 15); // 3 reportés + 12 acquis

  const vue = (await appel('diane', 'GET', `/api/admin/compteurs/type/${ids.conges}`)).json();
  assert.equal(vue.lignes.length, 4);
  assert.equal((await appel('alice', 'PUT', '/api/admin/compteurs/dotation', { collaborateurId: ids.bob, typeId: ids.conges, jours: 1 })).statusCode, 403);
});

test('report automatique : le reliquat de la période précédente s\'ajoute, s\'il est connu', options, async () => {
  await appel('diane', 'PATCH', `/api/admin/types-absence/${ids.conges}`, { reportAutomatique: true });
  // Sans recalage dans la période précédente, son solde est inconnu : rien n'est reporté.
  assert.equal((await soldes('diane')).soldes[0].report, 0);
  await pool.query(
    `INSERT INTO recalages_solde (collaborateur_id, type_id, date_effet, jours_restants, auteur_id) VALUES ($1, $2, '2026-05-15', 10, $1)`,
    [ids.diane, ids.conges],
  );
  const s = (await soldes('diane')).soldes[0];
  assert.equal(s.report, 10);
  assert.equal(s.solde, 22); // 10 reportés + 12 acquis
});

test('fiche RH : soldes indicatifs, puis plus rien si les compteurs sont désactivés', options, async () => {
  const fiche = async () => (await appel('alice', 'GET', `/api/fiches-rh?mois=2026-11&collaborateurId=${ids.alice}`)).json();
  const f = await fiche();
  assert.equal(f.soldes.length, 1);
  assert.equal(f.soldesAu, AUJOURDHUI);
  await appel('diane', 'PUT', '/api/admin/compteurs/actif', { actif: false });
  assert.deepEqual((await fiche()).soldes, []);
});

test('compteurs désactivés globalement : plus de solde ni d\'avertissement', options, async () => {
  assert.deepEqual((await soldes('alice')).soldes, []);
  const apercu = await appel('alice', 'POST', '/api/demandes/previsualisation', { typeId: ids.conges, dateDebut: '2026-12-01', dateFin: '2027-01-08' });
  assert.ok(!apercu.json().avertissements.some((a) => a.code === 'solde_insuffisant'));
  assert.equal((await appel('alice', 'PUT', '/api/compteurs/recalage', { typeId: ids.conges, dateEffet: '2026-11-10', joursRestants: 1 })).statusCode, 409);
});

test('couverture : le collaborateur voit un nombre de collègues absents, sans noms, sans blocage', options, async () => {
  // Alice et Bob sont dans l'équipe Technique. Bob (responsable) pose une absence en attente, Chloé (autre équipe) aussi.
  const corps = { typeId: ids.conges, dateDebut: '2027-03-01', dateFin: '2027-03-05' };
  const apercu = async (qui, c = corps) => (await appel(qui, 'POST', '/api/demandes/previsualisation', c)).json();
  assert.equal((await apercu('alice')).couverture.absents, 0);
  assert.equal((await appel('bob', 'POST', '/api/demandes', corps)).statusCode, 201);
  assert.equal((await appel('chloe', 'POST', '/api/demandes', corps)).statusCode, 201);
  const r = await apercu('alice');
  assert.equal(r.couverture.absents, 1, 'seule l\'équipe directe compte');
  assert.equal(r.couverture.effectif, 1);
  assert.deepEqual(Object.keys(r.couverture).sort(), ['absents', 'effectif'], 'seulement des nombres');
  assert.ok(!r.avertissements.some((a) => a.code === 'couverture'), 'information, pas un avertissement enregistré');
  assert.equal(r.blocage, null);
  // Période sans chevauchement : zéro.
  assert.equal((await apercu('alice', { ...corps, dateDebut: '2027-03-08', dateFin: '2027-03-09' })).couverture.absents, 0);
  // La demande d'Alice s'enregistre, et n'enregistre pas l'information.
  const d = await appel('alice', 'POST', '/api/demandes', corps);
  assert.equal(d.statusCode, 201);
  assert.ok(!d.json().avertissements.some((a) => a.code === 'couverture'));
});
