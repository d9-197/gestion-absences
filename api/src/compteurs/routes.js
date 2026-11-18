import { ErreurMetier, introuvable } from '../erreurs.js';
import { verifierAcces } from '../fiches/service.js';
import { MENTION_INDICATIF, compteursActifs, debutPeriode, recalerSolde, soldesDe } from './service.js';

const typeId = { type: 'integer', minimum: 1 };
const jours = { type: 'number', minimum: 0, maximum: 400 };

// Soldes de congés indicatifs : chacun voit les siens (et peut les recaler), un valideur ceux de ses collaborateurs.
export async function routesCompteurs(app, { pool, aujourdhui }) {
  app.addHook('onRequest', app.authentifier);

  const etat = async (collaborateurId) => {
    const actif = await compteursActifs(pool);
    return {
      actif, mention: MENTION_INDICATIF,
      soldes: actif ? await soldesDe(pool, { collaborateurId, aujourdhui: aujourdhui() }) : [],
    };
  };

  app.get('/compteurs', {
    schema: { querystring: { type: 'object', properties: { collaborateurId: { type: 'integer', minimum: 1 } } } },
  }, async (requete) => {
    const collaborateurId = requete.query.collaborateurId ?? Number(requete.utilisateur.id);
    await verifierAcces(pool, { utilisateur: requete.utilisateur, collaborateurId });
    return etat(collaborateurId);
  });

  app.put('/compteurs/recalage', {
    schema: {
      body: {
        type: 'object', required: ['typeId', 'dateEffet', 'joursRestants'], additionalProperties: false,
        properties: {
          collaborateurId: { type: 'integer', minimum: 1 }, typeId,
          dateEffet: { type: 'string', format: 'date' }, joursRestants: { type: 'number', minimum: -100, maximum: 500 },
        },
      },
    },
  }, async (requete) => {
    const moi = Number(requete.utilisateur.id);
    const collaborateurId = requete.body.collaborateurId ?? moi;
    if (collaborateurId !== moi && requete.utilisateur.role !== 'directeur') {
      throw new ErreurMetier(403, 'Seul le salarié lui-même, ou un directeur, peut recaler un solde');
    }
    await verifierAcces(pool, { utilisateur: requete.utilisateur, collaborateurId });
    await recalerSolde(pool, { ...requete.body, collaborateurId, auteurId: moi, aujourdhui: aujourdhui() });
    return etat(collaborateurId);
  });
}

// Administration (directeurs) : interrupteur global, droit par salarié, report manuel, vue d'ensemble.
export async function routesAdminCompteurs(app, { pool, aujourdhui }) {
  app.get('/compteurs', async () => {
    const [actif, types] = await Promise.all([
      compteursActifs(pool),
      pool.query(`SELECT id, libelle, dotation_annuelle, debut_periode_mois, report_automatique FROM types_absence
                  WHERE compteur_actif AND actif ORDER BY ordre, lower(libelle)`),
    ]);
    return {
      actif, mention: MENTION_INDICATIF,
      types: types.rows.map((t) => ({
        id: Number(t.id), libelle: t.libelle, dotationAnnuelle: t.dotation_annuelle === null ? null : Number(t.dotation_annuelle),
        debutPeriodeMois: t.debut_periode_mois, reportAutomatique: t.report_automatique,
      })),
    };
  });

  app.put('/compteurs/actif', {
    schema: { body: { type: 'object', required: ['actif'], additionalProperties: false, properties: { actif: { type: 'boolean' } } } },
  }, async (requete) => {
    await pool.query(
      `INSERT INTO parametres (cle, valeur) VALUES ('compteurs_actifs', $1::jsonb)
       ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur, modifie_le = now()`,
      [JSON.stringify(requete.body.actif)],
    );
    return { actif: requete.body.actif };
  });

  // Les soldes d'un type pour tous les salariés actifs.
  app.get('/compteurs/type/:id', { schema: { params: { type: 'object', required: ['id'], properties: { id: typeId } } } }, async (requete) => {
    const { rows: types } = await pool.query('SELECT id, libelle FROM types_absence WHERE id = $1 AND compteur_actif', [requete.params.id]);
    if (!types.length) throw introuvable("Type d'absence avec compteur");
    const { rows: personnes } = await pool.query(`SELECT id, prenom, nom FROM collaborateurs WHERE actif ORDER BY lower(nom), lower(prenom)`);
    const lignes = [];
    for (const p of personnes) {
      const solde = (await soldesDe(pool, { collaborateurId: Number(p.id), aujourdhui: aujourdhui() })).find((s) => s.typeId === requete.params.id);
      lignes.push({ collaborateurId: Number(p.id), prenom: p.prenom, nom: p.nom, solde: solde ?? null });
    }
    return { typeId: requete.params.id, libelle: types[0].libelle, lignes };
  });

  // Droit annuel d'un salarié ; `jours: null` revient à la valeur par défaut du type.
  app.put('/compteurs/dotation', {
    schema: {
      body: {
        type: 'object', required: ['collaborateurId', 'typeId', 'jours'], additionalProperties: false,
        properties: { collaborateurId: typeId, typeId, jours: { anyOf: [{ type: 'null' }, jours] } },
      },
    },
  }, async (requete, reponse) => {
    const { collaborateurId, typeId: type, jours: valeur } = requete.body;
    if (valeur !== null && Math.round(valeur * 2) !== valeur * 2) throw new ErreurMetier(400, 'Le droit se saisit par demi-journée');
    await verifierExistence(pool, collaborateurId, type);
    await pool.query(
      `INSERT INTO dotations_collaborateur (collaborateur_id, type_id, jours, auteur_id) VALUES ($1, $2, $3, $4)`,
      [collaborateurId, type, valeur, Number(requete.utilisateur.id)],
    );
    return reponse.code(204).send();
  });

  // Report fixé à la main pour la période en cours (types à report non automatique).
  app.put('/compteurs/report', {
    schema: {
      body: {
        type: 'object', required: ['collaborateurId', 'typeId', 'jours'], additionalProperties: false,
        properties: { collaborateurId: typeId, typeId, jours },
      },
    },
  }, async (requete, reponse) => {
    const { collaborateurId, typeId: type, jours: valeur } = requete.body;
    if (Math.round(valeur * 2) !== valeur * 2) throw new ErreurMetier(400, 'Le report se saisit par demi-journée');
    await verifierExistence(pool, collaborateurId, type);
    const { rows } = await pool.query('SELECT debut_periode_mois, report_automatique FROM types_absence WHERE id = $1', [type]);
    if (rows[0].report_automatique) throw new ErreurMetier(409, 'Ce type reporte automatiquement son reliquat');
    await pool.query(
      `INSERT INTO reports_solde (collaborateur_id, type_id, periode_debut, jours, auteur_id) VALUES ($1, $2, $3, $4, $5)`,
      [collaborateurId, type, debutPeriode(aujourdhui(), rows[0].debut_periode_mois), valeur, Number(requete.utilisateur.id)],
    );
    return reponse.code(204).send();
  });
}

async function verifierExistence(pool, collaborateurId, type) {
  const [c, t] = await Promise.all([
    pool.query('SELECT 1 FROM collaborateurs WHERE id = $1', [collaborateurId]),
    pool.query('SELECT 1 FROM types_absence WHERE id = $1 AND compteur_actif', [type]),
  ]);
  if (!c.rowCount) throw introuvable('Collaborateur');
  if (!t.rowCount) throw new ErreurMetier(400, "Ce type d'absence n'a pas de compteur");
}
