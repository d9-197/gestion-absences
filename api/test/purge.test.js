// Tests de la purge automatique contre une vraie base (ignorés si TEST_DB_HOST n'est pas défini).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { construireApp } from '../src/app.js';
import { hacher } from '../src/auth/mots-de-passe.js';
import { creerPlanificateurPurge } from '../src/purge/planificateur.js';
import { apercu, entretien, purger } from '../src/purge/service.js';
import { creerBaseDeTest, hote, options } from './aide-base.js';

const config = { appUrl: 'http://app.test', cookieSecure: false, sessionDureeHeures: 12, fuseau: 'Europe/Paris' };
const sansLimite = { connexion: { max: 10000, timeWindow: '1 minute' }, oubli: { max: 10000, timeWindow: '1 minute' } };
const MOT_DE_PASSE = 'un mot de passe solide';
const JOUR = '2026-11-17'; // date limite avec 12 mois : 2025-11-17

let baseDeTest;
let pool;
let app;
const sessions = {};
const ids = {};
const demandes = {};

const appel = (qui, method, url, payload) => app.inject({ method, url, payload, cookies: sessions[qui] ?? {} });
const nombre = async (requete, valeurs = []) => (await pool.query(requete, valeurs)).rows[0].n;
const definirDuree = (valeur) => pool.query(
  `UPDATE parametres SET valeur = $1::jsonb WHERE cle = 'conservation_passe_mois'`, [JSON.stringify(valeur)]);
const idsRestants = async () => (await pool.query('SELECT id FROM demandes ORDER BY id')).rows.map((r) => Number(r.id));

