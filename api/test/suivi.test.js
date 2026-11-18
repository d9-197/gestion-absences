// Tickets restaurant, télétravail et fiche RH mensuelle, contre une vraie base.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { construireApp } from '../src/app.js';
import { hacher } from '../src/auth/mots-de-passe.js';
import { creerBaseDeTest, hote, options } from './aide-base.js';

const config = { appUrl: 'http://app.test', cookieSecure: false, sessionDureeHeures: 12 };
const sansLimite = { connexion: { max: 10000, timeWindow: '1 minute' }, oubli: { max: 10000, timeWindow: '1 minute' } };
const MOT_DE_PASSE = 'un mot de passe solide';
const AUJOURDHUI = '2026-11-17'; // un mardi

let baseDeTest;
let pool;
let app;
const sessions = {};
const ids = {};

const appel = (qui, method, url, payload) => app.inject({ method, url, payload, cookies: sessions[qui] ?? {} });
const planning = async (qui, debut = '2026-11-01', fin = '2026-11-30') => (await appel(qui, 'GET', `/api/planning?debut=${debut}&fin=${fin}`)).json();
const suiviDe = async (qui, prenom, debut, fin) => (await planning(qui, debut, fin)).personnes.find((p) => p.prenom === prenom).suivi;
async function demander(qui, corps) {
  const reponse = await appel(qui, 'POST', '/api/demandes', { typeId: ids.conges, ...corps });
  assert.equal(reponse.statusCode, 201, reponse.body);
  return reponse.json();
}

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

test('planning : un ticket par jour travaillé sans absence', options, async () => {
  const s = await suiviDe('alice', 'alice');
  // Novembre 2026 : 21 jours ouvrés hors 11 novembre (férié) → 20 jours ouvrés.
  assert.equal(s.tickets.length, 20);
  assert.ok(!s.tickets.includes('2026-11-11'), 'férié');
  assert.ok(!s.tickets.includes('2026-11-14'), 'week-end');
  assert.deepEqual(s.teletravail, []);
  assert.equal(s.modifiable, 'mois_courant');
  assert.equal((await suiviDe('diane', 'alice')).modifiable, 'tout');
  assert.equal((await suiviDe('bob', 'alice')).modifiable, null);
});

test('une absence, même d\'une demi-journée, supprime le ticket du jour ; une demande en attente aussi', options, async () => {
  const pasLe = async () => (await suiviDe('alice', 'alice')).tickets;
  const entiere = await demander('alice', { dateDebut: '2026-11-23', dateFin: '2026-11-24' });
  const demi = await demander('alice', { dateDebut: '2026-11-26', debutDemiJournee: 'apres_midi', dateFin: '2026-11-26' });
  const apres = await pasLe();
  for (const j of ['2026-11-23', '2026-11-24', '2026-11-26']) assert.ok(!apres.includes(j), `${j} en attente : pas de ticket`);
  assert.equal(apres.length, 17);
  // Refusée : le ticket revient.
  await appel('bob', 'POST', `/api/demandes/${demi.id}/decision`, { decision: 'refus', motif: 'non' });
  assert.ok((await pasLe()).includes('2026-11-26'));
  await appel('bob', 'POST', `/api/demandes/${entiere.id}/decision`, { decision: 'approbation' });
  assert.ok(!(await pasLe()).includes('2026-11-23'), 'approuvée : toujours pas de ticket');
});

