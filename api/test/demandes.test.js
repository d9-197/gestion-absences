// Tests des demandes contre une vraie base (ignorés si TEST_DB_HOST n'est pas défini).
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
const nombres = (liste) => liste.map(Number).sort((a, b) => a - b);

async function demander(qui, corps, attendu = 201) {
  const reponse = await appel(qui, 'POST', '/api/demandes', { typeId: ids.conges, ...corps });
  assert.equal(reponse.statusCode, attendu, reponse.body);
  return reponse.json();
}
const decider = (qui, id, decision, motif) => appel(qui, 'POST', `/api/demandes/${id}/decision`, { decision, motif });
const lire = async (qui, id) => (await appel(qui, 'GET', `/api/demandes/${id}`)).json();
const statut = async (id) => (await lire('diane', id)).statut;

// Une semaine complète (lundi au vendredi) à partir d'un lundi.
const semaine = (lundi) => {
  const fin = new Date(`${lundi}T00:00:00Z`);
  fin.setUTCDate(fin.getUTCDate() + 4);
  return { dateDebut: lundi, dateFin: fin.toISOString().slice(0, 10) };
};

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
  const personne = async (prenom, equipeId, role, actif = true) => {
    ids[prenom] = Number((await pool.query(
      `INSERT INTO collaborateurs (email, nom, prenom, equipe_id, role, mot_de_passe_hash, actif)
       VALUES ($1, $2, $2, $3, $4, $5, $6) RETURNING id`,
      [`${prenom}@exemple.test`, prenom, equipeId, role, hachage, actif],
    )).rows[0].id);
  };
  await personne('diane', ids.direction, 'directeur');
  await personne('eric', ids.direction, 'directeur');
  await personne('bob', ids.technique, 'responsable'); // responsable de Technique
  await personne('carla', ids.dev, 'responsable'); // responsable de Développement
  await personne('dan', ids.technique, 'responsable'); // délégué de Développement
  await personne('alice', ids.dev, 'collaborateur');
  await personne('chloe', ids.commerce, 'collaborateur');
  await personne('zoe', ids.dev, 'collaborateur', false); // désactivée
  await pool.query('UPDATE equipes SET responsable_id = $2 WHERE id = $1', [ids.direction, ids.diane]);
  await pool.query('UPDATE equipes SET responsable_id = $2 WHERE id = $1', [ids.technique, ids.bob]);
  await pool.query('UPDATE equipes SET responsable_id = $2 WHERE id = $1', [ids.dev, ids.carla]);
  await pool.query('INSERT INTO delegations (equipe_id, delegue_id) VALUES ($1, $2)', [ids.dev, ids.dan]);

  const type = async (libelle) =>
    Number((await pool.query('SELECT id FROM types_absence WHERE libelle = $1', [libelle])).rows[0].id);
  ids.conges = await type('Congés payés');
  ids.maladie = await type('Maladie');

  app = await construireApp({
    pool, config, logger: false, limites: sansLimite, aujourdhui: () => AUJOURDHUI,
    courriel: { envoyer: async () => {} },
  });
  for (const prenom of ['diane', 'eric', 'bob', 'carla', 'dan', 'alice', 'chloe']) {
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

test('toutes les routes exigent une connexion', options, async () => {
  for (const [methode, url] of [
    ['GET', '/api/demandes'], ['GET', '/api/demandes/1'], ['GET', '/api/demandes/compteur'],
    ['GET', '/api/demandes/collaborateurs'], ['GET', '/api/demandes/types'], ['POST', '/api/demandes'], ['POST', '/api/demandes/previsualisation'],
    ['POST', '/api/demandes/1/decision'], ['POST', '/api/demandes/1/retrait'], ['POST', '/api/demandes/1/annulation'],
  ]) {
    assert.equal((await appel('inconnu', methode, url, {})).statusCode, 401, `${methode} ${url}`);
  }
});

// --- Qui peut valider --------------------------------------------------------

test('valideurs : équipe, équipes parentes, délégués et directeurs, un directeur peut valider ses propres demandes, pas les autres rôles', options, async () => {
  const valideurs = async (id) => nombres((await pool.query('SELECT v FROM valideurs_de($1) v', [id])).rows.map((r) => r.v));
  // Alice : responsable de Développement, son délégué, responsable de Technique, directeurs.
  assert.deepEqual(await valideurs(ids.alice), nombres([ids.carla, ids.dan, ids.bob, ids.diane, ids.eric]));
  // Le responsable d'une équipe est validé par l'équipe au-dessus, pas par la sienne ni par son délégué.
  assert.deepEqual(await valideurs(ids.carla), nombres([ids.bob, ids.diane, ids.eric]));
  assert.deepEqual(await valideurs(ids.bob), nombres([ids.diane, ids.eric]));
  // Un directeur est validé par tous les directeurs, lui compris ; les notifications vont d'abord aux autres.
  assert.deepEqual(await valideurs(ids.diane), nombres([ids.diane, ids.eric]));
  const proches = async (id) => nombres((await pool.query('SELECT v FROM valideurs_proches_de($1) v', [id])).rows.map((r) => r.v));
  assert.deepEqual(await proches(ids.diane), [ids.eric]);
  // Une équipe sans responsable remonte aux directeurs.
  assert.deepEqual(await valideurs(ids.chloe), nombres([ids.diane, ids.eric]));
});

test('types proposés à la saisie : les types actifs, pour tous', options, async () => {
  const types = (await appel('alice', 'GET', '/api/demandes/types')).json();
  assert.deepEqual(types.map((t) => t.libelle), [
    'Congés payés', 'RTT', 'Congés spéciaux', 'Sans solde', 'Maladie', 'Jour non travaillé (temps partiel)',
  ]);
  assert.deepEqual(types.find((t) => t.libelle === 'Maladie'), {
    id: ids.maladie, libelle: 'Maladie', approbationRequise: false, delaiPrevenanceJours: null,
  });
});

test('personnes pour lesquelles on peut saisir', options, async () => {
  const pour = async (qui) => (await appel(qui, 'GET', '/api/demandes/collaborateurs')).json();
  assert.deepEqual((await pour('alice')).map((c) => c.id), [ids.alice]);
  assert.deepEqual((await pour('carla')).map((c) => c.id), [ids.carla, ids.alice]);
  assert.deepEqual(nombres((await pour('bob')).map((c) => c.id)), nombres([ids.bob, ids.alice, ids.carla, ids.dan]));
  const diane = await pour('diane');
  assert.equal(diane[0].moi, true);
  assert.equal(diane.length, 7); // tout le monde sauf la personne désactivée
});

// --- Saisie ------------------------------------------------------------------

test('une demande avec approbation part « en attente » avec sa durée', options, async () => {
  const demande = await demander('alice', { ...semaine('2026-12-07'), commentaire: ' Vacances ' });
  assert.equal(demande.statut, 'en_attente');
  assert.equal(demande.nature, 'absence');
  assert.equal(demande.dureeDemiJournees, 10);
  assert.equal(demande.commentaire, 'Vacances');
  assert.deepEqual(demande.avertissements, []);
  assert.equal(demande.collaborateur.id, ids.alice);
  assert.equal(demande.saisiePar.id, ids.alice);
  assert.equal(demande.equipe.nom, 'Développement');
  assert.equal(demande.type.libelle, 'Congés payés');
  assert.deepEqual(demande.actions, { decider: false, retirer: true, annuler: false });
  assert.match(demande.soumiseLe, /^\d{4}-\d{2}-\d{2}T/);
});

test('un type sans approbation est enregistré directement', options, async () => {
  const demande = await demander('alice', { typeId: ids.maladie, dateDebut: '2026-12-14', dateFin: '2026-12-15' });
  assert.equal(demande.statut, 'enregistree');
  assert.equal(demande.dureeDemiJournees, 4);
  assert.equal(demande.actions.decider, false);
  assert.equal(demande.actions.annuler, true);
});

test('la durée tient compte des fériés et des jours imposés de l\'équipe', options, async () => {
  // Vendredi 25 décembre : férié.
  assert.equal((await demander('chloe', semaine('2026-12-21'))).dureeDemiJournees, 8);
  // Mercredi 3 février 2027 fermé pour Technique et ses sous-équipes seulement.
  await pool.query(
    `INSERT INTO jours_imposes (jour, libelle, equipe_id, avec_decompte) VALUES ('2027-02-03', 'Fermeture', $1, false)`,
    [ids.technique],
  );
  assert.equal((await demander('alice', semaine('2027-02-01'))).dureeDemiJournees, 8);
  assert.equal((await demander('chloe', semaine('2027-02-01'))).dureeDemiJournees, 10);
});

test('avertissements : chevauchement, à la demi-journée près', options, async () => {
  const premiere = await demander('chloe', { dateDebut: '2027-01-04', debutDemiJournee: 'apres_midi', dateFin: '2027-01-04', finDemiJournee: 'apres_midi' });
  assert.equal(premiere.dureeDemiJournees, 1);
  assert.deepEqual(premiere.avertissements, []);
  // Le matin du même jour ne chevauche pas.
  const matin = await demander('chloe', { dateDebut: '2027-01-04', debutDemiJournee: 'matin', dateFin: '2027-01-04', finDemiJournee: 'matin' });
  assert.deepEqual(matin.avertissements, []);
  // Une journée entière chevauche les deux.
  const journee = await demander('chloe', { dateDebut: '2027-01-04', dateFin: '2027-01-05' });
  assert.deepEqual(journee.avertissements.map((a) => a.code), ['chevauchement', 'chevauchement']);
  assert.match(journee.avertissements[0].message, /votre demande en attente du 04\/01\/2027 au 04\/01\/2027/);
  assert.equal(journee.avertissements[0].demandeId, matin.id);
  // L'avertissement est conservé avec la demande.
  assert.equal((await lire('chloe', journee.id)).avertissements.length, 2);
  // Une demande retirée ne compte plus.
  for (const id of [premiere.id, matin.id, journee.id]) assert.equal((await appel('chloe', 'POST', `/api/demandes/${id}/retrait`)).statusCode, 200);
  assert.deepEqual((await demander('chloe', { dateDebut: '2027-01-04', dateFin: '2027-01-04' })).avertissements, []);
});

test('avertissements : date passée, délai de prévenance, durée nulle', options, async () => {
  const terminee = await demander('eric', { dateDebut: '2026-11-10', dateFin: '2026-11-12' });
  assert.deepEqual(terminee.avertissements.map((a) => a.message), ['Cette période est déjà terminée']);
  const commencee = await demander('eric', { dateDebut: '2026-11-16', dateFin: '2026-11-18' });
  assert.deepEqual(commencee.avertissements.map((a) => a.code), ['date_passee']);
  assert.equal(commencee.avertissements[0].message, 'Cette période a déjà commencé');

  await pool.query('UPDATE types_absence SET delai_prevenance_jours = 14 WHERE id = $1', [ids.conges]);
  try {
    // Début le 23 novembre : 6 jours après le 17.
    const tard = await demander('eric', { dateDebut: '2026-11-23', dateFin: '2026-11-24' });
    assert.deepEqual(tard.avertissements.map((a) => a.code), ['delai_prevenance']);
    assert.match(tard.avertissements[0].message, /14 jours demandés pour « Congés payés », 6 jours avant/);
    // Pile à 14 jours : respecté. Un type sans délai n'est pas contrôlé.
    assert.deepEqual((await demander('eric', { dateDebut: '2026-12-01', dateFin: '2026-12-01' })).avertissements, []);
    const maladie = await demander('eric', { typeId: ids.maladie, dateDebut: '2026-11-27', dateFin: '2026-11-27' });
    assert.deepEqual(maladie.avertissements, []);
  } finally {
    await pool.query('UPDATE types_absence SET delai_prevenance_jours = NULL WHERE id = $1', [ids.conges]);
  }

  const weekEnd = await demander('chloe', { dateDebut: '2027-03-06', dateFin: '2027-03-07' });
  assert.equal(weekEnd.dureeDemiJournees, 0);
  assert.deepEqual(weekEnd.avertissements.map((a) => a.code), ['duree_nulle']);
});

test('la prévisualisation annonce la même chose que la soumission, sans rien enregistrer', options, async () => {
  const avant = (await pool.query('SELECT count(*)::int AS n FROM demandes')).rows[0].n;
  const corps = { typeId: ids.conges, dateDebut: '2026-12-09', dateFin: '2026-12-09' };
  const apercu = (await appel('alice', 'POST', '/api/demandes/previsualisation', corps)).json();
  assert.equal(apercu.dureeDemiJournees, 2);
  assert.equal(apercu.approbationRequise, true);
  assert.equal(apercu.blocage, null);
  assert.deepEqual(apercu.avertissements.map((a) => a.code), ['chevauchement']);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM demandes')).rows[0].n, avant);
  const reelle = await demander('alice', corps);
  assert.deepEqual(reelle.avertissements, apercu.avertissements);
});

test('règles bloquantes : dates, fenêtre, type et collaborateur', options, async () => {
  const refus = async (corps, motif, statutAttendu = 400) => {
    const reponse = await appel('alice', 'POST', '/api/demandes', { typeId: ids.conges, dateDebut: '2027-04-05', dateFin: '2027-04-06', ...corps });
    assert.equal(reponse.statusCode, statutAttendu, reponse.body);
    assert.match(reponse.json().erreur, motif);
  };
  await refus({ dateDebut: '2027-04-06', dateFin: '2027-04-05' }, /fin précède/);
  await refus({ dateDebut: '2027-04-05', dateFin: '2027-04-05', debutDemiJournee: 'apres_midi', finDemiJournee: 'matin' }, /matin de fin/);
  await refus({ dateDebut: '2027-04-05', dateFin: '2028-04-06' }, /366 jours/);
  await refus({ dateDebut: '2027-12-01', dateFin: '2027-12-02' }, /plus de 12 mois/);
  await refus({ dateDebut: '2025-10-01', dateFin: '2025-10-03' }, /antérieure à 12 mois/);
  await refus({ typeId: 99999 }, /Type d'absence inconnu/);
  await refus({ collaborateurId: 99999 }, /Collaborateur inconnu/);
  await refus({ collaborateurId: ids.zoe }, /Collaborateur inconnu ou désactivé/);
  await refus({ dateDebut: '2027-02-30' }, /Données invalides/);
  await refus({ debutDemiJournee: 'soir' }, /Données invalides/);

  // Le statut ne se choisit pas : un champ inconnu est ignoré, la demande part « en attente ».
  const imposee = await demander('alice', { dateDebut: '2027-04-05', dateFin: '2027-04-06', statut: 'approuvee' });
  assert.equal(imposee.statut, 'en_attente');

  const inactif = Number((await pool.query(
    `INSERT INTO types_absence (libelle, actif) VALUES ('Ancien type', false) RETURNING id`)).rows[0].id);
  await refus({ typeId: inactif }, /inconnu ou désactivé/);
});

test('saisie pour un autre : réservée à ses valideurs', options, async () => {
  const parCarla = await demander('carla', { collaborateurId: ids.alice, ...semaine('2027-03-08') });
  assert.equal(parCarla.collaborateur.id, ids.alice);
  assert.equal(parCarla.saisiePar.id, ids.carla);
  assert.equal((await demander('bob', { collaborateurId: ids.carla, ...semaine('2027-03-15') })).collaborateur.id, ids.carla);
  assert.equal((await demander('diane', { collaborateurId: ids.alice, ...semaine('2027-03-22') })).saisiePar.id, ids.diane);

  // Ni un collaborateur, ni un responsable d'une autre branche, ni un subordonné pour son responsable.
  await demander('alice', { collaborateurId: ids.chloe, ...semaine('2027-03-29') }, 403);
  await demander('chloe', { collaborateurId: ids.alice, ...semaine('2027-03-29') }, 403);
  await demander('alice', { collaborateurId: ids.carla, ...semaine('2027-03-29') }, 403);
  await demander('carla', { collaborateurId: ids.bob, ...semaine('2027-03-29') }, 403);
  await demander('carla', { collaborateurId: ids.chloe, ...semaine('2027-03-29') }, 403);
});

test('une demande qui ne pourrait être validée par personne est refusée', options, async () => {
  // Bob (responsable) n'a de valideurs que les directeurs : sans directeur actif, sa demande ne peut aboutir.
  await pool.query('UPDATE collaborateurs SET actif = false WHERE id = ANY($1)', [[ids.eric, ids.diane]]);
  try {
    const corps = { typeId: ids.conges, ...semaine('2027-04-12') };
    const apercu = (await appel('bob', 'POST', '/api/demandes/previsualisation', corps)).json();
    assert.match(apercu.blocage, /Personne d'autre ne peut valider/);
    assert.equal((await appel('bob', 'POST', '/api/demandes', corps)).statusCode, 409);
    // Une simple déclaration, sans approbation, reste possible.
    await demander('bob', { typeId: ids.maladie, ...semaine('2027-04-12') });
  } finally {
    await pool.query('UPDATE collaborateurs SET actif = true WHERE id = ANY($1)', [[ids.eric, ids.diane]]);
  }
});

// --- Décision ----------------------------------------------------------------

test('approbation : par un valideur, une seule fois', options, async () => {
  const demande = await demander('alice', semaine('2027-01-11'));
  const approuvee = await decider('carla', demande.id, 'approbation');
  assert.equal(approuvee.statusCode, 200);
  assert.equal(approuvee.json().statut, 'approuvee');
  assert.equal(approuvee.json().statutPar.id, ids.carla);
  assert.equal(approuvee.json().actions.decider, false);
  assert.equal(approuvee.json().actions.annuler, true);

  for (const quand of ['dan', 'diane']) {
    const encore = await decider(quand, demande.id, 'refus', 'trop tard');
    assert.equal(encore.statusCode, 409);
    assert.match(encore.json().erreur, /déjà été traitée/);
  }
  assert.equal(await statut(demande.id), 'approuvee');
});

test('refus : le motif est obligatoire', options, async () => {
  const demande = await demander('alice', semaine('2027-01-18'));
  for (const motif of [undefined, '', '   ']) {
    const reponse = await decider('bob', demande.id, 'refus', motif);
    assert.equal(reponse.statusCode, 400);
    assert.match(reponse.json().erreur, /motif est obligatoire/);
  }
  assert.equal(await statut(demande.id), 'en_attente');
  const refusee = await decider('bob', demande.id, 'refus', ' Période de clôture ');
  assert.equal(refusee.json().statut, 'refusee');
  assert.equal(refusee.json().motif, 'Période de clôture');
  assert.equal(refusee.json().statutPar.id, ids.bob);
  // Le motif d'une approbation n'est pas conservé.
  const autre = await demander('alice', semaine('2027-01-25'));
  assert.equal((await decider('bob', autre.id, 'approbation', 'ok')).json().motif, null);
});

test('seul un directeur traite sa propre demande ; personne ne traite celle d\'une autre branche', options, async () => {
  const demande = await demander('alice', semaine('2027-02-08'));
  assert.equal((await decider('alice', demande.id, 'approbation')).statusCode, 403);
  assert.equal((await decider('chloe', demande.id, 'approbation')).statusCode, 404);
  assert.equal((await decider('carla', 99999, 'approbation')).statusCode, 404);
  assert.equal(await statut(demande.id), 'en_attente');

  const responsable = await demander('carla', semaine('2027-02-08'));
  assert.equal((await decider('carla', responsable.id, 'approbation')).statusCode, 403);
  // Le délégué de son équipe ne la traite pas non plus : elle remonte au responsable de l'équipe parente.
  assert.equal((await decider('dan', responsable.id, 'approbation')).statusCode, 404);
  assert.equal((await decider('bob', responsable.id, 'approbation')).statusCode, 200);

  const directeur = await demander('diane', semaine('2027-02-15'));
  assert.equal((await decider('bob', directeur.id, 'approbation')).statusCode, 404);
  const parSoi = await decider('diane', directeur.id, 'approbation');
  assert.equal(parSoi.statusCode, 200);
  assert.equal(parSoi.json().statutPar.id, ids.diane);
  // Un autre directeur peut aussi la traiter.
  const autreDirecteur = await demander('diane', semaine('2027-02-16'));
  assert.equal((await decider('eric', autreDirecteur.id, 'approbation')).statusCode, 200);
});

test('le délégué traite à la place du responsable', options, async () => {
  const demande = await demander('alice', semaine('2027-02-22'));
  assert.equal((await decider('dan', demande.id, 'approbation')).json().statutPar.id, ids.dan);
});

test('une demande peut être saisie puis traitée par la même personne, sans être celle du collaborateur', options, async () => {
  const demande = await demander('carla', { collaborateurId: ids.alice, ...semaine('2027-03-01') });
  assert.equal(demande.actions.decider, true);
  assert.equal(demande.actions.retirer, true);
  const approuvee = await decider('carla', demande.id, 'approbation');
  assert.equal(approuvee.json().statut, 'approuvee');
  // Le journal garde les deux gestes et leur auteur.
  const detail = await lire('alice', demande.id);
  assert.deepEqual(detail.journal.map((e) => [e.type, e.auteur.id]), [['soumission', ids.carla], ['approbation', ids.carla]]);
});

// --- Aperçu : qui examinera la demande ---------------------------------------

test('l\'aperçu annonce qui examinera la demande', options, async () => {
  const apercu = async (qui, corps = {}) => (await appel(qui, 'POST', '/api/demandes/previsualisation',
    { typeId: ids.conges, dateDebut: '2027-06-07', dateFin: '2027-06-07', ...corps })).json();
  const prenoms = (a) => a.valideurs.map((v) => v.prenom);
  assert.deepEqual(prenoms(await apercu('alice')), ['carla', 'dan']); // responsable et délégué de son équipe
  assert.deepEqual(prenoms(await apercu('carla')), ['bob']); // un responsable remonte à l'équipe parente
  assert.deepEqual(prenoms(await apercu('diane')), ['eric']); // un directeur : les autres directeurs
  // Pour un autre, ce sont ceux du collaborateur concerné.
  assert.deepEqual(prenoms(await apercu('bob', { collaborateurId: ids.alice })), ['carla', 'dan']);
  assert.deepEqual((await apercu('alice')).valideurs[0], { prenom: 'carla', nom: 'carla' });
  // Une simple déclaration n'est examinée par personne.
  assert.deepEqual((await apercu('alice', { typeId: ids.maladie })).valideurs, []);
});

// --- Modification d'une demande en attente -----------------------------------

const modifier = (qui, id, corps) => appel(qui, 'POST', `/api/demandes/${id}/modification`, { typeId: ids.conges, ...corps });

test('modifier une demande en attente : elle est retirée et remplacée, avec la référence', options, async () => {
  const ancienne = await demander('alice', { dateDebut: '2027-07-05', dateFin: '2027-07-09', commentaire: 'Premier jet' });
  // La nouvelle période chevauche l'ancienne : ce n'est pas un avertissement, puisque l'ancienne est remplacée.
  const reponse = await modifier('alice', ancienne.id, { dateDebut: '2027-07-07', dateFin: '2027-07-13', commentaire: ' Version corrigée ' });
  assert.equal(reponse.statusCode, 201, reponse.body);
  const nouvelle = reponse.json();
  assert.equal(nouvelle.statut, 'en_attente');
  assert.equal(nouvelle.remplaceId, ancienne.id);
  assert.equal(nouvelle.dateDebut, '2027-07-07');
  assert.equal(nouvelle.dureeDemiJournees, 10);
  assert.equal(nouvelle.commentaire, 'Version corrigée');
  assert.deepEqual(nouvelle.avertissements, []);
  assert.equal(nouvelle.collaborateur.id, ids.alice);

  // L'ancienne reste dans l'historique, retirée, avec le renvoi vers la nouvelle.
  const retiree = await lire('alice', ancienne.id);
  assert.equal(retiree.statut, 'retiree');
  assert.equal(retiree.remplaceId, null);
  const dernier = retiree.journal.at(-1);
  assert.deepEqual([dernier.type, dernier.motif, dernier.auteur.id], ['retrait', `Remplacée par la demande n° ${nouvelle.id}`, ids.alice]);
  // La nouvelle est une demande ordinaire : elle se décide, se retire, s'annule.
  assert.equal((await decider('carla', nouvelle.id, 'approbation')).json().statut, 'approuvee');
});

test('une modification ne laisse jamais la demande d\'origine à moitié modifiée', options, async () => {
  const ancienne = await demander('alice', { dateDebut: '2027-07-19', dateFin: '2027-07-23' });
  for (const corps of [{ typeId: 99999 }, { dateDebut: '2027-07-24', dateFin: '2027-07-20' }, { dateDebut: '2029-01-01', dateFin: '2029-01-02' }]) {
    const refus = await modifier('alice', ancienne.id, { dateDebut: '2027-07-19', dateFin: '2027-07-23', ...corps });
    assert.equal(refus.statusCode, 400, JSON.stringify(corps));
  }
  assert.equal((await lire('alice', ancienne.id)).statut, 'en_attente');
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM demandes WHERE remplace_id = $1', [ancienne.id]);
  assert.equal(rows[0].n, 0);
});

test('l\'aperçu d\'une modification ne compte pas la demande remplacée comme un chevauchement', options, async () => {
  const ancienne = await demander('alice', { dateDebut: '2027-10-04', dateFin: '2027-10-08' });
  const corps = { typeId: ids.conges, dateDebut: '2027-10-05', dateFin: '2027-10-06' };
  const ordinaire = (await appel('alice', 'POST', '/api/demandes/previsualisation', corps)).json();
  assert.deepEqual(ordinaire.avertissements.map((a) => a.code), ['chevauchement']);
  const modification = (await appel('alice', 'POST', '/api/demandes/previsualisation', { ...corps, remplaceId: ancienne.id })).json();
  assert.deepEqual(modification.avertissements, []);
});

test('une demande modifiée garde ses avertissements propres, et ceux des autres demandes', options, async () => {
  const autre = await demander('alice', { dateDebut: '2027-08-09', dateFin: '2027-08-10' });
  const ancienne = await demander('alice', { dateDebut: '2027-08-16', dateFin: '2027-08-17' });
  const nouvelle = (await modifier('alice', ancienne.id, { dateDebut: '2027-08-10', dateFin: '2027-08-11' })).json();
  assert.deepEqual(nouvelle.avertissements.map((a) => a.code), ['chevauchement']);
  assert.equal(nouvelle.avertissements[0].demandeId, autre.id);
});

test('seul l\'auteur modifie, et le collaborateur ne peut pas être changé', options, async () => {
  const parCarla = await demander('carla', { collaborateurId: ids.alice, dateDebut: '2027-08-23', dateFin: '2027-08-24' });
  assert.equal((await modifier('chloe', parCarla.id, { dateDebut: '2027-08-25', dateFin: '2027-08-25' })).statusCode, 404);
  assert.equal((await modifier('dan', parCarla.id, { dateDebut: '2027-08-25', dateFin: '2027-08-25' })).statusCode, 403); // valideur, pas auteur
  // L'auteur de la saisie (carla) comme le collaborateur (alice) peuvent la modifier ; le collaborateur reste alice.
  const parAlice = await modifier('alice', parCarla.id, { dateDebut: '2027-08-25', dateFin: '2027-08-25', collaborateurId: ids.chloe });
  assert.equal(parAlice.statusCode, 201);
  assert.equal(parAlice.json().collaborateur.id, ids.alice);
  assert.equal(parAlice.json().saisiePar.id, ids.alice);
  const parCarla2 = await modifier('carla', parAlice.json().id, { dateDebut: '2027-08-26', dateFin: '2027-08-26' });
  assert.equal(parCarla2.statusCode, 403); // saisie par alice : carla n'en est plus l'auteur
  const encore = await demander('carla', { collaborateurId: ids.alice, dateDebut: '2027-08-30', dateFin: '2027-08-30' });
  assert.equal((await modifier('carla', encore.id, { dateDebut: '2027-08-31', dateFin: '2027-08-31' })).json().saisiePar.id, ids.carla);
});

test('on ne modifie que les demandes d\'absence en attente', options, async () => {
  const corps = { dateDebut: '2027-09-06', dateFin: '2027-09-06' };
  const approuvee = await demander('alice', { dateDebut: '2027-09-07', dateFin: '2027-09-07' });
  await decider('carla', approuvee.id, 'approbation');
  const refusee = await demander('alice', { dateDebut: '2027-09-08', dateFin: '2027-09-08' });
  await decider('carla', refusee.id, 'refus', 'Non');
  const retiree = await demander('alice', { dateDebut: '2027-09-09', dateFin: '2027-09-09' });
  await appel('alice', 'POST', `/api/demandes/${retiree.id}/retrait`);
  const declaration = await demander('alice', { typeId: ids.maladie, dateDebut: '2027-09-10', dateFin: '2027-09-10' });
  const annulation = (await appel('alice', 'POST', `/api/demandes/${approuvee.id}/annulation`, {})).json();
  for (const demande of [approuvee, refusee, retiree, declaration, annulation]) {
    const reponse = await modifier('alice', demande.id, corps);
    assert.equal(reponse.statusCode, 409, `demande ${demande.id}`);
  }
  assert.equal((await modifier('alice', 99999, corps)).statusCode, 404);
  assert.equal((await modifier('inconnu', approuvee.id, corps)).statusCode, 401);
});

test('deux modifications simultanées : une seule passe, et l\'autre ne laisse rien', options, async () => {
  const ancienne = await demander('alice', { dateDebut: '2027-09-13', dateFin: '2027-09-14' });
  const reponses = await Promise.all([
    modifier('alice', ancienne.id, { dateDebut: '2027-09-15', dateFin: '2027-09-15' }),
    modifier('alice', ancienne.id, { dateDebut: '2027-09-16', dateFin: '2027-09-16' }),
  ]);
  assert.deepEqual(reponses.map((r) => r.statusCode).sort(), [201, 409]);
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM demandes WHERE remplace_id = $1', [ancienne.id]);
  assert.equal(rows[0].n, 1);
});

// --- Retrait -----------------------------------------------------------------

test('retrait : par l\'auteur, tant que la demande est en attente', options, async () => {
  const demande = await demander('alice', semaine('2027-04-19'));
  assert.equal((await appel('chloe', 'POST', `/api/demandes/${demande.id}/retrait`)).statusCode, 404);
  assert.equal((await appel('dan', 'POST', `/api/demandes/${demande.id}/retrait`)).statusCode, 403);
  const retiree = await appel('alice', 'POST', `/api/demandes/${demande.id}/retrait`);
  assert.equal(retiree.json().statut, 'retiree');
  assert.equal(retiree.json().actions.retirer, false);
  assert.equal((await appel('alice', 'POST', `/api/demandes/${demande.id}/retrait`)).statusCode, 409);
  assert.equal((await decider('carla', demande.id, 'approbation')).statusCode, 409);

  // La personne qui a saisi pour un autre peut retirer, et le collaborateur aussi.
  const parCarla = await demander('carla', { collaborateurId: ids.alice, ...semaine('2027-04-26') });
  assert.equal((await appel('carla', 'POST', `/api/demandes/${parCarla.id}/retrait`)).json().statut, 'retiree');
  const autre = await demander('carla', { collaborateurId: ids.alice, ...semaine('2027-05-03') });
  assert.equal((await appel('alice', 'POST', `/api/demandes/${autre.id}/retrait`)).json().statut, 'retiree');

  // Une demande approuvée ne se retire plus.
  const approuvee = await demander('alice', semaine('2027-05-10'));
  await decider('carla', approuvee.id, 'approbation');
  assert.equal((await appel('alice', 'POST', `/api/demandes/${approuvee.id}/retrait`)).statusCode, 409);
});

// --- Annulation --------------------------------------------------------------

test('annulation : une demande liée, validée par le même circuit', options, async () => {
  const origine = await demander('alice', semaine('2027-05-17'));
  assert.equal((await appel('alice', 'POST', `/api/demandes/${origine.id}/annulation`, {})).statusCode, 409); // pas encore approuvée
  await decider('carla', origine.id, 'approbation');

  const reponse = await appel('alice', 'POST', `/api/demandes/${origine.id}/annulation`, { commentaire: 'Projet reporté' });
  assert.equal(reponse.statusCode, 201, reponse.body);
  const annulation = reponse.json();
  assert.equal(annulation.nature, 'annulation');
  assert.equal(annulation.demandeAnnuleeId, origine.id);
  assert.equal(annulation.statut, 'en_attente');
  assert.equal(annulation.commentaire, 'Projet reporté');
  assert.equal(annulation.dateDebut, origine.dateDebut);
  assert.equal(annulation.dureeDemiJournees, origine.dureeDemiJournees);
  assert.deepEqual(annulation.avertissements, []);
  assert.equal(annulation.actions.annuler, false);

  // L'absence reste valable jusqu'à la décision, et une seule annulation à la fois.
  const enCours = await lire('alice', origine.id);
  assert.equal(enCours.statut, 'approuvee');
  assert.equal(enCours.annulationEnCours, true);
  assert.equal(enCours.actions.annuler, false);
  const doublon = await appel('alice', 'POST', `/api/demandes/${origine.id}/annulation`, {});
  assert.equal(doublon.statusCode, 409);
  assert.match(doublon.json().erreur, /déjà en cours/);

  assert.equal((await decider('carla', annulation.id, 'approbation')).json().statut, 'approuvee');
  assert.equal(await statut(origine.id), 'annulee');
  assert.equal((await lire('alice', origine.id)).actions.annuler, false);
  const journal = (await lire('alice', origine.id)).journal;
  assert.deepEqual(journal.map((e) => e.type), ['soumission', 'approbation', 'annulation']);
  assert.equal(journal[2].auteur.id, ids.carla); // l'annulation est actée par la personne qui a validé

  // Une demande d'annulation ne s'annule pas.
  const impossible = await appel('alice', 'POST', `/api/demandes/${annulation.id}/annulation`, {});
  assert.equal(impossible.statusCode, 409);
  assert.match(impossible.json().erreur, /ne peut pas être annulée/);
});

test('annulation refusée : l\'absence reste approuvée et peut être annulée de nouveau', options, async () => {
  const origine = await demander('alice', semaine('2027-05-24'));
  await decider('carla', origine.id, 'approbation');
  const premiere = (await appel('alice', 'POST', `/api/demandes/${origine.id}/annulation`, {})).json();
  assert.equal((await decider('carla', premiere.id, 'refus', 'Trop tard')).json().statut, 'refusee');
  assert.equal(await statut(origine.id), 'approuvee');
  const lue = await lire('alice', origine.id);
  assert.equal(lue.annulationEnCours, false);
  assert.equal(lue.actions.annuler, true);
  const seconde = await appel('alice', 'POST', `/api/demandes/${origine.id}/annulation`, {});
  assert.equal(seconde.statusCode, 201);
  // Retirer la demande d'annulation laisse aussi l'absence en l'état.
  await appel('alice', 'POST', `/api/demandes/${seconde.json().id}/retrait`);
  assert.equal(await statut(origine.id), 'approuvee');
});

test('annulation : d\'une déclaration, immédiate ; par un valideur, jamais par un tiers', options, async () => {
  const maladie = await demander('alice', { typeId: ids.maladie, dateDebut: '2027-06-01', dateFin: '2027-06-02' });
  assert.equal((await appel('chloe', 'POST', `/api/demandes/${maladie.id}/annulation`, {})).statusCode, 404);
  const annulation = await appel('carla', 'POST', `/api/demandes/${maladie.id}/annulation`, {});
  assert.equal(annulation.statusCode, 201);
  assert.equal(annulation.json().statut, 'enregistree');
  assert.equal(annulation.json().saisiePar.id, ids.carla);
  assert.equal(await statut(maladie.id), 'annulee');
});

test('annulation : possible même si le type a été désactivé depuis', options, async () => {
  const type = Number((await pool.query(
    `INSERT INTO types_absence (libelle) VALUES ('Type éphémère') RETURNING id`)).rows[0].id);
  const origine = await demander('alice', { typeId: type, ...semaine('2027-06-07') });
  await decider('carla', origine.id, 'approbation');
  await pool.query('UPDATE types_absence SET actif = false WHERE id = $1', [type]);
  assert.equal((await appel('alice', 'POST', `/api/demandes/${origine.id}/annulation`, {})).statusCode, 201);
});

// --- Consultation ------------------------------------------------------------

test('détail : le journal dans l\'ordre, visible des seules personnes concernées', options, async () => {
  const demande = await demander('chloe', semaine('2027-06-14'));
  await decider('eric', demande.id, 'approbation');
  const detail = await lire('chloe', demande.id);
  assert.deepEqual(detail.journal.map((e) => [e.type, e.auteur.prenom]), [['soumission', 'chloe'], ['approbation', 'eric']]);
  assert.equal((await appel('diane', 'GET', `/api/demandes/${demande.id}`)).statusCode, 200);
  for (const qui of ['alice', 'carla', 'bob', 'dan']) {
    assert.equal((await appel(qui, 'GET', `/api/demandes/${demande.id}`)).statusCode, 404, qui);
  }
  assert.equal((await appel('alice', 'GET', '/api/demandes/abc')).statusCode, 400);
});

test('listes : mes demandes et demandes à gérer', options, async () => {
  const mes = (await appel('alice', 'GET', '/api/demandes')).json();
  assert.ok(mes.length > 5);
  assert.ok(mes.every((d) => d.collaborateur.id === ids.alice));
  assert.ok(mes.some((d) => d.saisiePar.id === ids.carla)); // saisies par le responsable comprises
  const dates = mes.map((d) => d.dateDebut);
  assert.deepEqual(dates, [...dates].sort().reverse());

  const enAttente = (await appel('alice', 'GET', '/api/demandes?statut=en_attente')).json();
  assert.ok(enAttente.length > 0 && enAttente.every((d) => d.statut === 'en_attente'));
  assert.equal((await appel('alice', 'GET', '/api/demandes?statut=inconnu')).statusCode, 400);

  const geree = async (qui, query = '') => (await appel(qui, 'GET', `/api/demandes?portee=gerees${query}`)).json();
  const parCarla = await geree('carla');
  assert.ok(parCarla.length > 0);
  assert.ok(parCarla.every((d) => [ids.alice].includes(d.collaborateur.id)));
  assert.deepEqual(await geree('chloe'), []);
  assert.deepEqual(await geree('alice'), []);
  const parDiane = await geree('diane');
  const auteurs = new Set(parDiane.map((d) => d.collaborateur.id));
  for (const id of [ids.alice, ids.chloe, ids.eric, ids.carla]) assert.ok(auteurs.has(id), `diane ne voit pas ${id}`);
  assert.ok(auteurs.has(ids.diane)); // un directeur traite aussi ses propres demandes

  for (const qui of ['carla', 'bob', 'diane', 'chloe']) {
    const compteur = (await appel(qui, 'GET', '/api/demandes/compteur')).json();
    assert.equal(compteur.aTraiter, (await geree(qui, '&statut=en_attente')).length, qui);
  }
  assert.equal((await appel('chloe', 'GET', '/api/demandes/compteur')).json().aTraiter, 0);
});

test('la base garde l\'historique : rien n\'a été modifié ni supprimé', options, async () => {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS demandes,
            (SELECT count(*)::int FROM evenements_demande) AS evenements,
            (SELECT count(*)::int FROM demandes d WHERE NOT EXISTS (SELECT 1 FROM evenements_demande e WHERE e.demande_id = d.id)) AS sans_journal
     FROM demandes`,
  );
  assert.ok(rows[0].demandes > 20);
  assert.ok(rows[0].evenements >= rows[0].demandes);
  assert.equal(rows[0].sans_journal, 0);
});
