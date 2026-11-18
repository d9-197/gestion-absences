import { ErreurMetier, introuvable } from '../erreurs.js';
import { champsModifies, parametresId, transaction, trier, verifierValideur } from './outils.js';

const LISTE = `
  SELECT e.id, e.nom, e.parent_id, e.responsable_id, e.actif,
         (SELECT count(*)::int FROM collaborateurs c WHERE c.equipe_id = e.id AND c.actif) AS nb_collaborateurs,
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
                     'delegueId', d.delegue_id, 'dateDebut', d.date_debut, 'dateFin', d.date_fin,
                     'active', delegation_active(d.date_debut, d.date_fin)) ORDER BY d.delegue_id)
                   FROM delegations d WHERE d.equipe_id = e.id), '[]') AS delegations
  FROM equipes e`;

const versJson = (e) => ({
  id: Number(e.id),
  nom: e.nom,
  parentId: e.parent_id === null ? null : Number(e.parent_id),
  responsableId: e.responsable_id === null ? null : Number(e.responsable_id),
  actif: e.actif,
  nbCollaborateurs: e.nb_collaborateurs,
  // Tous les délégués, avec leur période ; `active` dit s'ils peuvent valider aujourd'hui.
  delegueIds: e.delegations.map((d) => Number(d.delegueId)),
  delegations: e.delegations.map((d) => ({
    delegueId: Number(d.delegueId), dateDebut: d.dateDebut, dateFin: d.dateFin, active: d.active,
  })),
});

const proprietes = {
  nom: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' },
  parentId: { type: ['integer', 'null'], minimum: 1 },
  responsableId: { type: ['integer', 'null'], minimum: 1 },
};

export async function routesEquipes(app, { pool }) {
  const lire = async (client, id) => {
    const { rows } = await client.query(`${LISTE} WHERE e.id = $1`, [id]);
    if (!rows.length) throw introuvable('Équipe');
    return versJson(rows[0]);
  };

  async function verifierReferences(client, { parentId, responsableId }) {
    if (parentId) {
      const { rowCount } = await client.query('SELECT 1 FROM equipes WHERE id = $1', [parentId]);
      if (!rowCount) throw new ErreurMetier(400, 'Équipe parente inconnue');
    }
    if (responsableId) await verifierValideur(client, responsableId, 'Responsable');
  }

  app.get('/equipes', async () => {
    const { rows } = await pool.query(LISTE);
    return trier(rows.map(versJson), (e) => e.nom);
  });

  app.post('/equipes', {
    schema: { body: { type: 'object', required: ['nom'], additionalProperties: false, properties: proprietes } },
  }, async (requete, reponse) => {
    const { nom, parentId = null, responsableId = null } = requete.body;
    const equipe = await transaction(pool, async (client) => {
      await verifierReferences(client, { parentId, responsableId });
      const { rows } = await client.query(
        'INSERT INTO equipes (nom, parent_id, responsable_id) VALUES ($1, $2, $3) RETURNING id',
        [nom.trim(), parentId, responsableId],
      );
      return lire(client, rows[0].id);
    });
    return reponse.code(201).send(equipe);
  });

  app.patch('/equipes/:id', {
    schema: {
      params: parametresId,
      body: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: { ...proprietes, actif: { type: 'boolean' } },
      },
    },
  }, async (requete) => {
    const { id } = requete.params;
    const corps = { ...requete.body };
    if (corps.nom !== undefined) corps.nom = corps.nom.trim();
    return transaction(pool, async (client) => {
      const { rowCount } = await client.query('SELECT 1 FROM equipes WHERE id = $1 FOR UPDATE', [id]);
      if (!rowCount) throw introuvable('Équipe');
      await verifierReferences(client, corps);
      if (corps.actif === false) {
        const occupee = await client.query(
          `SELECT EXISTS (SELECT 1 FROM collaborateurs WHERE equipe_id = $1 AND actif) AS membres,
                  EXISTS (SELECT 1 FROM equipes WHERE parent_id = $1 AND actif) AS filles`,
          [id],
        );
        if (occupee.rows[0].membres || occupee.rows[0].filles) {
          throw new ErreurMetier(409, 'Cette équipe a encore des collaborateurs ou des sous-équipes actifs');
        }
      }
      const { colonnes, valeurs } = champsModifies(corps, {
        nom: 'nom', parentId: 'parent_id', responsableId: 'responsable_id', actif: 'actif',
      });
      await client.query(`UPDATE equipes SET ${colonnes.join(', ')} WHERE id = $${valeurs.length + 1}`, [...valeurs, id]);
      return lire(client, id);
    });
  });

  // Remplace la liste des délégués de l'équipe. Une délégation peut être limitée dans le temps (dateDebut, dateFin
  // inclus) ; sans date, elle est permanente. `delegueIds` reste accepté : délégations permanentes.
  const date = { type: ['string', 'null'], format: 'date' };
  app.put('/equipes/:id/delegues', {
    schema: {
      params: parametresId,
      body: {
        type: 'object', additionalProperties: false, oneOf: [{ required: ['delegueIds'] }, { required: ['delegations'] }],
        properties: {
          delegueIds: { type: 'array', maxItems: 50, uniqueItems: true, items: { type: 'integer', minimum: 1 } },
          delegations: {
            type: 'array', maxItems: 50,
            items: {
              type: 'object', required: ['delegueId'], additionalProperties: false,
              properties: { delegueId: { type: 'integer', minimum: 1 }, dateDebut: date, dateFin: date },
            },
          },
        },
      },
    },
  }, async (requete) => {
    const { id } = requete.params;
    return transaction(pool, async (client) => {
      const { rowCount } = await client.query('SELECT 1 FROM equipes WHERE id = $1 FOR UPDATE', [id]);
      if (!rowCount) throw introuvable('Équipe');
      const liste = requete.body.delegations
        ?? requete.body.delegueIds.map((delegueId) => ({ delegueId, dateDebut: null, dateFin: null }));
      if (new Set(liste.map((d) => d.delegueId)).size !== liste.length) throw new ErreurMetier(400, 'Un délégué ne peut figurer qu\'une fois');
      for (const d of liste) {
        await verifierValideur(client, d.delegueId, 'Délégué');
        if (d.dateDebut && d.dateFin && d.dateFin < d.dateDebut) {
          throw new ErreurMetier(400, 'Délégation : la date de fin précède la date de début');
        }
      }
      await client.query('DELETE FROM delegations WHERE equipe_id = $1', [id]);
      for (const d of liste) {
        await client.query(
          'INSERT INTO delegations (equipe_id, delegue_id, date_debut, date_fin) VALUES ($1, $2, $3, $4)',
          [id, d.delegueId, d.dateDebut ?? null, d.dateFin ?? null],
        );
      }
      return lire(client, id);
    });
  });

  app.delete('/equipes/:id', { schema: { params: parametresId } }, async (requete, reponse) => {
    try {
      const { rowCount } = await pool.query('DELETE FROM equipes WHERE id = $1', [requete.params.id]);
      if (!rowCount) throw introuvable('Équipe');
    } catch (erreur) {
      if (erreur.code === '23503') {
        throw new ErreurMetier(409, 'Cette équipe a des collaborateurs, des sous-équipes ou des demandes : désactivez-la plutôt');
      }
      throw erreur;
    }
    return reponse.code(204).send();
  });
}