test('retrait d\'un ticket : par le collaborateur, tracé, réversible, seulement sur un jour qui y donne droit', options, async () => {
  const retrait = await appel('alice', 'PUT', '/api/suivi/tickets', { jours: ['2026-11-18', '2026-11-19'], retire: true, motif: 'Repas offert' });
  assert.equal(retrait.statusCode, 200, retrait.body);
  assert.deepEqual(retrait.json(), { modifies: 2, inchanges: 0 });
  const s = await suiviDe('alice', 'alice');
  assert.ok(!s.tickets.includes('2026-11-18'));
  assert.deepEqual(s.ticketsRetires, [{ jour: '2026-11-18', motif: 'Repas offert' }, { jour: '2026-11-19', motif: 'Repas offert' }]);
  // Idempotent.
  assert.deepEqual((await appel('alice', 'PUT', '/api/suivi/tickets', { jours: ['2026-11-18'], retire: true })).json(), { modifies: 0, inchanges: 1 });
  // Sans droit : week-end, férié, jour d'absence.
  for (const jour of ['2026-11-14', '2026-11-11', '2026-11-23']) {
    assert.equal((await appel('alice', 'PUT', '/api/suivi/tickets', { jours: [jour], retire: true })).statusCode, 409, jour);
  }
  // Rétablissement.
  await appel('alice', 'PUT', '/api/suivi/tickets', { jours: ['2026-11-18'], retire: false });
  assert.deepEqual((await suiviDe('alice', 'alice')).ticketsRetires.map((t) => t.jour), ['2026-11-19']);
  // Le journal garde tout.
  const evenements = (await pool.query(`SELECT action, jour::text AS jour FROM suivi_evenements WHERE objet = 'ticket' ORDER BY id`)).rows;
  assert.deepEqual(evenements.map((e) => e.action), ['retrait', 'retrait', 'retablissement']);
  await assert.rejects(pool.query('UPDATE suivi_evenements SET motif = $1', ['x']), /permission denied|ajout seul/);
  await assert.rejects(pool.query('DELETE FROM suivi_evenements'), /permission denied|ajout seul/);
  // Un responsable et un autre collaborateur ne modifient pas ces informations ; un directeur le peut.
  assert.equal((await appel('bob', 'PUT', '/api/suivi/tickets', { collaborateurId: ids.alice, jours: ['2026-11-20'], retire: true })).statusCode, 403);
  assert.equal((await appel('chloe', 'PUT', '/api/suivi/tickets', { collaborateurId: ids.alice, jours: ['2026-11-20'], retire: true })).statusCode, 403);
  assert.equal((await appel('diane', 'PUT', '/api/suivi/tickets', { collaborateurId: ids.alice, jours: ['2026-11-20'], retire: true, motif: 'Note de frais' })).statusCode, 200);
});

test('mois clos : le collaborateur ne modifie plus ; un directeur corrige', options, async () => {
  // Octobre est clos (nous sommes le 17 novembre).
  const clos = await appel('alice', 'PUT', '/api/suivi/tickets', { jours: ['2026-10-20'], retire: true });
  assert.equal(clos.statusCode, 403);
  assert.match(clos.json().erreur, /mois en cours/);
  assert.equal((await appel('alice', 'PUT', '/api/suivi/teletravail', { jours: ['2026-10-20'], teletravail: true })).statusCode, 403);
  // Le début du mois en cours reste modifiable, même passé.
  assert.equal((await appel('alice', 'PUT', '/api/suivi/teletravail', { jours: ['2026-11-03'], teletravail: true })).statusCode, 200);
  assert.equal((await appel('diane', 'PUT', '/api/suivi/tickets', { collaborateurId: ids.alice, jours: ['2026-10-20'], retire: true, motif: 'Correction' })).statusCode, 200);
  // Au-delà de l'horizon de saisie (12 mois), personne.
  assert.equal((await appel('diane', 'PUT', '/api/suivi/teletravail', { collaborateurId: ids.alice, jours: ['2028-01-04'], teletravail: true })).statusCode, 403);
});

test('télétravail : déclaration à l\'unité, sur un jour travaillé sans absence complète', options, async () => {
  const ok = await appel('alice', 'PUT', '/api/suivi/teletravail', { jours: ['2026-11-04', '2026-11-05'], teletravail: true });
  assert.deepEqual(ok.json(), { modifies: 2, inchanges: 0 });
  assert.deepEqual((await suiviDe('alice', 'alice')).teletravail.slice(0, 3), ['2026-11-03', '2026-11-04', '2026-11-05']);
  for (const jour of ['2026-11-14', '2026-11-11', '2026-11-24']) {
    assert.equal((await appel('alice', 'PUT', '/api/suivi/teletravail', { jours: [jour], teletravail: true })).statusCode, 409, jour);
  }
  // Le télétravail ne retire pas le ticket.
  assert.ok((await suiviDe('alice', 'alice')).tickets.includes('2026-11-04'));
  // Annulation.
  await appel('alice', 'PUT', '/api/suivi/teletravail', { jours: ['2026-11-05'], teletravail: false });
  assert.ok(!(await suiviDe('alice', 'alice')).teletravail.includes('2026-11-05'));
  // Visible du responsable.
  assert.ok((await suiviDe('bob', 'alice')).teletravail.includes('2026-11-04'));
  // Un collaborateur qui n'est pas dans la portée ne voit rien d'Alice.
  assert.equal((await planning('chloe')).personnes.some((p) => p.prenom === 'alice'), false);
});

