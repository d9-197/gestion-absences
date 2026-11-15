// Tests du schéma contre une vraie base PostgreSQL (ignorés si TEST_DB_HOST n'est pas défini).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { migrer } from '../src/migrations.js';
import { creerBaseDeTest, hote, options } from './aide-base.js';

let baseDeTest;
let proprietaire; // compte propriétaire : comme le conteneur de migrations
let api; // compte applicatif : comme l'API
const ids = {};

async function refuse(promesse, motif) {
  await assert.rejects(promesse, motif);
}

// Insère une demande et son premier événement dans une même transaction, comme le fera l'API.
async function creerDemande(pool, { type, evenement, debut = '2030-03-04', fin = '2030-03-08', nature = 'absence', annulee = null }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO demandes (nature, demande_annulee_id, collaborateur_id, equipe_id, type_id,
                             date_debut, date_fin, duree_demi_journees, saisie_par_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 10, $3) RETURNING id`,
      [nature, annulee, ids.alice, ids.dev, type, debut, fin],
    );
    if (evenement) {
      await client.query(
        'INSERT INTO evenements_demande (demande_id, type, auteur_id) VALUES ($1, $2, $3)',
        [rows[0].id, evenement, ids.alice],
      );
    }
    await client.query('COMMIT');
    return rows[0].id;
  } catch (erreur) {
    await client.query('ROLLBACK');
    throw erreur;
  } finally {
    client.release();
  }
}

const evenement = (pool, demande, type, motif = null) =>
  pool.query('INSERT INTO evenements_demande (demande_id, type, auteur_id, motif) VALUES ($1, $2, $3, $4)', [
    demande, type, ids.bob, motif,
  ]);

const statut = async (demande) =>
  (await api.query('SELECT statut FROM demandes_avec_statut WHERE id = $1', [demande])).rows[0].statut;

before(async () => {
  if (!hote) return;
  baseDeTest = await creerBaseDeTest();
  ({ proprietaire, api } = baseDeTest);

  // Jeu de données minimal, créé avec le compte applicatif.
  const equipe = async (nom, parent = null) =>
    (await api.query('INSERT INTO equipes (nom, parent_id) VALUES ($1, $2) RETURNING id', [nom, parent])).rows[0].id;
  ids.direction = await equipe('Direction');
  ids.technique = await equipe('Technique', ids.direction);
  ids.dev = await equipe('Développement', ids.technique);
  const personne = async (prenom, equipeId, role) =>
    (await api.query(
      'INSERT INTO collaborateurs (email, nom, prenom, equipe_id, role) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [`${prenom.toLowerCase()}@exemple.test`, 'Test', prenom, equipeId, role],
    )).rows[0].id;
  ids.alice = await personne('Alice', ids.dev, 'collaborateur');
  ids.bob = await personne('Bob', ids.technique, 'responsable');
  const type = async (libelle) =>
    (await api.query('SELECT id FROM types_absence WHERE libelle = $1', [libelle])).rows[0].id;
  ids.conges = await type('Congés payés');
  ids.maladie = await type('Maladie');
});

after(async () => {
  await baseDeTest?.fermer();
});

test('les données de départ sont en place', options, async () => {
  const types = await api.query('SELECT libelle, approbation_requise, confidentiel FROM types_absence ORDER BY ordre');
  assert.equal(types.rowCount, 6);
  assert.deepEqual(types.rows.find((t) => t.libelle === 'Maladie'), {
    libelle: 'Maladie', approbation_requise: false, confidentiel: true,
  });
  const conservation = await api.query(`SELECT valeur FROM parametres WHERE cle = 'conservation_passe_mois'`);
  assert.equal(conservation.rows[0].valeur, 12);
});

test('une équipe ne peut pas devenir la fille de sa sous-équipe', options, async () => {
  await refuse(api.query('UPDATE equipes SET parent_id = $1 WHERE id = $2', [ids.dev, ids.direction]), /sous-équipes/);
});

test('sous_equipes renvoie toute la descendance', options, async () => {
  const { rows } = await api.query('SELECT sous_equipes($1) AS id ORDER BY 1', [ids.technique]);
  assert.deepEqual(rows.map((r) => Number(r.id)), [Number(ids.technique), Number(ids.dev)].sort((a, b) => a - b));
});

test('circuit avec approbation : en attente, puis approuvée', options, async () => {
  const demande = await creerDemande(api, { type: ids.conges, evenement: 'soumission' });
  assert.equal(await statut(demande), 'en_attente');
  await evenement(api, demande, 'approbation');
  assert.equal(await statut(demande), 'approuvee');
  // Une demande déjà décidée ne peut plus l'être.
  await refuse(evenement(api, demande, 'refus', 'trop tard'), /impossible/);
  await refuse(evenement(api, demande, 'retrait'), /impossible/);
});

test('un refus exige un motif', options, async () => {
  const demande = await creerDemande(api, { type: ids.conges, evenement: 'soumission' });
  await refuse(evenement(api, demande, 'refus'), /violates check constraint/);
  await refuse(evenement(api, demande, 'refus', '   '), /violates check constraint/);
  await evenement(api, demande, 'refus', 'Effectif insuffisant');
  assert.equal(await statut(demande), 'refusee');
});

test('une demande en attente peut être retirée', options, async () => {
  const demande = await creerDemande(api, { type: ids.conges, evenement: 'soumission' });
  await evenement(api, demande, 'retrait');
  assert.equal(await statut(demande), 'retiree');
});

test('le premier événement dépend du type', options, async () => {
  // Type sans approbation : enregistrement direct.
  const maladie = await creerDemande(api, { type: ids.maladie, evenement: 'enregistrement' });
  assert.equal(await statut(maladie), 'enregistree');
  // Les combinaisons inverses sont refusées.
  await refuse(creerDemande(api, { type: ids.maladie, evenement: 'soumission' }), /impossible/);
  await refuse(creerDemande(api, { type: ids.conges, evenement: 'enregistrement' }), /impossible/);
  await refuse(creerDemande(api, { type: ids.conges, evenement: 'approbation' }), /impossible/);
});

test('une demande sans événement est refusée à la validation de la transaction', options, async () => {
  await refuse(creerDemande(api, { type: ids.conges, evenement: null }), /aucun événement/);
});

test('une annulation approuvée annule la demande d\'origine', options, async () => {
  const origine = await creerDemande(api, { type: ids.conges, evenement: 'soumission' });
  await evenement(api, origine, 'approbation');
  const annulation = await creerDemande(api, {
    type: ids.conges, evenement: 'soumission', nature: 'annulation', annulee: origine,
  });
  assert.equal(await statut(origine), 'approuvee');
  await evenement(api, annulation, 'approbation');
  assert.equal(await statut(annulation), 'approuvee');
  assert.equal(await statut(origine), 'annulee');
  // Une seconde annulation de la même demande échoue à l'approbation.
  const seconde = await creerDemande(api, {
    type: ids.conges, evenement: 'soumission', nature: 'annulation', annulee: origine,
  });
  await refuse(evenement(api, seconde, 'approbation'), /impossible/);
});

test('une annulation doit viser une absence du même collaborateur et du même type', options, async () => {
  const origine = await creerDemande(api, { type: ids.conges, evenement: 'soumission' });
  await refuse(
    creerDemande(api, { type: ids.maladie, evenement: 'enregistrement', nature: 'annulation', annulee: origine }),
    /reprendre le collaborateur et le type/,
  );
  await refuse(creerDemande(api, { type: ids.conges, evenement: 'soumission', nature: 'annulation' }), /check constraint/);
});

test('les dates incohérentes sont refusées', options, async () => {
  await refuse(
    creerDemande(api, { type: ids.conges, evenement: 'soumission', debut: '2030-03-08', fin: '2030-03-04' }),
    /check constraint/,
  );
});

test('le compte applicatif ne peut ni modifier ni supprimer demandes et journal', options, async () => {
  const demande = await creerDemande(api, { type: ids.conges, evenement: 'soumission' });
  await refuse(api.query('UPDATE demandes SET date_fin = $1 WHERE id = $2', ['2030-03-20', demande]), /permission denied/);
  await refuse(api.query('DELETE FROM demandes WHERE id = $1', [demande]), /permission denied/);
  await refuse(api.query(`UPDATE evenements_demande SET type = 'approbation' WHERE demande_id = $1`, [demande]), /permission denied/);
  await refuse(api.query('DELETE FROM evenements_demande WHERE demande_id = $1', [demande]), /permission denied/);
  await refuse(api.query('TRUNCATE evenements_demande'), /permission denied/);
  await refuse(api.query('DELETE FROM collaborateurs WHERE id = $1', [ids.alice]), /permission denied/);
  await refuse(api.query('CREATE TABLE intrus (i int)'), /permission denied/);
});

test('même le compte propriétaire est arrêté par les déclencheurs', options, async () => {
  const demande = await creerDemande(api, { type: ids.conges, evenement: 'soumission' });
  await refuse(proprietaire.query('UPDATE demandes SET date_fin = $1 WHERE id = $2', ['2030-03-20', demande]), /ajout seul/);
  await refuse(proprietaire.query('DELETE FROM demandes WHERE id = $1', [demande]), /ajout seul/);
  await refuse(proprietaire.query('DELETE FROM evenements_demande WHERE demande_id = $1', [demande]), /ajout seul/);
  await refuse(proprietaire.query('TRUNCATE demandes CASCADE'), /ajout seul/);
});

test('les horodatages viennent du serveur, pas du client', options, async () => {
  const demande = await creerDemande(api, { type: ids.conges, evenement: 'soumission' });
  await api.query(
    `INSERT INTO evenements_demande (demande_id, type, auteur_id, cree_le) VALUES ($1, 'approbation', $2, '2001-01-01')`,
    [demande, ids.bob],
  );
  const { rows } = await api.query(
    `SELECT cree_le > now() - interval '1 minute' AS recent FROM evenements_demande WHERE demande_id = $1 AND type = 'approbation'`,
    [demande],
  );
  assert.equal(rows[0].recent, true);
});

test('deux décisions concurrentes : une seule passe', options, async () => {
  const demande = await creerDemande(api, { type: ids.conges, evenement: 'soumission' });
  const resultats = await Promise.allSettled([
    evenement(api, demande, 'approbation'),
    evenement(api, demande, 'refus', 'Décision concurrente'),
  ]);
  assert.equal(resultats.filter((r) => r.status === 'fulfilled').length, 1);
  const { rows } = await api.query('SELECT count(*)::int AS n FROM evenements_demande WHERE demande_id = $1', [demande]);
  assert.equal(rows[0].n, 2);
});

test('la purge supprime les demandes anciennes avec leur journal, et rien d\'autre', options, async () => {
  const ancienne = await creerDemande(api, { type: ids.conges, evenement: 'soumission', debut: '2020-01-06', fin: '2020-01-10' });
  await evenement(api, ancienne, 'approbation');
  const recente = await creerDemande(api, { type: ids.conges, evenement: 'soumission' });

  await refuse(api.query(`SELECT purger_demandes(current_date + 1)`), /doit être passée/);
  const { rows } = await api.query(`SELECT purger_demandes('2021-01-01') AS n`);
  assert.equal(rows[0].n, 1);

  const restantes = await api.query('SELECT id FROM demandes WHERE id = ANY($1)', [[ancienne, recente]]);
  assert.deepEqual(restantes.rows.map((r) => r.id), [recente]);
  const journal = await api.query('SELECT count(*)::int AS n FROM evenements_demande WHERE demande_id = $1', [ancienne]);
  assert.equal(journal.rows[0].n, 0);
  // La purge ne laisse pas la suppression ouverte derrière elle.
  await refuse(proprietaire.query('DELETE FROM demandes WHERE id = $1', [recente]), /ajout seul/);
});

test('relancer les migrations ne fait rien', options, async () => {
  const appliquees = await migrer(baseDeTest.connexionProprietaire, { log: () => {} });
  assert.equal(appliquees.length, 0);
});
