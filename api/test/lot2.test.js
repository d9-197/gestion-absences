// Lot « responsables et directeurs » : délégations datées, journal d'administration, couverture, approbation en lot,
// résumés et relances, tableau de bord, jours imposés par période, import de collaborateurs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { construireApp } from '../src/app.js';
import { hacher } from '../src/auth/mots-de-passe.js';
import { ajouterJours, estWeekEnd } from '../src/calendrier/dates.js';
import { envoyerResumes, lireReglagesNotification } from '../src/emails/resume.js';
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
const jourReel = (decalage = 0) => ajouterJours(new Date().toISOString().slice(0, 10), decalage);
const valideursDe = async (id) => (await pool.query('SELECT valideurs_de($1) AS v', [id])).rows.map((r) => Number(r.v));

async function demander(qui, corps, attendu = 201) {
  const reponse = await appel(qui, 'POST', '/api/demandes', { typeId: ids.conges, ...corps });
  assert.equal(reponse.statusCode, attendu, reponse.body);
  return reponse.json();
}
const decider = (qui, id, decision, motif) => appel(qui, 'POST', `/api/demandes/${id}/decision`, { decision, motif });

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
  const hachage = await hacher(MOT_DE_PASSE);
  const personne = async (prenom, equipeId, role) => {
    ids[prenom] = Number((await pool.query(
      `INSERT INTO collaborateurs (email, nom, prenom, equipe_id, role, mot_de_passe_hash)
       VALUES ($1, $2, $2, $3, $4, $5) RETURNING id`,
      [`${prenom}@exemple.test`, prenom, equipeId, role, hachage],
    )).rows[0].id);
  };
  await personne('diane', ids.direction, 'directeur');
  await personne('bob', ids.technique, 'responsable');
  await personne('carla', ids.dev, 'responsable');
  await personne('dan', ids.technique, 'responsable');
  await personne('alice', ids.dev, 'collaborateur');
  await personne('ana', ids.dev, 'collaborateur');
  await personne('chloe', ids.commerce, 'collaborateur');
  await pool.query('UPDATE equipes SET responsable_id = $2 WHERE id = $1', [ids.direction, ids.diane]);
  await pool.query('UPDATE equipes SET responsable_id = $2 WHERE id = $1', [ids.technique, ids.bob]);
  await pool.query('UPDATE equipes SET responsable_id = $2 WHERE id = $1', [ids.dev, ids.carla]);
  ids.conges = Number((await pool.query(`SELECT id FROM types_absence WHERE libelle = 'Congés payés'`)).rows[0].id);

  app = await construireApp({
    pool, config, logger: false, limites: sansLimite, aujourdhui: () => AUJOURDHUI, courriel: { envoyer: async () => {} },
  });
  for (const prenom of ['diane', 'bob', 'carla', 'dan', 'alice', 'ana', 'chloe']) {
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

// --- Délégations avec dates ---------------------------------------------------------------------------------------

test('délégation : active seulement dans ses dates', options, async () => {
  const deleguer = (delegations) => appel('diane', 'PUT', `/api/admin/equipes/${ids.dev}/delegues`, { delegations });

  const expiree = await deleguer([{ delegueId: ids.dan, dateDebut: jourReel(-10), dateFin: jourReel(-1) }]);
  assert.equal(expiree.statusCode, 200, expiree.body);
  assert.deepEqual(expiree.json().delegations, [{ delegueId: ids.dan, dateDebut: jourReel(-10), dateFin: jourReel(-1), active: false }]);
  assert.deepEqual(expiree.json().delegueIds, [ids.dan]);
  assert.ok(!(await valideursDe(ids.alice)).includes(ids.dan), 'expirée : Dan ne valide plus');

  await deleguer([{ delegueId: ids.dan, dateDebut: jourReel(1), dateFin: null }]);
  assert.ok(!(await valideursDe(ids.alice)).includes(ids.dan), 'pas encore commencée');

  const encours = await deleguer([{ delegueId: ids.dan, dateDebut: jourReel(-1), dateFin: jourReel(1) }]);
  assert.equal(encours.json().delegations[0].active, true);
  assert.ok((await valideursDe(ids.alice)).includes(ids.dan), 'en cours : Dan valide');
  // Dan est aussi « le plus proche » pour la notification, avec Carla.
  const proches = (await pool.query('SELECT valideurs_proches_de($1) AS v', [ids.alice])).rows.map((r) => Number(r.v));
  assert.deepEqual(proches.sort((a, b) => a - b), [ids.carla, ids.dan].sort((a, b) => a - b));

  // Sans date : permanente. Ancienne forme du corps toujours acceptée.
  const permanente = await appel('diane', 'PUT', `/api/admin/equipes/${ids.dev}/delegues`, { delegueIds: [ids.dan] });
  assert.deepEqual(permanente.json().delegations, [{ delegueId: ids.dan, dateDebut: null, dateFin: null, active: true }]);

  assert.equal((await deleguer([{ delegueId: ids.dan, dateDebut: '2026-12-10', dateFin: '2026-12-01' }])).statusCode, 400);
  assert.equal((await deleguer([{ delegueId: ids.dan }, { delegueId: ids.dan }])).statusCode, 400);
  assert.equal((await appel('diane', 'PUT', `/api/admin/equipes/${ids.dev}/delegues`, {})).statusCode, 400);
  assert.equal((await deleguer([{ delegueId: ids.alice }])).statusCode, 400, 'un collaborateur ne peut pas être délégué');

  await deleguer([]);
  assert.ok(!(await valideursDe(ids.alice)).includes(ids.dan));
});

// --- Journal d'administration -------------------------------------------------------------------------------------

test('journal : chaque modification est tracée, les lectures et les échecs ne le sont pas', options, async () => {
  const avant = (await appel('diane', 'GET', '/api/admin/journal')).json();
  await appel('diane', 'GET', '/api/admin/equipes');
  await appel('diane', 'PATCH', '/api/admin/collaborateurs/999999', { role: 'directeur' }); // 404 : pas de trace
  const modif = await appel('diane', 'PATCH', `/api/admin/collaborateurs/${ids.chloe}`, { role: 'responsable' });
  assert.equal(modif.statusCode, 200);
  const creation = await appel('diane', 'POST', '/api/admin/equipes', { nom: 'Support' });
  assert.equal(creation.statusCode, 201);
  await appel('diane', 'PATCH', `/api/admin/collaborateurs/${ids.chloe}`, { role: 'collaborateur' });

  const apres = (await appel('diane', 'GET', '/api/admin/journal')).json();
  const nouvelles = apres.lignes.slice(0, apres.lignes.length - avant.lignes.length);
  assert.equal(nouvelles.length, 3);
  const [retour, equipeCreee, promotion] = nouvelles; // les plus récentes d'abord
  assert.equal(promotion.action, "Modification d'un collaborateur");
  assert.equal(promotion.cible, 'chloe chloe (chloe@exemple.test)');
  assert.equal(promotion.auteur, 'diane diane');
  assert.deepEqual(promotion.details.corps, { role: 'responsable' });
  assert.equal(retour.details.corps.role, 'collaborateur');
  assert.equal(equipeCreee.action, "Création d'une équipe");
  assert.equal(equipeCreee.cible, 'Support');

  // Réservé aux directeurs ; la table est en ajout seul.
  assert.equal((await appel('bob', 'GET', '/api/admin/journal')).statusCode, 403);
  await assert.rejects(pool.query('UPDATE journal_admin SET action = $1', ['x']), /permission denied|ajout seul/);
  await assert.rejects(pool.query('DELETE FROM journal_admin'), /permission denied|ajout seul/);

  const page = (await appel('diane', 'GET', '/api/admin/journal?limite=2')).json();
  assert.equal(page.lignes.length, 2);
  assert.ok(page.suite);
  const suite = (await appel('diane', 'GET', `/api/admin/journal?limite=2&avant=${page.suite}`)).json();
  assert.ok(suite.lignes.every((l) => l.id < page.suite));
});

// --- Couverture, tri, approbation en lot --------------------------------------------------------------------------

test('couverture : les collègues de l\'équipe absents pendant la période, pour les valideurs seulement', options, async () => {
  const absenceAna = await demander('ana', { dateDebut: '2026-12-14', dateFin: '2026-12-16' });
  await decider('carla', absenceAna.id, 'approbation');
  const demandeAlice = await demander('alice', { dateDebut: '2026-12-15', dateFin: '2026-12-18' });
  await demander('chloe', { dateDebut: '2026-12-15', dateFin: '2026-12-15' }); // autre équipe : jamais comptée

  const couverture = (await appel('carla', 'GET', `/api/demandes/${demandeAlice.id}/couverture`)).json();
  assert.equal(couverture.equipe.nom, 'Développement');
  assert.equal(couverture.effectif, 3); // Alice, Ana, Carla
  assert.deepEqual(couverture.absences.map((a) => [a.collaborateur.prenom, a.statut, a.dateDebut, a.dateFin]), [['ana', 'confirmee', '2026-12-14', '2026-12-16']]);

  assert.equal((await appel('alice', 'GET', `/api/demandes/${demandeAlice.id}/couverture`)).statusCode, 403);
  assert.equal((await appel('chloe', 'GET', `/api/demandes/${demandeAlice.id}/couverture`)).statusCode, 404);

  const liste = (await appel('carla', 'GET', '/api/demandes?portee=gerees&statut=en_attente')).json();
  assert.equal(liste.find((d) => d.id === demandeAlice.id).collegueAbsents, 1);

  // Pas de chevauchement à la demi-journée près : Ana finit le 16 au matin, Alice commence l'après-midi.
  const ana2 = await demander('ana', { dateDebut: '2026-12-21', dateFin: '2026-12-21', finDemiJournee: 'matin' });
  await decider('carla', ana2.id, 'approbation');
  const apres = await demander('alice', { dateDebut: '2026-12-21', debutDemiJournee: 'apres_midi', dateFin: '2026-12-22' });
  const c2 = (await appel('carla', 'GET', `/api/demandes/${apres.id}/couverture`)).json();
  assert.equal(c2.absences.length, 0);
});

test('approbation en lot : seulement les demandes sans avertissement, chacune à part', options, async () => {
  const propre1 = await demander('alice', { dateDebut: '2027-02-01', dateFin: '2027-02-02' });
  const propre2 = await demander('alice', { dateDebut: '2027-03-01', dateFin: '2027-03-02' });
  const passee = await demander('alice', { dateDebut: '2026-11-10', dateFin: '2026-11-10' });
  assert.ok(passee.avertissements.length > 0);
  const retiree = await demander('alice', { dateDebut: '2027-04-05', dateFin: '2027-04-06' });
  await appel('alice', 'POST', `/api/demandes/${retiree.id}/retrait`);
  const autre = await demander('chloe', { dateDebut: '2027-05-03', dateFin: '2027-05-04' });

  const reponse = await appel('carla', 'POST', '/api/demandes/decision-lot', { ids: [propre1.id, propre2.id, passee.id, retiree.id, autre.id, 999999] });
  assert.equal(reponse.statusCode, 200, reponse.body);
  const { approuvees, ignorees } = reponse.json();
  assert.deepEqual(approuvees, [propre1.id, propre2.id]);
  assert.deepEqual(ignorees.map((i) => i.id), [passee.id, retiree.id, autre.id, 999999]);
  assert.match(ignorees[0].raison, /avertissements/);
  assert.match(ignorees[1].raison, /Déjà traitée/);
  assert.match(ignorees[2].raison, /introuvable/);

  const lue = (await appel('carla', 'GET', `/api/demandes/${propre1.id}`)).json();
  assert.equal(lue.statut, 'approuvee');
  assert.equal(lue.statutPar.id, ids.carla);
  assert.equal((await appel('alice', 'POST', '/api/demandes/decision-lot', { ids: [passee.id] })).json().approuvees.length, 0, 'un collaborateur ne décide pas');
  assert.equal((await appel('carla', 'POST', '/api/demandes/decision-lot', { ids: [] })).statusCode, 400);
});

// --- Résumé quotidien et relances ---------------------------------------------------------------------------------

test('résumé quotidien et relances', options, async () => {
  const courriers = async () => (await pool.query(`SELECT destinataire, sujet, corps FROM envois_email WHERE modele = 'resume' ORDER BY id`)).rows;
  // Un jour ouvré dans une semaine : les demandes y ont 7 jours ou plus d'ancienneté.
  let jour = jourReel(7);
  while (estWeekEnd(jour)) jour = ajouterJours(jour, 1);

  // Par défaut (e-mails immédiats, pas de relance) : rien.
  assert.deepEqual(await lireReglagesNotification(pool), { mode: 'immediat', relanceJours: 0 });
  assert.equal(await envoyerResumes(pool, { jour, appUrl: config.appUrl }), null);

  const nouvelle = await demander('alice', { dateDebut: '2027-06-07', dateFin: '2027-06-08' });
  assert.ok(nouvelle.id);
  // Le réglage se fait par l'administration, réservée aux directeurs.
  assert.equal((await appel('bob', 'PUT', '/api/admin/notifications', { mode: 'quotidien', relanceJours: 2 })).statusCode, 403);
  assert.equal((await appel('diane', 'PUT', '/api/admin/notifications', { mode: 'quotidien', relanceJours: 999 })).statusCode, 400);
  const regle = await appel('diane', 'PUT', '/api/admin/notifications', { mode: 'quotidien', relanceJours: 2 });
  assert.deepEqual([regle.json().mode, regle.json().relanceJours], ['quotidien', 2]);

  // Plus d'e-mail immédiat « à traiter » en mode quotidien.
  const avant = (await pool.query(`SELECT count(*)::int AS n FROM envois_email WHERE modele = 'a_traiter'`)).rows[0].n;
  await demander('alice', { dateDebut: '2027-06-14', dateFin: '2027-06-15' });
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM envois_email WHERE modele = 'a_traiter'`)).rows[0].n, avant);

  // Pas de résumé le week-end.
  assert.equal(await envoyerResumes(pool, { jour: ajouterJours(jour, (6 - new Date(`${jour}T00:00:00Z`).getUTCDay() + 7) % 7), appUrl: config.appUrl }), null);

  const resultat = await envoyerResumes(pool, { jour, appUrl: config.appUrl });
  assert.ok(resultat.envoyes >= 2, JSON.stringify(resultat));
  const envoyes = await courriers();
  const pour = (prenom) => envoyes.find((e) => e.destinataire === `${prenom}@exemple.test`);
  // Les demandes d'Alice (équipe Développement) : Carla est la plus proche ; en retard de plus de 2 × 2 jours, la chaîne
  // au-dessus (Bob responsable de Technique, Diane directrice) est relancée aussi.
  assert.match(pour('carla').corps, /Alice|alice/);
  assert.match(pour('carla').corps, /en attente depuis \d+ jours/);
  assert.match(pour("carla").corps, /Relance : \d+ demandes sont en attente/);
  assert.match(pour('carla').corps, /http:\/\/app\.test\/a-traiter/);
  assert.match(pour('bob').sujet, /Relance/);
  assert.match(pour('diane').sujet, /Relance/);
  assert.equal(pour('dan'), undefined, 'Dan n\'est pas délégué : aucun résumé');
  assert.equal(pour('chloe'), undefined, 'un collaborateur ne reçoit pas de résumé');

  // Une seule fois par jour.
  assert.equal(await envoyerResumes(pool, { jour, appUrl: config.appUrl }), null);
  assert.equal((await pool.query('SELECT envoyes FROM resumes_quotidiens WHERE jour = $1', [jour])).rows[0].envoyes, resultat.envoyes);

  // La file les envoie comme les autres e-mails.
  const messages = [];
  const { traiterFile } = await import('../src/emails/file.js');
  await traiterFile({ pool, courriel: { envoyer: async (m) => messages.push(m) }, config });
  const resume = messages.find((m) => m.a === 'carla@exemple.test' && /à traiter|Relance/.test(m.sujet));
  assert.ok(resume);
  assert.equal(resume.pieces, undefined);

  // Mode immédiat avec relances seules : une demande récente n'en déclenche pas.
  await appel('diane', 'PUT', '/api/admin/notifications', { mode: 'immediat', relanceJours: 30 });
  let jour2 = ajouterJours(jour, 1);
  while (estWeekEnd(jour2)) jour2 = ajouterJours(jour2, 1);
  assert.equal((await envoyerResumes(pool, { jour: jour2, appUrl: config.appUrl })).envoyes, 0);
  await appel('diane', 'PUT', '/api/admin/notifications', { mode: 'immediat', relanceJours: 0 });
});

// --- Tableau de bord ----------------------------------------------------------------------------------------------

test('tableau de bord : absents du jour et de la semaine, anciennes demandes, e-mails, purge', options, async () => {
  const absence = await demander('ana', { dateDebut: AUJOURDHUI, debutDemiJournee: 'apres_midi', dateFin: AUJOURDHUI }, 201);
  await decider('carla', absence.id, 'approbation');
  const tableau = (await appel('diane', 'GET', '/api/admin/tableau-de-bord')).json();
  assert.equal(tableau.jour, AUJOURDHUI);
  const ana = tableau.absentsAujourdhui.find((a) => a.prenom === 'ana');
  assert.deepEqual([ana.matin, ana.apresMidi, ana.statut, ana.equipe], [false, true, 'confirmee', 'Développement']);
  assert.equal(tableau.semaine.length, 7);
  assert.equal(tableau.semaine[0].jour, '2026-11-16'); // lundi de la semaine du mardi 17
  const mardi = tableau.semaine[1];
  assert.deepEqual([mardi.matin, mardi.apresMidi], [0, 1]);
  assert.equal(tableau.semaine[5].travaille, false);
  assert.equal(typeof tableau.enAttente.total, 'number');
  assert.equal(tableau.enAttente.seuilJours, 3);
  assert.deepEqual(Object.keys(tableau.emails), ['echecs', 'enAttente']);
  assert.equal(tableau.purge.moisConservation, 12);
  assert.equal((await appel('bob', 'GET', '/api/admin/tableau-de-bord')).statusCode, 403);
});

// --- Jours imposés : période et copie -----------------------------------------------------------------------------

test('jours imposés : une période, puis la copie sur l\'année suivante', options, async () => {
  const plage = await appel('diane', 'POST', '/api/admin/jours-imposes/plage', {
    debut: '2026-12-24', fin: '2027-01-04', libelle: 'Fermeture de fin d\'année', avecDecompte: true,
  });
  assert.equal(plage.statusCode, 201, plage.body);
  // 24, 28, 29, 30, 31 déc. ; 1er janv. férié ; 4 janv. : week-ends et 25/12, 1/1 fériés exclus. Le 25 est férié.
  const calendrier = (await appel('diane', 'GET', '/api/admin/calendrier?annee=2026')).json();
  const jours = calendrier.joursImposes.map((j) => j.jour);
  assert.deepEqual(jours, ['2026-12-24', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31']);
  assert.equal(plage.json().ajoutes, 6); // + le 4 janvier 2027
  const encore = await appel('diane', 'POST', '/api/admin/jours-imposes/plage', {
    debut: '2026-12-28', fin: '2026-12-31', libelle: 'Autre', avecDecompte: true,
  });
  assert.deepEqual([encore.json().ajoutes, encore.json().dejaPresents], [0, 4], 'les jours déjà imposés sont laissés');

  assert.equal((await appel('diane', 'POST', '/api/admin/jours-imposes/plage', { debut: '2026-12-31', fin: '2026-12-01', libelle: 'x', avecDecompte: true })).statusCode, 400);
  assert.equal((await appel('diane', 'POST', '/api/admin/jours-imposes/plage', { debut: '2026-12-26', fin: '2026-12-27', libelle: 'x', avecDecompte: true })).statusCode, 400, 'week-end seul : rien à ajouter');
  assert.equal((await appel('bob', 'POST', '/api/admin/jours-imposes/plage', { debut: '2026-12-24', fin: '2026-12-24', libelle: 'x', avecDecompte: true })).statusCode, 403);

  const copie = await appel('diane', 'POST', '/api/admin/jours-imposes/copie', { anneeSource: 2026, anneeCible: 2028 });
  assert.equal(copie.statusCode, 201, copie.body);
  assert.deepEqual(copie.json(), { trouves: 5, ajoutes: 5, ignores: 0 });
  assert.equal((await appel('diane', 'POST', '/api/admin/jours-imposes/copie', { anneeSource: 2026, anneeCible: 2028 })).json().ajoutes, 0, 'idempotent');
  assert.equal((await appel('diane', 'POST', '/api/admin/jours-imposes/copie', { anneeSource: 2026, anneeCible: 2026 })).statusCode, 400);
});

// --- Import CSV ---------------------------------------------------------------------------------------------------

test('import de collaborateurs : simulation, tout ou rien, rapport par ligne', options, async () => {
  const importer = (csv, simulation = false) => appel('diane', 'POST', '/api/admin/collaborateurs/import', { csv, simulation });
  const entete = 'Email;Nom;Prénom;Équipe;Rôle\r\n';
  const bon = `${entete}luc@exemple.test;Martin;Luc;développement;\r\n"nina@exemple.test";"Dupont, Jr";Nina;Commerce;Responsable\r\n`;

  const simulation = await importer(bon, true);
  assert.equal(simulation.statusCode, 200, simulation.body);
  assert.equal(simulation.json().valide, true);
  assert.equal(simulation.json().importes, 0);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM collaborateurs WHERE email = 'luc@exemple.test'`)).rows[0].n, 0);

  const mauvais = await importer(`${entete}alice@exemple.test;X;Y;Développement;\n;Sans;Mail;Développement;\nz@exemple.test;Z;Z;Inconnue;chef\nluc@exemple.test;A;B;Développement;\nluc@exemple.test;A;B;Développement;\n`);
  const rapport = mauvais.json();
  assert.equal(mauvais.statusCode, 200);
  assert.equal(rapport.valide, false);
  assert.match(rapport.lignes[0].erreurs[0], /déjà utilisée/);
  assert.match(rapport.lignes[1].erreurs[0], /invalide/);
  assert.match(rapport.lignes[2].erreurs.join(), /équipe inconnue/);
  assert.match(rapport.lignes[2].erreurs.join(), /rôle inconnu/);
  assert.match(rapport.lignes[4].erreurs[0], /en double/);
  assert.equal(rapport.lignes[4].ligne, 6);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM collaborateurs WHERE email = 'luc@exemple.test'`)).rows[0].n, 0, 'tout ou rien');

  const reel = await importer(bon);
  assert.equal(reel.statusCode, 201, reel.body);
  assert.equal(reel.json().importes, 2);
  const nina = (await pool.query(`SELECT nom, role, equipe_id FROM collaborateurs WHERE email = 'nina@exemple.test'`)).rows[0];
  assert.deepEqual([nina.nom, nina.role, Number(nina.equipe_id)], ['Dupont, Jr', 'responsable', ids.commerce]);

  assert.equal((await importer('juste une ligne')).statusCode, 400);
  assert.equal((await importer('a;b\n1;2')).statusCode, 400);
  assert.equal((await appel('bob', 'POST', '/api/admin/collaborateurs/import', { csv: bon })).statusCode, 403);

  // Le journal garde la trace, sans recopier le fichier.
  const journal = (await appel('diane', 'GET', '/api/admin/journal?limite=5')).json().lignes.find((l) => l.action === 'Import de collaborateurs');
  assert.match(journal.details.corps.csv, /^\(fichier de \d+ caractères\)$/);
});