test('télétravail : série « tous les mardis jusqu\'au… », jours écartés comptés', options, async () => {
  const serie = await appel('alice', 'POST', '/api/suivi/teletravail/serie', { joursSemaine: [2], debut: '2026-11-17', fin: '2026-12-29' });
  assert.equal(serie.statusCode, 200, serie.body);
  // Mardis : 17/11, 24/11 (absence), 1/12, 8/12, 15/12, 22/12, 29/12.
  assert.equal(serie.json().modifies, 6);
  assert.deepEqual(serie.json().ecartes, { nonTravailles: 0, absence: 1, dejaFait: 0 });
  const s = await suiviDe('alice', 'alice', '2026-11-01', '2026-12-31');
  assert.ok(s.teletravail.includes('2026-12-08') && !s.teletravail.includes('2026-11-24'));
  // Rejouée : plus rien à faire.
  assert.equal((await appel('alice', 'POST', '/api/suivi/teletravail/serie', { joursSemaine: [2], debut: '2026-11-17', fin: '2026-12-29' })).json().modifies, 0);
  // Un jour de la série se modifie ensuite seul.
  await appel('alice', 'PUT', '/api/suivi/teletravail', { jours: ['2026-12-08'], teletravail: false });
  assert.ok(!(await suiviDe('alice', 'alice', '2026-12-01', '2026-12-31')).teletravail.includes('2026-12-08'));
  // Jours fériés écartés.
  const noel = await appel('alice', 'POST', '/api/suivi/teletravail/serie', { joursSemaine: [5], debut: '2026-12-21', fin: '2026-12-31' });
  assert.deepEqual([noel.json().modifies, noel.json().ecartes.nonTravailles], [0, 1]); // le seul vendredi de la période, le 25, est férié
  // Annulation de série.
  const annul = await appel('alice', 'POST', '/api/suivi/teletravail/serie', { joursSemaine: [2], debut: '2026-12-01', fin: '2026-12-29', teletravail: false });
  assert.equal(annul.json().modifies, 4); // 1/12, 15/12, 22/12, 29/12 (le 8 est déjà annulé)
  // Dates validées ; un début avant le mois en cours est ramené au 1er du mois.
  assert.equal((await appel('alice', 'POST', '/api/suivi/teletravail/serie', { joursSemaine: [2], debut: '2026-12-10', fin: '2026-12-01' })).statusCode, 400);
  const ramene = await appel('alice', 'POST', '/api/suivi/teletravail/serie', { joursSemaine: [4], debut: '2026-09-01', fin: '2026-11-06' });
  assert.equal(ramene.json().debutEffectif, '2026-11-01');
  assert.equal((await appel('alice', 'POST', '/api/suivi/teletravail/serie', { joursSemaine: [4], debut: '2026-08-01', fin: '2026-09-30' })).statusCode, 403);
  assert.equal((await appel('alice', 'POST', '/api/suivi/teletravail/serie', { joursSemaine: [6], debut: '2026-11-17', fin: '2026-12-29' })).statusCode, 400);
});

