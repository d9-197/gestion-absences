import { ErreurMetier, introuvable } from '../erreurs.js';
import { assurerAnnee, insererFeriesLegaux } from '../calendrier/service.js';
import { champsModifies, parametresId } from './outils.js';

const date = { type: 'string', format: 'date' };
const libelle = { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' };
const annee = { type: 'integer', minimum: 2000, maximum: 2100 };
const parametresJour = { type: 'object', required: ['jour'], properties: { jour: date } };

const imposeVersJson = (j) => ({
  id: Number(j.id),
  jour: j.jour,
  libelle: j.libelle,
  equipeId: j.equipe_id === null ? null : Number(j.equipe_id),
  avecDecompte: j.avec_decompte,
});

const proprietesImpose = {
  jour: date,
  libelle,
  // null : toute l'entreprise ; sinon l'équipe et ses sous-équipes.
  equipeId: { type: ['integer', 'null'], minimum: 1 },
  avecDecompte: { type: 'boolean' },
};

export async function routesAdminCalendrier(app, { pool }) {
  async function verifierEquipe(equipeId) {
    if (equipeId === null || equipeId === undefined) return;
    const { rowCount } = await pool.query('SELECT 1 FROM equipes WHERE id = $1', [equipeId]);
    if (!rowCount) throw new ErreurMetier(400, 'Équipe inconnue');
  }

  // Tout le calendrier d'une année. Le premier appel préremplit ses jours fériés légaux.
  app.get('/calendrier', {
    schema: { querystring: { type: 'object', required: ['annee'], properties: { annee } } },
  }, async (requete) => {
    const an = requete.query.annee;
    await assurerAnnee(pool, an);
    const bornes = [`${an}-01-01`, `${an}-12-31`];
    const [feries, imposes] = await Promise.all([
      pool.query('SELECT jour, libelle FROM jours_feries WHERE jour BETWEEN $1 AND $2 ORDER BY jour', bornes),
      pool.query(
        `SELECT id, jour, libelle, equipe_id, avec_decompte FROM jours_imposes
         WHERE jour BETWEEN $1 AND $2 ORDER BY jour, equipe_id NULLS FIRST`,
        bornes,
      ),
    ]);
    return { annee: an, joursFeries: feries.rows, joursImposes: imposes.rows.map(imposeVersJson) };
  });

  // --- Jours fériés ----------------------------------------------------------

  app.post('/jours-feries', {
    schema: { body: { type: 'object', required: ['jour', 'libelle'], additionalProperties: false, properties: { jour: date, libelle } } },
  }, async (requete, reponse) => {
    const { rows } = await pool.query(
      'INSERT INTO jours_feries (jour, libelle) VALUES ($1, $2) RETURNING jour, libelle',
      [requete.body.jour, requete.body.libelle.trim()],
    );
    return reponse.code(201).send(rows[0]);
  });

  app.patch('/jours-feries/:jour', {
    schema: {
      params: parametresJour,
      body: { type: 'object', required: ['libelle'], additionalProperties: false, properties: { libelle } },
    },
  }, async (requete) => {
    const { rows } = await pool.query(
      'UPDATE jours_feries SET libelle = $1 WHERE jour = $2 RETURNING jour, libelle',
      [requete.body.libelle.trim(), requete.params.jour],
    );
    if (!rows.length) throw introuvable('Jour férié');
    return rows[0];
  });

  app.delete('/jours-feries/:jour', { schema: { params: parametresJour } }, async (requete, reponse) => {
    const { rowCount } = await pool.query('DELETE FROM jours_feries WHERE jour = $1', [requete.params.jour]);
    if (!rowCount) throw introuvable('Jour férié');
    return reponse.code(204).send();
  });

  // Remet les jours fériés légaux manquants d'une année, sans toucher à ceux qui existent.
  app.post('/jours-feries/retablir', {
    schema: { body: { type: 'object', required: ['annee'], additionalProperties: false, properties: { annee } } },
  }, async (requete) => {
    await assurerAnnee(pool, requete.body.annee);
    return { ajoutes: await insererFeriesLegaux(pool, requete.body.annee) };
  });

  // --- Jours non travaillés imposés -------------------------------------------

  app.post('/jours-imposes', {
    schema: {
      body: {
        type: 'object', required: ['jour', 'libelle', 'avecDecompte'], additionalProperties: false,
        properties: proprietesImpose,
      },
    },
  }, async (requete, reponse) => {
    const { jour, libelle: texte, equipeId = null, avecDecompte } = requete.body;
    await verifierEquipe(equipeId);
    const { rows } = await pool.query(
      `INSERT INTO jours_imposes (jour, libelle, equipe_id, avec_decompte) VALUES ($1, $2, $3, $4)
       RETURNING id, jour, libelle, equipe_id, avec_decompte`,
      [jour, texte.trim(), equipeId, avecDecompte],
    );
    return reponse.code(201).send(imposeVersJson(rows[0]));
  });

  app.patch('/jours-imposes/:id', {
    schema: {
      params: parametresId,
      body: { type: 'object', additionalProperties: false, minProperties: 1, properties: proprietesImpose },
    },
  }, async (requete) => {
    const corps = { ...requete.body };
    if (corps.libelle !== undefined) corps.libelle = corps.libelle.trim();
    await verifierEquipe(corps.equipeId);
    const { colonnes, valeurs } = champsModifies(corps, {
      jour: 'jour', libelle: 'libelle', equipeId: 'equipe_id', avecDecompte: 'avec_decompte',
    });
    const { rows } = await pool.query(
      `UPDATE jours_imposes SET ${colonnes.join(', ')} WHERE id = $${valeurs.length + 1}
       RETURNING id, jour, libelle, equipe_id, avec_decompte`,
      [...valeurs, requete.params.id],
    );
    if (!rows.length) throw introuvable('Jour imposé');
    return imposeVersJson(rows[0]);
  });

  app.delete('/jours-imposes/:id', { schema: { params: parametresId } }, async (requete, reponse) => {
    const { rowCount } = await pool.query('DELETE FROM jours_imposes WHERE id = $1', [requete.params.id]);
    if (!rowCount) throw introuvable('Jour imposé');
    return reponse.code(204).send();
  });
}
