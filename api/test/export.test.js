// Tests de l'export des absences contre une vraie base (ignorés si TEST_DB_HOST n'est pas défini).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import readXlsxFile from 'read-excel-file/node';
import { construireApp } from '../src/app.js';
import { hacher } from '../src/auth/mots-de-passe.js';
import { COLONNES } from '../src/export/service.js';
import { creerBaseDeTest, hote, options } from './aide-base.js';

const config = { appUrl: 'http://app.test', cookieSecure: false, sessionDureeHeures: 12 };
const sansLimite = { connexion: { max: 10000, timeWindow: '1 minute' }, oubli: { max: 10000, timeWindow: '1 minute' } };
const MOT_DE_PASSE = 'un mot de passe solide';
const NOMS = { diane: 'Martin', eric: 'Leroy', bob: 'Petit', carla: 'Roux', dan: 'Blanc', alice: 'Durand', chloe: 'Noir' };
const ENTETES = COLONNES.map((c) => c.titre);

let baseDeTest;
let pool;
let app;
const sessions = {};
const ids = {};
const demandes = {};

const appel = (qui, method, url, payload) => app.inject({ method, url, payload, cookies: sessions[qui] ?? {} });
const exporter = (qui, requete = '', format = 'csv') =>
  appel(qui, 'GET', `/api/export/absences?debut=2026-12-01&fin=2026-12-31&format=${format}${requete}`);

async function demander(qui, corps, attendu = 201) {
  const reponse = await appel(qui, 'POST', '/api/demandes', { typeId: ids.conges, ...corps });
  assert.equal(reponse.statusCode, attendu, reponse.body);
  return reponse.json();
}
const decider = (qui, id, decision, motif) => appel(qui, 'POST', `/api/demandes/${id}/decision`, { decision, motif });

