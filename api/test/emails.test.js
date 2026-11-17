// Tests des e-mails et du PDF de décision contre une vraie base (ignorés si TEST_DB_HOST n'est pas défini).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { construireApp } from '../src/app.js';
import { hacher } from '../src/auth/mots-de-passe.js';
import { enfiler } from '../src/emails/file.js';
import { creerBaseDeTest, hote, options } from './aide-base.js';
import { nombreDePages, texteDuPdf } from './aide-pdf.js';

const config = { appUrl: 'http://app.test', cookieSecure: false, sessionDureeHeures: 12 };
const sansLimite = { connexion: { max: 10000, timeWindow: '1 minute' }, oubli: { max: 10000, timeWindow: '1 minute' } };
const MOT_DE_PASSE = 'un mot de passe solide';
const NOMS = {
  diane: 'Martin', eric: 'Leroy', bob: 'Petit', carla: 'Roux', dan: 'Blanc', alice: 'Durand', chloe: 'Noir', ines: 'Vert',
};

let baseDeTest;
let pool;
let app;
let panne = false;
const boite = [];
const sessions = {};
const ids = {};

const appel = (qui, method, url, payload) => app.inject({ method, url, payload, cookies: sessions[qui] ?? {} });
const adresse = (prenom) => `${prenom}@exemple.test`;
const trier = (liste) => [...liste].sort();

