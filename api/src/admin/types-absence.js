import { ErreurMetier, introuvable } from '../erreurs.js';
import { champsModifies, parametresId } from './outils.js';

const LISTE = `
  SELECT t.id, t.libelle, t.approbation_requise, t.confidentiel, t.delai_prevenance_jours, t.actif, t.ordre,
         t.compteur_actif, t.dotation_annuelle, t.debut_periode_mois, t.report_automatique,
         EXISTS (SELECT 1 FROM demandes d WHERE d.type_id = t.id) AS utilise
  FROM types_absence t`;

const versJson = (t) => ({
  id: Number(t.id),
  libelle: t.libelle,
  approbationRequise: t.approbation_requise,
  confidentiel: t.confidentiel,
  delaiPrevenanceJours: t.delai_prevenance_jours,
  actif: t.actif,
  ordre: t.ordre,
  utilise: t.utilise,
  compteurActif: t.compteur_actif,
  dotationAnnuelle: t.dotation_annuelle === null ? null : Number(t.dotation_annuelle),
  debutPeriodeMois: t.debut_periode_mois,
  reportAutomatique: t.report_automatique,
});

const proprietes = {
  libelle: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' },
  approbationRequise: { type: 'boolean' },
  confidentiel: { type: 'boolean' },
  delaiPrevenanceJours: { type: ['integer', 'null'], minimum: 0, maximum: 365 },
  ordre: { type: 'integer', minimum: 0, maximum: 100000 },
  compteurActif: { type: 'boolean' },
  dotationAnnuelle: { type: ['number', 'null'], minimum: 0, maximum: 400, multipleOf: 0.5 },
  debutPeriodeMois: { type: 'integer', minimum: 1, maximum: 12 },
  reportAutomatique: { type: 'boolean' },
};
const colonnes = {
  libelle: 'libelle', approbationRequise: 'approbation_requise', confidentiel: 'confidentiel',
  delaiPrevenanceJours: 'delai_prevenance_jours', ordre: 'ordre', actif: 'actif',
  compteurActif: 'compteur_actif', dotationAnnuelle: 'dotation_annuelle', debutPeriodeMois: 'debut_periode_mois', reportAutomatique: 'report_automatique',
};

export async function routesTypesAbsence(app, { pool }) {
  const lire = async (id) => {
    const { rows } = await pool.query(`${LISTE} WHERE t.id = $1`, [id]);
    if (!rows.length) throw introuvable("Type d'absence");
    return versJson(rows[0]);
  };

  app.get('/types-absence', async () => {
    const { rows } = await pool.query(`${LISTE} ORDER BY t.ordre, lower(t.libelle)`);
    return rows.map(versJson);
  });

  app.post('/types-absence', {
    schema: { body: { type: 'object', required: ['libelle'], additionalProperties: false, properties: proprietes } },
  }, async (requete, reponse) => {
    const {
      libelle, approbationRequise = true, confidentiel = false, delaiPrevenanceJours = null, ordre,
      compteurActif = false, dotationAnnuelle = null, debutPeriodeMois = 1, reportAutomatique = true,
    } = requete.body;
    const { rows } = await pool.query(
      `INSERT INTO types_absence (libelle, approbation_requise, confidentiel, delai_prevenance_jours, ordre,
                                  compteur_actif, dotation_annuelle, debut_periode_mois, report_automatique)
       VALUES ($1, $2, $3, $4, COALESCE($5, (SELECT COALESCE(max(ordre), 0) + 10 FROM types_absence)), $6, $7, $8, $9)
       RETURNING id`,
      [libelle.trim(), approbationRequise, confidentiel, delaiPrevenanceJours, ordre ?? null, compteurActif, dotationAnnuelle, debutPeriodeMois, reportAutomatique],
    );
    return reponse.code(201).send(await lire(rows[0].id));
  });

  // Modifier un type ne change pas les demandes déjà enregistrées.
  app.patch('/types-absence/:id', {
    schema: {
      params: parametresId,
      body: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: { ...proprietes, actif: { type: 'boolean' } },
      },
    },
  }, async (requete) => {
    const corps = { ...requete.body };
    if (corps.libelle !== undefined) corps.libelle = corps.libelle.trim();
    const { colonnes: modifs, valeurs } = champsModifies(corps, colonnes);
    const { rowCount } = await pool.query(
      `UPDATE types_absence SET ${modifs.join(', ')} WHERE id = $${valeurs.length + 1}`,
      [...valeurs, requete.params.id],
    );
    if (!rowCount) throw introuvable("Type d'absence");
    return lire(requete.params.id);
  });

  app.delete('/types-absence/:id', { schema: { params: parametresId } }, async (requete, reponse) => {
    try {
      const { rowCount } = await pool.query('DELETE FROM types_absence WHERE id = $1', [requete.params.id]);
      if (!rowCount) throw introuvable("Type d'absence");
    } catch (erreur) {
      if (erreur.code === '23503') {
        throw new ErreurMetier(409, 'Ce type est utilisé par des demandes : désactivez-le plutôt');
      }
      throw erreur;
    }
    return reponse.code(204).send();
  });
}