// Une demande (et son journal) à une date quelconque, comme le fait l'API mais sans sa fenêtre de saisie.
async function creerDemande({ dateDebut, dateFin, nature = 'absence', annule = null, evenements = ['soumission'] }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO demandes (nature, demande_annulee_id, collaborateur_id, equipe_id, type_id, date_debut, date_fin, duree_demi_journees, saisie_par_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 4, $3) RETURNING id`,
      [nature, annule, ids.alice, ids.equipe, ids.conges, dateDebut, dateFin],
    );
    for (const type of evenements) {
      await client.query('INSERT INTO evenements_demande (demande_id, type, auteur_id) VALUES ($1, $2, $3)',
        [rows[0].id, type, type === 'soumission' ? ids.alice : ids.diane]);
    }
    await client.query('COMMIT');
    return Number(rows[0].id);
  } catch (erreur) {
    await client.query('ROLLBACK');
    throw erreur;
  } finally {
    client.release();
  }
}

before(async () => {
  if (!hote) return;
  baseDeTest = await creerBaseDeTest();
  pool = baseDeTest.api;
  ids.equipe = Number((await pool.query(`INSERT INTO equipes (nom) VALUES ('Direction') RETURNING id`)).rows[0].id);
  const hachage = await hacher(MOT_DE_PASSE);
  for (const [cle, role] of [['diane', 'directeur'], ['alice', 'collaborateur']]) {
    ids[cle] = Number((await pool.query(
      `INSERT INTO collaborateurs (email, nom, prenom, equipe_id, role, mot_de_passe_hash) VALUES ($1, $2, $2, $3, $4, $5) RETURNING id`,
      [`${cle}@exemple.test`, cle, ids.equipe, role, hachage])).rows[0].id);
  }
  ids.conges = Number((await pool.query(`SELECT id FROM types_absence WHERE libelle = 'Congés payés'`)).rows[0].id);

  // Avec 12 mois, la date limite est le 2025-11-17 : seules les demandes terminées AVANT ce jour sont purgées.
  demandes.ancienne = await creerDemande({ dateDebut: '2024-01-08', dateFin: '2024-01-12', evenements: ['soumission', 'approbation'] });
  demandes.annulation = await creerDemande({ dateDebut: '2024-01-08', dateFin: '2024-01-12', nature: 'annulation', annule: demandes.ancienne });
  demandes.terminee = await creerDemande({ dateDebut: '2025-11-10', dateFin: '2025-11-14' });
  demandes.surLaLimite = await creerDemande({ dateDebut: '2025-11-15', dateFin: '2025-11-17' }); // fin = date limite : conservée
  demandes.apresLaLimite = await creerDemande({ dateDebut: '2025-11-18', dateFin: '2025-11-21' });
  demandes.aCheval = await creerDemande({ dateDebut: '2025-11-12', dateFin: '2025-11-20' }); // finit après la limite : conservée
  demandes.future = await creerDemande({ dateDebut: '2027-01-04', dateFin: '2027-01-08' });
  for (const id of [demandes.ancienne, demandes.surLaLimite]) {
    await pool.query(
      `INSERT INTO envois_email (demande_id, destinataire, sujet, avec_pdf, modele) VALUES ($1, 'alice@exemple.test', 'Sujet', true, 'decision')`, [id]);
  }

  app = await construireApp({
    pool, config, logger: false, limites: sansLimite, aujourdhui: () => JOUR, courriel: { envoyer: async () => {} },
  });
  for (const cle of ['diane', 'alice']) {
    const connexion = await app.inject({
      method: 'POST', url: '/api/auth/connexion', payload: { email: `${cle}@exemple.test`, motDePasse: MOT_DE_PASSE },
    });
    sessions[cle] = { absences_session: connexion.cookies.find((c) => c.name === 'absences_session').value };
  }
});

after(async () => {
  await app?.close();
  await baseDeTest?.fermer();
});

// --- Réglage par les directeurs ----------------------------------------------

test('la durée de conservation et ce qu\'elle supprimerait sont visibles des directeurs seulement', options, async () => {
  assert.equal((await appel('alice', 'GET', '/api/admin/conservation')).statusCode, 403);
  assert.equal((await appel('inconnu', 'GET', '/api/admin/conservation')).statusCode, 401);
  const etat = (await appel('diane', 'GET', '/api/admin/conservation')).json();
  assert.deepEqual(etat, {
    moisConservation: 12, dureeMin: 1, dureeMax: 120, dateLimite: '2025-11-17',
    demandesAPurger: 3, evenementsAPurger: 4, dernieresPurges: [],
  });
});

test('l\'aperçu mesure l\'effet d\'une durée sans rien enregistrer ni supprimer', options, async () => {
  const apercu_ = async (mois) => (await appel('diane', 'GET', `/api/admin/conservation/apercu?mois=${mois}`)).json();
  assert.deepEqual(await apercu_(24), { mois: 24, dateLimite: '2024-11-17', demandesAPurger: 2, evenementsAPurger: 3 });
  // Avec un mois, tout ce qui est terminé depuis plus d'un mois, sauf la demande à venir.
  assert.deepEqual(await apercu_(1), { mois: 1, dateLimite: '2026-10-17', demandesAPurger: 6, evenementsAPurger: 7 });
  assert.equal((await appel('diane', 'GET', '/api/admin/conservation')).json().moisConservation, 12);
  assert.equal((await idsRestants()).length, 7);
  for (const mois of [0, 121, 'x', 1.5, '']) {
    assert.equal((await appel('diane', 'GET', `/api/admin/conservation/apercu?mois=${mois}`)).statusCode, 400, String(mois));
  }
  assert.equal((await appel('diane', 'GET', '/api/admin/conservation/apercu')).statusCode, 400);
});

test('enregistrer une durée ne supprime rien sur le moment', options, async () => {
  for (const corps of [{}, { moisConservation: 0 }, { moisConservation: 121 }, { moisConservation: 'x' }, { moisConservation: 1.5 }, { moisConservation: null }]) {
    assert.equal((await appel('diane', 'PUT', '/api/admin/conservation', corps)).statusCode, 400, JSON.stringify(corps));
  }
  assert.equal((await appel('alice', 'PUT', '/api/admin/conservation', { moisConservation: 6 })).statusCode, 403);

  const reponse = await appel('diane', 'PUT', '/api/admin/conservation', { moisConservation: 6 });
  assert.equal(reponse.statusCode, 200);
  assert.equal(reponse.json().moisConservation, 6);
  assert.equal(reponse.json().dateLimite, '2026-05-17');
  assert.equal(reponse.json().demandesAPurger, 6); // annoncé, pas encore supprimé
  assert.equal((await idsRestants()).length, 7);
  assert.equal(await nombre('SELECT count(*)::int AS n FROM purges'), 0);

  // La durée sert aussi à la fenêtre de saisie : le réglage est immédiatement pris en compte.
  const refus = await appel('alice', 'POST', '/api/demandes', { typeId: ids.conges, dateDebut: '2026-04-06', dateFin: '2026-04-07' });
  assert.equal(refus.statusCode, 400);
  assert.match(refus.json().erreur, /antérieure à 6 mois/);
  assert.equal((await appel('diane', 'PUT', '/api/admin/conservation', { moisConservation: 12 })).json().moisConservation, 12);
});

test('une durée enregistrée mais inutilisable est signalée, et rien n\'est purgé', options, async () => {
  await definirDuree('beaucoup');
  try {
    const reponse = await appel('diane', 'GET', '/api/admin/conservation');
    assert.equal(reponse.statusCode, 409);
    assert.match(reponse.json().erreur, /Durée de conservation invalide : "beaucoup"/);
    // Un directeur peut la corriger.
    assert.equal((await appel('diane', 'PUT', '/api/admin/conservation', { moisConservation: 12 })).statusCode, 200);
    await definirDuree(0);
    for (const valeur of [0, 121, 1.5, null, 'x']) {
      await definirDuree(valeur);
      await assert.rejects(purger(pool, { aujourdhui: JOUR, origine: 'automatique' }), /Durée de conservation invalide/, String(valeur));
    }
    assert.equal((await idsRestants()).length, 7);
    assert.equal(await nombre('SELECT count(*)::int AS n FROM purges'), 0);
  } finally {
    await definirDuree(12);
  }
});

// --- La purge ----------------------------------------------------------------

test('la purge supprime les demandes terminées avant la date limite, avec leur journal et leurs envois', options, async () => {
  assert.deepEqual(await apercu(pool, { mois: 12, aujourdhui: JOUR }), { mois: 12, dateLimite: '2025-11-17', demandes: 3, evenements: 4 });

  const resultat = await purger(pool, { aujourdhui: JOUR, origine: 'ligne_de_commande' });
  assert.deepEqual(resultat, { mois: 12, avant: '2025-11-17', demandesSupprimees: 3, evenementsSupprimes: 4, origine: 'ligne_de_commande' });

  // L'ancienne, sa demande d'annulation et la terminée avant la limite sont parties ; les autres restent.
  assert.deepEqual(await idsRestants(), [demandes.surLaLimite, demandes.apresLaLimite, demandes.aCheval, demandes.future].sort((a, b) => a - b));
  // Leur journal et leurs envois ont suivi, sans toucher à ceux des demandes conservées.
  assert.equal(await nombre('SELECT count(*)::int AS n FROM evenements_demande WHERE demande_id = ANY($1)',
    [[demandes.ancienne, demandes.annulation, demandes.terminee]]), 0);
  assert.equal(await nombre('SELECT count(*)::int AS n FROM evenements_demande'), 4);
  assert.deepEqual((await pool.query('SELECT demande_id FROM envois_email')).rows.map((r) => Number(r.demande_id)), [demandes.surLaLimite]);
  // Les personnes, elles, ne sont pas concernées.
  assert.equal(await nombre('SELECT count(*)::int AS n FROM collaborateurs'), 2);
});

test('chaque purge est consignée, et le journal des purges est en ajout seul', options, async () => {
  const { rows } = await pool.query('SELECT jour, avant, demandes_supprimees, evenements_supprimes, origine FROM purges');
  assert.deepEqual(rows, [{ jour: JOUR, avant: '2025-11-17', demandes_supprimees: 3, evenements_supprimes: 4, origine: 'ligne_de_commande' }]);
  const etat = (await appel('diane', 'GET', '/api/admin/conservation')).json();
  assert.equal(etat.demandesAPurger, 0);
  assert.deepEqual(etat.dernieresPurges.map((p) => [p.avant, p.demandesSupprimees, p.evenementsSupprimes, p.origine]), [['2025-11-17', 3, 4, 'ligne_de_commande']]);
  for (const requete of ['UPDATE purges SET demandes_supprimees = 0', 'DELETE FROM purges', 'TRUNCATE purges']) {
    await assert.rejects(pool.query(requete), /permission denied/, requete);
    await assert.rejects(baseDeTest.proprietaire.query(requete), /ajout seul/, `propriétaire : ${requete}`);
  }
});

test('une purge automatique par jour : la seconde ne fait rien, le lendemain recommence', options, async () => {
  const premiere = await purger(pool, { aujourdhui: JOUR, origine: 'automatique', unParJour: true });
  assert.equal(premiere.origine, 'automatique');
  assert.equal(premiere.demandesSupprimees, 0);
  assert.equal(await purger(pool, { aujourdhui: JOUR, origine: 'automatique', unParJour: true }), null);
  assert.equal((await purger(pool, { aujourdhui: '2026-11-18', origine: 'automatique', unParJour: true })).avant, '2025-11-18');
  assert.equal(await nombre(`SELECT count(*)::int AS n FROM purges WHERE origine = 'automatique'`), 2);
  // Même la base refuse deux purges automatiques le même jour.
  await assert.rejects(
    pool.query(`INSERT INTO purges (jour, avant, demandes_supprimees, evenements_supprimes, origine) VALUES ($1, $1, 0, 0, 'automatique')`, [JOUR]),
    /purges_automatique_jour/);
  // La purge de la ligne de commande n'est pas limitée à une par jour.
  assert.ok(await purger(pool, { aujourdhui: JOUR, origine: 'ligne_de_commande' }));
});

test('deux purges simultanées : une seule s\'exécute', options, async () => {
  const resultats = await Promise.all([
    purger(pool, { aujourdhui: '2026-11-20', origine: 'automatique', unParJour: true }),
    purger(pool, { aujourdhui: '2026-11-20', origine: 'automatique', unParJour: true }),
    purger(pool, { aujourdhui: '2026-11-20', origine: 'automatique', unParJour: true }),
  ]);
  assert.equal(resultats.filter(Boolean).length, 1);
  assert.equal(await nombre(`SELECT count(*)::int AS n FROM purges WHERE jour = '2026-11-20'`), 1);
});

// --- Planification -----------------------------------------------------------

function planificateur(instant) {
  const journal = { info: [], error: [] };
  return {
    journal,
    ...creerPlanificateurPurge({
      pool, config, maintenant: () => new Date(instant.valeur),
      log: { info: (...a) => journal.info.push(a), error: (...a) => journal.error.push(a) },
    }),
  };
}
const purgesDuJour = (jour) => nombre(`SELECT count(*)::int AS n FROM purges WHERE jour = $1 AND origine = 'automatique'`, [jour]);

test('la purge automatique n\'a pas lieu avant 3 h, heure de l\'entreprise, hiver comme été', options, async () => {
  const instant = { valeur: '2026-12-01T01:59:00Z' }; // 02:59 à Paris (UTC+1)
  const plan = planificateur(instant);
  assert.equal(await plan.verifier(), null);
  assert.equal(await purgesDuJour('2026-12-01'), 0);
  instant.valeur = '2026-12-01T02:00:00Z'; // 03:00
  assert.equal((await plan.verifier()).avant, '2025-12-01');
  assert.equal(await purgesDuJour('2026-12-01'), 1);
  assert.equal(await plan.verifier(), null); // une fois par jour

  instant.valeur = '2027-07-01T00:59:00Z'; // 02:59 à Paris (UTC+2)
  assert.equal(await plan.verifier(), null);
  instant.valeur = '2027-07-01T01:00:00Z'; // 03:00
  assert.equal((await plan.verifier()).avant, '2026-07-01');
});

test('la date du jour est celle de l\'entreprise, pas celle du serveur', options, async () => {
  // 23 h 30 UTC : il est déjà 00 h 30 le lendemain à Paris, mais pas encore 3 h.
  const instant = { valeur: '2027-03-09T23:30:00Z' };
  assert.equal(await planificateur(instant).verifier(), null);
  // À 3 h le 10 mars à Paris (02:00 UTC), la purge porte bien sur le 10 mars.
  instant.valeur = '2027-03-10T02:00:00Z';
  const resultat = await planificateur(instant).verifier();
  assert.equal(resultat.avant, '2026-03-10');
  assert.equal(await purgesDuJour('2027-03-10'), 1);
});

test('l\'entretien suit la purge : sessions expirées et liens périmés', options, async () => {
  const intervalle = (texte) => `now() - interval '${texte}'`;
  await pool.query(
    `INSERT INTO sessions (jeton_hash, collaborateur_id, expire_le) VALUES ('expiree', $1, ${intervalle('1 hour')}), ('valide', $1, now() + interval '1 hour')`, [ids.alice]);
  await pool.query(
    `INSERT INTO jetons_mot_de_passe (jeton_hash, collaborateur_id, expire_le) VALUES
       ('vieux', $1, ${intervalle('10 days')}), ('recent', $1, ${intervalle('1 day')}), ('valable', $1, now() + interval '1 hour')`, [ids.alice]);
  assert.deepEqual(await entretien(pool), { sessions: 1, jetons: 1 });
  assert.deepEqual((await pool.query('SELECT jeton_hash FROM sessions ORDER BY 1')).rows.map((r) => r.jeton_hash).filter((h) => ['expiree', 'valide'].includes(h)), ['valide']);
  assert.deepEqual((await pool.query('SELECT jeton_hash FROM jetons_mot_de_passe ORDER BY 1')).rows.map((r) => r.jeton_hash), ['recent', 'valable']);
});

test('au démarrage, la purge manquée est rattrapée ; en cas d\'échec elle est consignée dans les journaux et rien n\'est supprimé', options, async () => {
  const instant = { valeur: '2027-08-02T05:00:00Z' }; // bien après 3 h
  const plan = planificateur(instant);
  plan.demarrer();
  await new Promise((resoudre) => setTimeout(resoudre, 400));
  await plan.arreter();
  assert.equal(await purgesDuJour('2027-08-02'), 1);
  assert.equal(plan.journal.info[0][1], 'purge des demandes terminée');

  // Une durée inutilisable : l'erreur est journalisée, aucune demande n'est supprimée.
  const avant = (await idsRestants()).length;
  await definirDuree('abc');
  try {
    instant.valeur = '2027-08-03T05:00:00Z';
    const defaillant = planificateur(instant);
    defaillant.demarrer();
    await new Promise((resoudre) => setTimeout(resoudre, 400));
    await defaillant.arreter();
    assert.equal(defaillant.journal.error.length, 1);
    assert.match(defaillant.journal.error[0][0].message, /Durée de conservation invalide/);
    assert.equal(await purgesDuJour('2027-08-03'), 0);
    assert.equal((await idsRestants()).length, avant);
  } finally {
    await definirDuree(12);
  }
});

// --- Ligne de commande -------------------------------------------------------

test('le script de purge simule par défaut et ne supprime que sur demande explicite', options, async () => {
  const autre = await creerBaseDeTest();
  try {
    const { host, port, database, user, password } = autre.connexionApi;
    const env = {
      ...process.env, DB_HOST: host, DB_PORT: String(port), DB_NAME: database, DB_USER: user, DB_PASSWORD: password,
      APP_URL: 'http://app.test', SMTP_HOST: 'smtp.invalid', SMTP_FROM: 'a@exemple.test',
    };
    const lancer = (...args) => promisify(execFile)(process.execPath, ['scripts/purger.js', ...args], { env });
    const equipe = (await autre.api.query(`INSERT INTO equipes (nom) VALUES ('E') RETURNING id`)).rows[0].id;
    const alice = (await autre.api.query(
      `INSERT INTO collaborateurs (email, nom, prenom, equipe_id) VALUES ('a@exemple.test', 'A', 'A', $1) RETURNING id`, [equipe])).rows[0].id;
    const type = (await autre.api.query(`SELECT id FROM types_absence LIMIT 1`)).rows[0].id;
    for (const [debut, fin] of [['2015-03-02', '2015-03-06'], ['2099-03-02', '2099-03-06']]) {
      const c = await autre.api.connect();
      await c.query('BEGIN');
      const d = await c.query(
        `INSERT INTO demandes (collaborateur_id, equipe_id, type_id, date_debut, date_fin, duree_demi_journees, saisie_par_id)
         VALUES ($1, $2, $3, $4, $5, 2, $1) RETURNING id`, [alice, equipe, type, debut, fin]);
      await c.query(`INSERT INTO evenements_demande (demande_id, type, auteur_id) VALUES ($1, 'soumission', $2)`, [d.rows[0].id, alice]);
      await c.query('COMMIT');
      c.release();
    }
    const demandesRestantes = async () => (await autre.api.query('SELECT count(*)::int AS n FROM demandes')).rows[0].n;

    const simulation = await lancer();
    assert.match(simulation.stdout, /Durée de conservation : 12 mois/);
    assert.match(simulation.stdout, /À supprimer : 1 demande\(s\) terminée\(s\) avant cette date, avec 1 ligne\(s\) d'historique/);
    assert.match(simulation.stdout, /Simulation : rien n'a été supprimé/);
    assert.equal(await demandesRestantes(), 2);

    const execution = await lancer('--executer');
    assert.match(execution.stdout, /Purge effectuée : 1 demande\(s\) et 1 ligne\(s\) d'historique supprimées/);
    assert.equal(await demandesRestantes(), 1);
    const { rows } = await autre.api.query('SELECT origine, demandes_supprimees FROM purges');
    assert.deepEqual(rows, [{ origine: 'ligne_de_commande', demandes_supprimees: 1 }]);

    await autre.api.query(`UPDATE parametres SET valeur = '0' WHERE cle = 'conservation_passe_mois'`);
    await assert.rejects(lancer('--executer'), /Durée de conservation invalide/);
    assert.equal(await demandesRestantes(), 1);
  } finally {
    await autre.fermer();
  }
});