// Lit un CSV : sans la marque d'ordre des octets, découpé en lignes puis en champs (sans cas de guillemets ici).
const lignesCsv = (texte) => texte.replace(/^\ufeff/, '').split('\r\n').filter(Boolean).map((l) => l.split(';'));
const lire = async (qui, requete = '') => {
  const reponse = await exporter(qui, requete);
  assert.equal(reponse.statusCode, 200, reponse.body);
  const [, ...lignes] = lignesCsv(reponse.body);
  return lignes;
};
const idsDe = (lignes) => lignes.map((l) => Number(l[0]));
const heureParis = (valeur) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
}).format(new Date(valeur));

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
  const creer = async (cle, prenom, nom, equipeId, role) => {
    ids[cle] = Number((await pool.query(
      `INSERT INTO collaborateurs (email, nom, prenom, equipe_id, role, mot_de_passe_hash)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [`${cle}@exemple.test`, nom, prenom, equipeId, role, hachage],
    )).rows[0].id);
  };
  await creer('diane', 'Diane', NOMS.diane, ids.direction, 'directeur');
  await creer('eric', 'Eric', NOMS.eric, ids.direction, 'directeur');
  await creer('bob', 'Bob', NOMS.bob, ids.technique, 'responsable');
  await creer('carla', 'Carla', NOMS.carla, ids.dev, 'responsable');
  await creer('dan', 'Dan', NOMS.dan, ids.technique, 'responsable'); // délégué de Développement
  await creer('alice', 'Alice', NOMS.alice, ids.dev, 'collaborateur');
  await creer('chloe', 'Chloe', NOMS.chloe, ids.commerce, 'collaborateur');
  await pool.query('UPDATE equipes SET responsable_id = $2 WHERE id = $1', [ids.direction, ids.diane]);
  await pool.query('UPDATE equipes SET responsable_id = $2 WHERE id = $1', [ids.technique, ids.bob]);
  await pool.query('UPDATE equipes SET responsable_id = $2 WHERE id = $1', [ids.dev, ids.carla]);
  await pool.query('INSERT INTO delegations (equipe_id, delegue_id) VALUES ($1, $2)', [ids.dev, ids.dan]);
  const type = async (libelle) =>
    Number((await pool.query('SELECT id FROM types_absence WHERE libelle = $1', [libelle])).rows[0].id);
  ids.conges = await type('Congés payés');
  ids.rtt = await type('RTT');
  ids.maladie = await type('Maladie');

  app = await construireApp({
    pool, config, logger: false, limites: sansLimite, aujourdhui: () => '2026-11-17',
    courriel: { envoyer: async () => {} },
  });
  for (const cle of ['diane', 'eric', 'bob', 'carla', 'dan', 'alice', 'chloe']) {
    const connexion = await app.inject({
      method: 'POST', url: '/api/auth/connexion', payload: { email: `${cle}@exemple.test`, motDePasse: MOT_DE_PASSE },
    });
    sessions[cle] = { absences_session: connexion.cookies.find((c) => c.name === 'absences_session').value };
  }

  // Un jeu d'absences qui couvre tous les statuts.
  demandes.approuvee = await demander('alice', { dateDebut: '2026-12-07', debutDemiJournee: 'apres_midi', dateFin: '2026-12-09', finDemiJournee: 'matin' });
  await decider('carla', demandes.approuvee.id, 'approbation');
  demandes.attente = await demander('alice', { typeId: ids.rtt, dateDebut: '2026-12-14', dateFin: '2026-12-14' });
  demandes.maladie = await demander('alice', { typeId: ids.maladie, dateDebut: '2026-12-21', dateFin: '2026-12-22' });
  demandes.refusee = await demander('alice', { dateDebut: '2026-12-01', dateFin: '2026-12-01' });
  await decider('carla', demandes.refusee.id, 'refus', 'Période de clôture');
  demandes.retiree = await demander('alice', { dateDebut: '2026-12-02', dateFin: '2026-12-02' });
  await appel('alice', 'POST', `/api/demandes/${demandes.retiree.id}/retrait`);
  demandes.annulee = await demander('alice', { dateDebut: '2026-12-03', dateFin: '2026-12-03' });
  await decider('carla', demandes.annulee.id, 'approbation');
  const annulation = (await appel('alice', 'POST', `/api/demandes/${demandes.annulee.id}/annulation`, {})).json();
  await decider('dan', annulation.id, 'approbation'); // approuvée par le délégué, pas par la même personne
  demandes.chloe = await demander('chloe', { dateDebut: '2026-12-08', dateFin: '2026-12-09' });
  await decider('diane', demandes.chloe.id, 'approbation');
  demandes.diane = await demander('diane', { typeId: ids.rtt, dateDebut: '2026-12-10', dateFin: '2026-12-10' });
  await decider('eric', demandes.diane.id, 'approbation');
  demandes.bob = await demander('bob', { dateDebut: '2026-12-15', dateFin: '2026-12-15' });
  await decider('diane', demandes.bob.id, 'approbation');
  demandes.carla = await demander('carla', { dateDebut: '2026-12-16', dateFin: '2026-12-16' });
});

after(async () => {
  await app?.close();
  await baseDeTest?.fermer();
});

// --- Accès et validation -------------------------------------------------------

test('l\'export est réservé aux responsables et aux directeurs', options, async () => {
  assert.equal((await exporter('inconnu')).statusCode, 401);
  assert.equal((await exporter('alice')).statusCode, 403);
  assert.equal((await exporter('chloe')).statusCode, 403);
  assert.equal((await appel('alice', 'GET', '/api/export/options')).statusCode, 403);
  for (const qui of ['carla', 'dan', 'bob', 'diane']) assert.equal((await exporter(qui)).statusCode, 200, qui);
});

test('période, format et filtres invalides refusés', options, async () => {
  const essai = (requete) => appel('diane', 'GET', `/api/export/absences${requete}`);
  for (const requete of ['', '?debut=2026-12-01', '?fin=2026-12-31', '?debut=2026-02-30&fin=2026-03-01',
    '?debut=2026-12-31&fin=2026-12-01', '?debut=2024-01-01&fin=2026-12-31',
    '?debut=2026-12-01&fin=2026-12-31&format=pdf', '?debut=2026-12-01&fin=2026-12-31&statut=approuvee,inconnu',
    '?debut=2026-12-01&fin=2026-12-31&equipeId=abc', '?debut=2026-12-01&fin=2026-12-31&typeId=0']) {
    assert.equal((await essai(requete)).statusCode, 400, requete);
  }
  // La limite est de 731 jours : 730 jours passent, 1 096 non.
  assert.equal((await essai('?debut=2025-01-01&fin=2026-12-31')).statusCode, 200);
});

// --- Périmètre ---------------------------------------------------------------

test('chacun n\'exporte que ce qu\'il a le droit de voir', options, async () => {
  const proprietaires = async (qui) => {
    const lignes = await lire(qui);
    return [...new Set(lignes.map((l) => `${l[2]} ${l[1]}`))].sort();
  };
  // Un responsable : les personnes de son équipe, jamais lui-même.
  assert.deepEqual(await proprietaires('carla'), ['Alice Durand']);
  assert.deepEqual(await proprietaires('dan'), ['Alice Durand']);
  // Le responsable de l'équipe parente : Développement compris, mais ni lui, ni les autres branches.
  assert.deepEqual(await proprietaires('bob'), ['Alice Durand', 'Carla Roux']);
  // Les directeurs : toute l'entreprise, y compris leurs propres absences.
  assert.deepEqual(await proprietaires('diane'), ['Alice Durand', 'Bob Petit', 'Carla Roux', 'Chloe Noir', 'Diane Martin']);
  assert.deepEqual(await proprietaires('eric'), await proprietaires('diane'));
  assert.equal((await lire('carla')).length, 6);
  assert.equal((await lire('bob')).length, 7);
  assert.equal((await lire('diane')).length, 10);
});

test('un filtre ne permet pas de sortir de son périmètre', options, async () => {
  assert.deepEqual(await lire('bob', `&collaborateurId=${ids.chloe}`), []);
  assert.deepEqual(await lire('bob', `&equipeId=${ids.commerce}`), []);
  assert.deepEqual(await lire('carla', `&collaborateurId=${ids.bob}`), []);
});

// --- Contenu -----------------------------------------------------------------

test('un fichier trié par nom, prénom puis date de début', options, async () => {
  const lignes = await lire('diane');
  assert.deepEqual(lignes.map((l) => `${l[1]} ${l[5]}`), [
    'Durand 2026-12-01', 'Durand 2026-12-02', 'Durand 2026-12-03', 'Durand 2026-12-07', 'Durand 2026-12-14', 'Durand 2026-12-21',
    'Martin 2026-12-10', 'Noir 2026-12-08', 'Petit 2026-12-15', 'Roux 2026-12-16',
  ]);
});

test('les colonnes d\'une absence approuvée', options, async () => {
  const [ligne] = (await lire('diane')).filter((l) => Number(l[0]) === demandes.approuvee.id);
  const evenement = (await pool.query(
    `SELECT cree_le FROM evenements_demande WHERE demande_id = $1 AND type = 'approbation'`, [demandes.approuvee.id])).rows[0];
  assert.deepEqual(ligne, [
    String(demandes.approuvee.id), 'Durand', 'Alice', 'Développement', 'Congés payés',
    '2026-12-07', 'Après-midi', '2026-12-09', 'Matin', '4', 'Approuvée', 'Carla Roux', heureParis(evenement.cree_le),
  ]);
});

test('statut, valideur et date de décision selon la situation de la demande', options, async () => {
  const lignes = await lire('diane');
  const de = (demande) => lignes.find((l) => Number(l[0]) === demande.id);

  assert.deepEqual([de(demandes.attente)[10], de(demandes.attente)[11], de(demandes.attente)[12]], ['En attente', '', '']);
  assert.deepEqual([de(demandes.refusee)[10], de(demandes.refusee)[11]], ['Refusée', 'Carla Roux']);
  assert.match(de(demandes.refusee)[12], /^\d{4}-\d\d-\d\d \d\d:\d\d$/);
  // Une déclaration sans approbation : la personne qui l'a enregistrée.
  assert.deepEqual([de(demandes.maladie)[10], de(demandes.maladie)[11]], ['Enregistrée', 'Alice Durand']);
  assert.deepEqual([de(demandes.retiree)[10], de(demandes.retiree)[11], de(demandes.retiree)[12]], ['Retirée', '', '']);
  // Une absence annulée garde sa décision d'origine, et non celle de l'annulation (prise par un autre).
  assert.deepEqual([de(demandes.annulee)[10], de(demandes.annulee)[11]], ['Annulée', 'Carla Roux']);
  assert.equal(de(demandes.annulee)[12], heureParis((await pool.query(
    `SELECT cree_le FROM evenements_demande WHERE demande_id = $1 AND type = 'approbation'`, [demandes.annulee.id])).rows[0].cree_le));
  // Les demandes d'annulation elles-mêmes ne sont pas des absences : aucune ligne à part.
  assert.equal(lignes.length, 10);
});

// --- Filtres -----------------------------------------------------------------

test('filtre par statut', options, async () => {
  const valables = await lire('diane', '&statut=approuvee,enregistree');
  assert.deepEqual(valables.map((l) => l[10]).sort(), ['Approuvée', 'Approuvée', 'Approuvée', 'Approuvée', 'Enregistrée']);
  assert.deepEqual(idsDe(await lire('diane', '&statut=en_attente')).sort((a, b) => a - b), [demandes.attente.id, demandes.carla.id].sort((a, b) => a - b));
  assert.deepEqual(idsDe(await lire('diane', '&statut=annulee')), [demandes.annulee.id]);
  assert.equal((await lire('diane', '&statut=refusee,retiree')).length, 2);
});

test('filtre par type et par collaborateur', options, async () => {
  assert.deepEqual(idsDe(await lire('diane', `&typeId=${ids.maladie}`)), [demandes.maladie.id]);
  assert.deepEqual(idsDe(await lire('diane', `&typeId=${ids.rtt}`)).sort((a, b) => a - b), [demandes.attente.id, demandes.diane.id].sort((a, b) => a - b));
  assert.deepEqual(idsDe(await lire('diane', `&collaborateurId=${ids.chloe}`)), [demandes.chloe.id]);
  assert.equal((await lire('diane', `&collaborateurId=${ids.alice}`)).length, 6);
});

test('filtre par équipe : l\'équipe de la demande et ses sous-équipes', options, async () => {
  assert.equal((await lire('diane', `&equipeId=${ids.technique}`)).length, 8); // Technique, avec Développement
  assert.equal((await lire('diane', `&equipeId=${ids.dev}`)).length, 7);
  assert.deepEqual(idsDe(await lire('diane', `&equipeId=${ids.commerce}`)), [demandes.chloe.id]);
  assert.equal((await lire('diane', `&equipeId=${ids.direction}`)).length, 10);
});

test('filtre par période : toute absence qui touche la période, bornes incluses', options, async () => {
  const sur = async (debut, fin) => idsDe(await (async () => {
    const reponse = await appel('diane', 'GET', `/api/export/absences?debut=${debut}&fin=${fin}&format=csv`);
    return lignesCsv(reponse.body).slice(1);
  })()).sort((a, b) => a - b);
  assert.deepEqual(await sur('2026-12-08', '2026-12-08'), [demandes.approuvee.id, demandes.chloe.id].sort((a, b) => a - b));
  assert.deepEqual(await sur('2026-12-10', '2026-12-10'), [demandes.diane.id]);
  assert.deepEqual(await sur('2026-12-07', '2026-12-07'), [demandes.approuvee.id]);
  assert.deepEqual(await sur('2026-12-23', '2026-12-31'), []);
  // Une absence qui commence avant la période et la touche est incluse.
  assert.ok((await sur('2026-12-09', '2026-12-09')).includes(demandes.approuvee.id));
});

test('plusieurs filtres se cumulent', options, async () => {
  assert.deepEqual(idsDe(await lire('diane', `&equipeId=${ids.dev}&statut=en_attente`)).sort((a, b) => a - b),
    [demandes.attente.id, demandes.carla.id].sort((a, b) => a - b));
  assert.deepEqual(idsDe(await lire('diane', `&equipeId=${ids.dev}&statut=en_attente&typeId=${ids.rtt}`)), [demandes.attente.id]);
  assert.deepEqual(await lire('diane', `&collaborateurId=${ids.chloe}&typeId=${ids.maladie}`), []);
});

// --- Formats -----------------------------------------------------------------

test('CSV : séparateur, encodage, fins de ligne et en-têtes pour Excel', options, async () => {
  const reponse = await exporter('diane');
  assert.equal(reponse.headers['content-type'], 'text/csv; charset=utf-8');
  assert.equal(reponse.headers['content-disposition'], 'attachment; filename="absences_2026-12-01_2026-12-31.csv"');
  assert.equal(reponse.headers['x-lignes'], '10');
  assert.equal(reponse.headers['cache-control'], 'no-store');
  assert.ok(reponse.body.startsWith('\ufeff'));
  assert.ok(reponse.body.endsWith('\r\n'));
  assert.equal(reponse.body.split('\r\n').filter(Boolean).length, 11);
  assert.equal(reponse.body.slice(1).split('\r\n')[0], ENTETES.join(';'));
  assert.equal(ENTETES.join(';'),
    "N° demande;Nom;Prénom;Équipe;Type d'absence;Début;Début (demi-journée);Fin;Fin (demi-journée);Durée (demi-journées);Statut;Valideur;Date de décision");
  // Une cellule vide reste vide, sans valeur parasite.
  const attente = reponse.body.split('\r\n').find((l) => l.startsWith(`${demandes.attente.id};`));
  assert.ok(attente.endsWith(';En attente;;'));
});

test('un export vide contient les en-têtes et annonce zéro ligne', options, async () => {
  const reponse = await appel('diane', 'GET', '/api/export/absences?debut=2027-06-01&fin=2027-06-30&format=csv');
  assert.equal(reponse.statusCode, 200);
  assert.equal(reponse.headers['x-lignes'], '0');
  assert.equal(reponse.body, `\ufeff${ENTETES.join(';')}\r\n`);
  const xlsx = await appel('diane', 'GET', '/api/export/absences?debut=2027-06-01&fin=2027-06-30&format=xlsx');
  assert.equal((await readXlsxFile(xlsx.rawPayload))[0].data.length, 1);
});

test('XLSX : un vrai classeur, avec des dates et des nombres', options, async () => {
  const reponse = await exporter('diane', '', 'xlsx');
  assert.equal(reponse.statusCode, 200);
  assert.equal(reponse.headers['content-type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(reponse.headers['content-disposition'], 'attachment; filename="absences_2026-12-01_2026-12-31.xlsx"');
  assert.equal(reponse.headers['x-lignes'], '10');
  assert.equal(reponse.rawPayload.subarray(0, 2).toString(), 'PK');

  const [feuille] = await readXlsxFile(reponse.rawPayload);
  assert.equal(feuille.sheet, 'Absences');
  assert.deepEqual(feuille.data[0], ENTETES);
  assert.equal(feuille.data.length, 11);

  const ligne = feuille.data.find((l) => l[0] === demandes.approuvee.id);
  assert.equal(typeof ligne[0], 'number');
  assert.equal(typeof ligne[9], 'number');
  assert.ok(ligne[5] instanceof Date);
  assert.equal(ligne[5].toISOString().slice(0, 10), '2026-12-07');
  assert.equal(ligne[7].toISOString().slice(0, 10), '2026-12-09');
  assert.deepEqual([ligne[1], ligne[2], ligne[3], ligne[4], ligne[6], ligne[8], ligne[9], ligne[10], ligne[11]],
    ['Durand', 'Alice', 'Développement', 'Congés payés', 'Après-midi', 'Matin', 4, 'Approuvée', 'Carla Roux']);
  // L'heure de décision affichée est celle de l'entreprise.
  const evenement = (await pool.query(
    `SELECT cree_le FROM evenements_demande WHERE demande_id = $1 AND type = 'approbation'`, [demandes.approuvee.id])).rows[0];
  // La lecture d'un classeur arrondit les fractions de jour : on compare à la minute près.
  const aLaMinute = new Date(Math.round(ligne[12].getTime() / 60000) * 60000);
  assert.equal(aLaMinute.toISOString().slice(0, 16).replace('T', ' '), heureParis(evenement.cree_le));
  // Une cellule sans valeur est vide.
  const attente = feuille.data.find((l) => l[0] === demandes.attente.id);
  assert.deepEqual([attente[11], attente[12]], [null, null]);
});

test('CSV et XLSX contiennent les mêmes données', options, async () => {
  const csv = lignesCsv((await exporter('bob')).body).slice(1);
  const [{ data }] = await readXlsxFile((await exporter('bob', '', 'xlsx')).rawPayload);
  const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v);
  const attendu = data.slice(1).map((l) => l.map((v) => (v === null ? '' : String(iso(v)))));
  // Les colonnes « Date de décision » diffèrent seulement par le format (jour et heure) : on compare le reste.
  const sansDecision = (lignes) => lignes.map((l) => l.slice(0, 12));
  assert.deepEqual(sansDecision(csv), sansDecision(attendu));
});

test('une cellule qui ressemble à une formule ne s\'exécute jamais', options, async () => {
  const equipeId = Number((await pool.query(`INSERT INTO equipes (nom, parent_id) VALUES ('R;D', $1) RETURNING id`, [ids.direction])).rows[0].id);
  const zed = Number((await pool.query(
    `INSERT INTO collaborateurs (email, nom, prenom, equipe_id, role) VALUES ('zed@exemple.test', '=1+1', 'O"Neil', $1, 'collaborateur') RETURNING id`,
    [equipeId])).rows[0].id);
  const demande = await demander('diane', { collaborateurId: zed, typeId: ids.maladie, dateDebut: '2026-12-28', dateFin: '2026-12-28' });

  const csv = (await exporter('diane')).body.split('\r\n').find((l) => l.startsWith(`${demande.id};`));
  assert.ok(csv.startsWith(`${demande.id};'=1+1;"O""Neil";"R;D";`), csv); // formule neutralisée, guillemets et « ; » protégés

  const [{ data }] = await readXlsxFile((await exporter('diane', '', 'xlsx')).rawPayload);
  const ligne = data.find((l) => l[0] === demande.id);
  assert.deepEqual([ligne[1], ligne[2], ligne[3]], ['=1+1', 'O"Neil', 'R;D']); // un texte, jamais une formule
});

// --- Options des filtres -----------------------------------------------------

test('les options des filtres suivent le périmètre', options, async () => {
  const options_ = async (qui) => (await appel(qui, 'GET', '/api/export/options')).json();
  const carla = await options_('carla');
  assert.deepEqual(carla.collaborateurs.map((c) => c.id), [ids.alice]);
  assert.deepEqual(carla.equipes.map((e) => e.nom), ['Développement', 'Direction', 'Technique']);
  assert.deepEqual(carla.types.map((t) => t.libelle), ['Congés payés', 'RTT', 'Congés spéciaux', 'Sans solde', 'Maladie', 'Jour non travaillé (temps partiel)']);

  const diane = await options_('diane');
  assert.equal(diane.collaborateurs.length, 8); // tout le monde, y compris la personne ajoutée plus haut
  assert.deepEqual(diane.collaborateurs.slice(0, 2).map((c) => c.nom), ['=1+1', 'Blanc']);
  assert.equal(diane.equipes.length, 5);
});