// Envoie ce qui est en file et rend les messages partis.
async function envoyer() {
  boite.length = 0;
  await app.fileEmails.traiter();
  return boite.splice(0);
}
const destinataires = (messages) => trier(messages.map((m) => m.a));
const avecPdf = (messages) => trier(messages.filter((m) => m.pieces).map((m) => m.a));

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
  ids.isolee = await equipe('Équipe isolée'); // racine sans responsable : on remonte aux directeurs

  const hachage = await hacher(MOT_DE_PASSE);
  const personne = async (prenom, equipeId, role) => {
    ids[prenom] = Number((await pool.query(
      `INSERT INTO collaborateurs (email, nom, prenom, equipe_id, role, mot_de_passe_hash)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [adresse(prenom), NOMS[prenom], prenom[0].toUpperCase() + prenom.slice(1), equipeId, role, hachage],
    )).rows[0].id);
  };
  await personne('diane', ids.direction, 'directeur');
  await personne('eric', ids.direction, 'directeur');
  await personne('bob', ids.technique, 'responsable');
  await personne('carla', ids.dev, 'responsable');
  await personne('dan', ids.technique, 'responsable'); // délégué de Développement
  await personne('alice', ids.dev, 'collaborateur');
  await personne('chloe', ids.commerce, 'collaborateur');
  await personne('ines', ids.isolee, 'collaborateur');
  await pool.query('UPDATE equipes SET responsable_id = $2 WHERE id = $1', [ids.direction, ids.diane]);
  await pool.query('UPDATE equipes SET responsable_id = $2 WHERE id = $1', [ids.technique, ids.bob]);
  await pool.query('UPDATE equipes SET responsable_id = $2 WHERE id = $1', [ids.dev, ids.carla]);
  await pool.query('INSERT INTO delegations (equipe_id, delegue_id) VALUES ($1, $2)', [ids.dev, ids.dan]);

  const type = async (libelle) =>
    Number((await pool.query('SELECT id FROM types_absence WHERE libelle = $1', [libelle])).rows[0].id);
  ids.conges = await type('Congés payés');
  ids.maladie = await type('Maladie');

  app = await construireApp({
    pool, config, logger: false, limites: sansLimite, aujourdhui: () => '2026-11-17',
    courriel: {
      envoyer: async (message) => {
        if (panne) throw new Error('SMTP indisponible');
        boite.push(message);
      },
    },
  });
  for (const prenom of ['diane', 'eric', 'bob', 'carla', 'dan', 'alice', 'chloe', 'ines']) {
    const connexion = await app.inject({
      method: 'POST', url: '/api/auth/connexion', payload: { email: adresse(prenom), motDePasse: MOT_DE_PASSE },
    });
    sessions[prenom] = { absences_session: connexion.cookies.find((c) => c.name === 'absences_session').value };
  }
});

after(async () => {
  await app?.close();
  await baseDeTest?.fermer();
});

// --- Qui est prévenu ---------------------------------------------------------

test('valideurs_proches_de : le niveau le plus proche, à défaut les directeurs', options, async () => {
  const proches = async (id) =>
    (await pool.query('SELECT v FROM valideurs_proches_de($1) v', [id])).rows.map((r) => Number(r.v)).sort((a, b) => a - b);
  const nombres = (...personnes) => personnes.map((p) => ids[p]).sort((a, b) => a - b);
  assert.deepEqual(await proches(ids.alice), nombres('carla', 'dan')); // responsable et délégué de son équipe
  assert.deepEqual(await proches(ids.carla), nombres('bob')); // un responsable remonte à l'équipe parente
  assert.deepEqual(await proches(ids.dan), nombres('bob'));
  assert.deepEqual(await proches(ids.chloe), nombres('diane')); // équipe sans responsable : celle du dessus
  assert.deepEqual(await proches(ids.diane), nombres('eric')); // un directeur : les autres directeurs
  assert.deepEqual(await proches(ids.ines), nombres('diane', 'eric')); // aucune équipe responsable : les directeurs
});

test('une demande à valider prévient les valideurs les plus proches, sans PDF', options, async () => {
  await envoyer();
  const demande = await demander('alice', { dateDebut: '2026-12-14', dateFin: '2026-12-18', commentaire: 'Vacances de fin d\'année' });
  const messages = await envoyer();
  assert.deepEqual(destinataires(messages), [adresse('carla'), adresse('dan')]);
  assert.deepEqual(avecPdf(messages), []);
  const [message] = messages;
  assert.equal(message.sujet, 'Demande à traiter : Alice Durand - Congés payés, 14/12/2026 au 18/12/2026');
  for (const attendu of ['Alice Durand (Développement)', 'Type : Congés payés',
    'Période : du lundi 14 décembre 2026 au vendredi 18 décembre 2026', 'Durée : 5 jours',
    'Commentaire : Vacances de fin d\'année', 'http://app.test/a-traiter']) {
    assert.ok(message.texte.includes(attendu), `« ${attendu} » absent de l'e-mail`);
  }
  assert.ok(!message.texte.includes('Avertissements'));
  assert.ok(demande.id > 0);
});

test('les avertissements de la saisie figurent dans l\'e-mail au valideur', options, async () => {
  await demander('alice', { dateDebut: '2026-12-16', dateFin: '2026-12-16' }); // chevauche la précédente
  const [message] = await envoyer();
  assert.match(message.texte, /Avertissements affichés à la saisie :\n {2}- Cette période chevauche votre demande en attente/);
});

test('selon l\'équipe, les destinataires remontent d\'un niveau', options, async () => {
  await demander('chloe', { dateDebut: '2027-01-11', dateFin: '2027-01-11' });
  assert.deepEqual(destinataires(await envoyer()), [adresse('diane')]);
  await demander('carla', { dateDebut: '2027-01-11', dateFin: '2027-01-11' });
  assert.deepEqual(destinataires(await envoyer()), [adresse('bob')]);
  await demander('ines', { dateDebut: '2027-01-11', dateFin: '2027-01-11' });
  assert.deepEqual(destinataires(await envoyer()), trier([adresse('diane'), adresse('eric')]));
  await demander('diane', { dateDebut: '2027-01-11', dateFin: '2027-01-11' });
  assert.deepEqual(destinataires(await envoyer()), [adresse('eric')]);
});

// --- Décision et PDF ---------------------------------------------------------

test('une approbation envoie le PDF au collaborateur, au valideur et aux directeurs', options, async () => {
  await envoyer();
  const demande = await demander('alice', { dateDebut: '2027-02-01', dateFin: '2027-02-05', commentaire: 'Congés de février' });
  await envoyer();
  assert.equal((await decider('carla', demande.id, 'approbation')).statusCode, 200);

  const messages = await envoyer();
  const attendus = trier(['alice', 'carla', 'diane', 'eric'].map(adresse));
  assert.deepEqual(destinataires(messages), attendus);
  assert.deepEqual(avecPdf(messages), attendus);
  for (const message of messages) {
    assert.equal(message.sujet, 'Demande approuvée : Alice Durand - Congés payés, 01/02/2027 au 05/02/2027');
    assert.match(message.texte, /La demande d'absence de Alice Durand a été approuvée par Carla Roux le \d\d\/\d\d\/\d{4} à \d\d:\d\d/);
    assert.match(message.texte, /joint à ce message \(PDF\)/);
    assert.equal(message.pieces.length, 1);
    assert.equal(message.pieces[0].filename, `demande-${demande.id}-approuvee.pdf`);
    assert.equal(message.pieces[0].contentType, 'application/pdf');
  }

  const pdf = messages[0].pieces[0].content;
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal(nombreDePages(pdf), 1);
  const texte = texteDuPdf(pdf);
  for (const attendu of ["Demande d'absence approuvée", `Demande n° ${demande.id}`, 'Alice Durand', 'Développement', 'Congés payés',
    'du lundi 1 février 2027 au vendredi 5 février 2027', '5 jours ouvrés', 'Congés de février', 'Approuvée', 'Carla Roux']) {
    assert.ok(texte.includes(attendu), `« ${attendu} » absent du PDF`);
  }
  // Les quatre destinataires reçoivent le même PDF.
  assert.ok(messages.every((m) => texteDuPdf(m.pieces[0].content) === texte));
});

test('un refus joint le PDF avec son motif', options, async () => {
  const demande = await demander('alice', { dateDebut: '2027-02-08', dateFin: '2027-02-08' });
  await envoyer();
  await decider('bob', demande.id, 'refus', 'Période de clôture comptable');
  const messages = await envoyer();
  assert.deepEqual(destinataires(messages), trier(['alice', 'bob', 'diane', 'eric'].map(adresse)));
  assert.match(messages[0].sujet, /^Demande refusée : /);
  assert.match(messages[0].texte, /Motif du refus : Période de clôture comptable/);
  const texte = texteDuPdf(messages[0].pieces[0].content);
  assert.ok(texte.includes("Demande d'absence refusée"));
  assert.ok(texte.includes('Motif du refus'));
  assert.ok(texte.includes('Période de clôture comptable'));
  assert.equal(messages[0].pieces[0].filename, `demande-${demande.id}-refusee.pdf`);
});

test('une décision sur la demande d\'un directeur : chacun ne reçoit qu\'un e-mail', options, async () => {
  const demande = await demander('diane', { dateDebut: '2027-02-15', dateFin: '2027-02-15' });
  await envoyer();
  await decider('eric', demande.id, 'approbation');
  const messages = await envoyer();
  // Diane (collaboratrice et directrice) et Éric (valideur et directeur) : deux personnes, deux e-mails.
  assert.deepEqual(destinataires(messages), trier([adresse('diane'), adresse('eric')]));
  assert.deepEqual(avecPdf(messages), trier([adresse('diane'), adresse('eric')]));
});

test('les mentions et la raison sociale réglées par les directeurs figurent dans le PDF', options, async () => {
  const reglage = await appel('diane', 'PUT', '/api/admin/parametres-pdf', {
    raisonSociale: '  Société Exemple SAS  ', mentions: 'Document à conserver 5 ans.\n12 rue des Lilas, 75001 Paris.',
  });
  assert.deepEqual(reglage.json(), { raisonSociale: 'Société Exemple SAS', mentions: 'Document à conserver 5 ans.\n12 rue des Lilas, 75001 Paris.' });

  const demande = await demander('alice', { dateDebut: '2027-02-22', dateFin: '2027-02-22' });
  await envoyer();
  await decider('carla', demande.id, 'approbation');
  const [message] = await envoyer();
  const texte = texteDuPdf(message.pieces[0].content);
  assert.ok(texte.includes('Société Exemple SAS'));
  assert.ok(texte.includes('Document à conserver 5 ans.'));
  assert.ok(texte.includes('12 rue des Lilas, 75001 Paris.'));
  assert.match(message.texte, /--\nSociété Exemple SAS\n/);
});

// --- Déclarations, annulations, retraits -------------------------------------

test('une déclaration sans approbation : information au responsable, PDF au collaborateur et aux directeurs', options, async () => {
  await envoyer();
  await demander('alice', { typeId: ids.maladie, dateDebut: '2027-03-01', dateFin: '2027-03-02' });
  const messages = await envoyer();
  assert.deepEqual(destinataires(messages), trier(['alice', 'carla', 'dan', 'diane', 'eric'].map(adresse)));
  assert.deepEqual(avecPdf(messages), trier(['alice', 'diane', 'eric'].map(adresse)));
  const information = messages.find((m) => m.a === adresse('carla'));
  assert.match(information.sujet, /^Absence enregistrée : Alice Durand - Maladie/);
  assert.match(information.texte, /a été enregistrée par Alice Durand .* sans validation/);
  assert.ok(!information.texte.includes('PDF'));
  const pdf = messages.find((m) => m.a === adresse('alice')).pieces[0];
  assert.equal(pdf.filename.endsWith('-enregistree.pdf'), true);
  assert.ok(texteDuPdf(pdf.content).includes('Absence enregistrée'));
});

test('une déclaration d\'un directeur : les destinataires sont dédoublonnés, avec le PDF', options, async () => {
  await demander('diane', { typeId: ids.maladie, dateDebut: '2027-03-08', dateFin: '2027-03-08' });
  const messages = await envoyer();
  assert.deepEqual(destinataires(messages), trier([adresse('diane'), adresse('eric')]));
  assert.deepEqual(avecPdf(messages), trier([adresse('diane'), adresse('eric')]));
});

test('une annulation suit le même circuit, et le PDF renvoie à la demande d\'origine', options, async () => {
  const origine = await demander('alice', { dateDebut: '2027-03-15', dateFin: '2027-03-19' });
  await envoyer();
  await decider('carla', origine.id, 'approbation');
  await envoyer();

  const reponse = await appel('alice', 'POST', `/api/demandes/${origine.id}/annulation`, { commentaire: 'Projet reporté' });
  assert.equal(reponse.statusCode, 201);
  const annulation = reponse.json();
  const aTraiter = await envoyer();
  assert.deepEqual(destinataires(aTraiter), [adresse('carla'), adresse('dan')]);
  assert.match(aTraiter[0].sujet, /^Annulation à traiter : /);
  assert.match(aTraiter[0].texte, new RegExp(`demande l'annulation d'une absence \\(demande n° ${origine.id}\\)`));

  await decider('carla', annulation.id, 'approbation');
  const decisions = await envoyer();
  // Un seul e-mail par destinataire : l'annulation d'origine, actée en même temps, ne double rien.
  assert.deepEqual(destinataires(decisions), trier(['alice', 'carla', 'diane', 'eric'].map(adresse)));
  assert.match(decisions[0].sujet, /^Annulation approuvée : /);
  const texte = texteDuPdf(decisions[0].pieces[0].content);
  assert.ok(texte.includes("Demande d'annulation approuvée"));
  assert.ok(texte.includes(`Demande d'absence n° ${origine.id}`));
  assert.ok(texte.includes('Projet reporté'));
});

test('un retrait n\'envoie aucun e-mail', options, async () => {
  const demande = await demander('chloe', { dateDebut: '2027-04-05', dateFin: '2027-04-05' });
  await envoyer();
  assert.equal((await appel('chloe', 'POST', `/api/demandes/${demande.id}/retrait`)).statusCode, 200);
  assert.deepEqual(await envoyer(), []);
});

test('un compte désactivé ne reçoit plus rien', options, async () => {
  const demande = await demander('alice', { dateDebut: '2027-04-12', dateFin: '2027-04-12' });
  await envoyer();
  await pool.query('UPDATE collaborateurs SET actif = false WHERE id = $1', [ids.dan]);
  try {
    await decider('carla', demande.id, 'approbation');
    assert.ok(!destinataires(await envoyer()).includes(adresse('dan')));
  } finally {
    await pool.query('UPDATE collaborateurs SET actif = true WHERE id = $1', [ids.dan]);
  }
});

// --- File, pannes et relances ------------------------------------------------

test('un même événement n\'est pas enfilé deux fois, et un envoi n\'est pas répété', options, async () => {
  const demande = await demander('chloe', { dateDebut: '2027-04-19', dateFin: '2027-04-19' });
  const evenement = (await pool.query(
    `SELECT id FROM evenements_demande WHERE demande_id = $1 ORDER BY id LIMIT 1`, [demande.id])).rows[0].id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    assert.equal(await enfiler(client, evenement), 0); // déjà enfilé à la soumission
    await client.query('COMMIT');
  } finally {
    client.release();
  }
  assert.equal((await envoyer()).length, 1);
  assert.deepEqual(await envoyer(), []); // rien à renvoyer
  const { rows } = await pool.query(`SELECT statut, tentatives, envoye_le IS NOT NULL AS envoye FROM envois_email WHERE demande_id = $1`, [demande.id]);
  assert.deepEqual(rows, [{ statut: 'envoye', tentatives: 1, envoye: true }]);
});

test('une panne du serveur d\'e-mail ne bloque pas la demande ; nouvelles tentatives puis échec', options, async () => {
  await envoyer();
  panne = true;
  let demande;
  try {
    demande = await demander('alice', { dateDebut: '2027-04-26', dateFin: '2027-04-26' }); // 201 malgré la panne
    assert.deepEqual(await envoyer(), []);
    const lire = async () => (await pool.query(
      `SELECT destinataire, statut, tentatives, derniere_erreur, prochaine_tentative > now() AS differee
       FROM envois_email WHERE demande_id = $1 ORDER BY destinataire`, [demande.id])).rows;

    let lignes = await lire();
    assert.deepEqual(lignes.map((l) => [l.destinataire, l.statut, l.tentatives, l.differee]),
      [[adresse('carla'), 'en_attente', 1, true], [adresse('dan'), 'en_attente', 1, true]]);
    assert.equal(lignes[0].derniere_erreur, 'SMTP indisponible');

    // Tant que le délai n'est pas écoulé, rien n'est retenté.
    await app.fileEmails.traiter();
    assert.ok((await lire()).every((l) => l.tentatives === 1));

    for (const attendu of [2, 3]) {
      await pool.query(`UPDATE envois_email SET prochaine_tentative = now() WHERE demande_id = $1`, [demande.id]);
      await app.fileEmails.traiter();
      lignes = await lire();
      assert.ok(lignes.every((l) => l.tentatives === attendu));
    }
    assert.deepEqual(lignes.map((l) => l.statut), ['echec', 'echec']);
  } finally {
    panne = false;
  }

  // La demande, elle, est bien enregistrée et traitable.
  assert.equal((await decider('carla', demande.id, 'approbation')).statusCode, 200);
});

test('les directeurs voient les envois en échec et peuvent les relancer', options, async () => {
  assert.deepEqual((await appel('diane', 'GET', '/api/admin/envois-email/compteur')).json().echecs, 2);
  const echecs = (await appel('diane', 'GET', '/api/admin/envois-email')).json();
  assert.equal(echecs.length, 2);
  assert.deepEqual(
    Object.keys(echecs[0]).sort(),
    ['avecPdf', 'creeLe', 'demandeId', 'derniereErreur', 'destinataire', 'envoyeLe', 'id', 'prochaineTentative', 'statut', 'sujet', 'tentatives'],
  );
  assert.equal(echecs[0].derniereErreur, 'SMTP indisponible');
  assert.equal(echecs[0].statut, 'echec');

  // Une relance unitaire, une fois la panne réparée.
  assert.equal((await appel('diane', 'POST', `/api/admin/envois-email/${echecs[0].id}/relancer`)).statusCode, 204);
  // La file contient aussi les e-mails de la décision prise pendant la panne : on ne regarde que l'envoi relancé.
  const messages = await envoyer();
  assert.equal(messages.filter((m) => m.a === echecs[0].destinataire && m.sujet === echecs[0].sujet).length, 1);
  const envoye = (await appel('diane', 'GET', '/api/admin/envois-email?statut=envoye')).json();
  assert.ok(envoye.some((e) => e.id === echecs[0].id));
  // Un envoi déjà parti, ou inconnu, ne se relance pas.
  assert.equal((await appel('diane', 'POST', `/api/admin/envois-email/${echecs[0].id}/relancer`)).statusCode, 409);
  assert.equal((await appel('diane', 'POST', '/api/admin/envois-email/99999/relancer')).statusCode, 404);

  // Relance de tout ce qui reste.
  assert.deepEqual((await appel('diane', 'POST', '/api/admin/envois-email/relancer')).json(), { relances: 1 });
  assert.equal((await envoyer()).length, 1);
  assert.deepEqual((await appel('diane', 'GET', '/api/admin/envois-email/compteur')).json(), { echecs: 0, enAttente: 0 });
  assert.deepEqual((await appel('diane', 'POST', '/api/admin/envois-email/relancer')).json(), { relances: 0 });
});

// --- Administration ----------------------------------------------------------

test('l\'administration des e-mails et du PDF est réservée aux directeurs', options, async () => {
  for (const qui of ['alice', 'bob']) {
    for (const [methode, url] of [
      ['GET', '/api/admin/parametres-pdf'], ['PUT', '/api/admin/parametres-pdf'], ['GET', '/api/admin/parametres-pdf/apercu'],
      ['GET', '/api/admin/envois-email'], ['GET', '/api/admin/envois-email/compteur'], ['POST', '/api/admin/envois-email/relancer'],
    ]) {
      assert.equal((await appel(qui, methode, url, { raisonSociale: '', mentions: '' })).statusCode, 403, `${qui} ${methode} ${url}`);
    }
  }
  assert.equal((await appel('inconnu', 'GET', '/api/admin/envois-email')).statusCode, 401);
});

test('réglage du PDF : valeurs trop longues refusées, aperçu avec les mentions', options, async () => {
  assert.equal((await appel('diane', 'PUT', '/api/admin/parametres-pdf', { raisonSociale: 'x'.repeat(151), mentions: '' })).statusCode, 400);
  assert.equal((await appel('diane', 'PUT', '/api/admin/parametres-pdf', { raisonSociale: '', mentions: 'x'.repeat(2001) })).statusCode, 400);
  assert.equal((await appel('diane', 'PUT', '/api/admin/parametres-pdf', { raisonSociale: '' })).statusCode, 400);

  const apercu = await appel('diane', 'GET', '/api/admin/parametres-pdf/apercu');
  assert.equal(apercu.statusCode, 200);
  assert.equal(apercu.headers['content-type'], 'application/pdf');
  assert.match(apercu.headers['content-disposition'], /^inline;/);
  const texte = texteDuPdf(apercu.rawPayload);
  assert.ok(texte.includes('Exemple : aucune demande réelle'));
  assert.ok(texte.includes('Société Exemple SAS')); // réglé plus haut
  assert.ok(texte.includes('Document à conserver 5 ans.'));

  // Effacer les mentions les retire des PDF suivants.
  await appel('diane', 'PUT', '/api/admin/parametres-pdf', { raisonSociale: '', mentions: '' });
  assert.deepEqual((await appel('diane', 'GET', '/api/admin/parametres-pdf')).json(), { raisonSociale: '', mentions: '' });
  assert.ok(!texteDuPdf((await appel('diane', 'GET', '/api/admin/parametres-pdf/apercu')).rawPayload).includes('Société Exemple SAS'));
});

test('le suivi des envois est purgé avec les demandes', options, async () => {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM envois_email WHERE demande_id IS NOT NULL`);
  assert.ok(rows[0].n > 10);
  await pool.query(`SELECT purger_demandes('2030-01-01'::date - 1) WHERE false`); // la fonction existe
});