test('fiche RH : calendrier et compteurs, cohérents entre eux', options, async () => {
  // Alice en novembre : 20 jours ouvrés ; congés approuvés les 23 et 24 (4 demi-journées), RTT en attente le 30 (2 demi-journées).
  await demander('alice', { typeId: ids.rtt, dateDebut: '2026-11-30', dateFin: '2026-11-30' });
  const reponse = await appel('alice', 'GET', '/api/fiches-rh?mois=2026-11');
  assert.equal(reponse.statusCode, 200, reponse.body);
  const f = reponse.json();
  assert.equal(f.collaborateur.nom, 'alice');
  assert.equal(f.jours.length, 30);
  const c = f.compteurs;
  assert.equal(c.joursOuvres, 20);
  assert.equal(c.absences.find((a) => a.libelle === 'Congés payés').jours, 2);
  assert.equal(c.absences.find((a) => a.libelle === 'RTT').jours, 0, 'en attente : pas compté');
  assert.equal(c.absencesEnAttente, 1);
  assert.equal(c.provisoire, true);
  // Partition : travaillés + absences confirmées + en attente = ouvrés.
  const confirmees = c.absences.reduce((n, a) => n + a.jours, 0);
  assert.equal(c.joursTravailles + confirmees + c.absencesEnAttente, c.joursOuvres);
  assert.equal(c.joursTravailles, 17);
  assert.equal(c.teletravail + c.surSite, c.joursTravailles);
  // Tickets : jours travaillés pleins (17) moins ceux retirés (19 et 20 novembre) → 15 ; 2 retirés.
  assert.equal(c.ticketsRetires, 2);
  assert.equal(c.tickets, c.joursTravailles - 2 - 0);
  // Télétravail en novembre : les 3 et 4 (à l'unité), le jeudi 5 (série ramenée au 1er du mois), le mardi 17 (série des mardis).
  assert.equal(c.teletravail, 4);

  // Accès : chacun la sienne, un valideur celle de ses personnes, un directeur tout ; les autres : introuvable.
  assert.equal((await appel('bob', 'GET', `/api/fiches-rh?mois=2026-11&collaborateurId=${ids.alice}`)).statusCode, 200);
  assert.equal((await appel('diane', 'GET', `/api/fiches-rh?mois=2026-11&collaborateurId=${ids.alice}`)).statusCode, 200);
  assert.equal((await appel('chloe', 'GET', `/api/fiches-rh?mois=2026-11&collaborateurId=${ids.alice}`)).statusCode, 404);
  assert.equal((await appel('alice', 'GET', `/api/fiches-rh?mois=2026-11&collaborateurId=${ids.bob}`)).statusCode, 404);
  assert.equal((await appel('alice', 'GET', '/api/fiches-rh?mois=2026-13')).statusCode, 400);
  assert.equal((await appel('alice', 'GET', '/api/fiches-rh?mois=2020-01')).statusCode, 400);
  assert.equal((await appel('inconnu', 'GET', '/api/fiches-rh?mois=2026-11')).statusCode, 401);
});

test('fiche RH en PDF : une page par salarié, titre exigé', options, async () => {
  const un = await appel('alice', 'GET', '/api/fiches-rh/pdf?mois=2026-11');
  assert.equal(un.statusCode, 200);
  assert.equal(un.headers['content-type'], 'application/pdf');
  assert.match(un.headers['content-disposition'], /fiche-rh-2026-11-alice-alice\.pdf/);
  assert.equal(un.rawPayload.subarray(0, 5).toString(), '%PDF-');
  const pages = (buf) => (buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
  assert.equal(pages(un.rawPayload), 1);

  const masse = await appel('diane', 'GET', `/api/fiches-rh/pdf?mois=2026-11&collaborateurIds=${ids.alice},${ids.bob},${ids.chloe}`);
  assert.equal(masse.statusCode, 200);
  assert.equal(pages(masse.rawPayload), 3);
  assert.match(masse.headers['content-disposition'], /fiches-rh-2026-11\.pdf/);
  // Un responsable ne peut demander que ses personnes ; Chloe n'est pas dans son équipe.
  assert.equal((await appel('bob', 'GET', `/api/fiches-rh/pdf?mois=2026-11&collaborateurIds=${ids.alice},${ids.chloe}`)).statusCode, 404);
  assert.equal((await appel('alice', 'GET', `/api/fiches-rh/pdf?mois=2026-11&collaborateurIds=${ids.bob}`)).statusCode, 404);
  assert.equal((await appel('diane', 'GET', '/api/fiches-rh/pdf?mois=2026-11&collaborateurIds=a,b')).statusCode, 400);
});
