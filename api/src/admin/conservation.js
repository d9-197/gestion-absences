import { ErreurMetier } from '../erreurs.js';
import { DUREE_MAX_MOIS, DUREE_MIN_MOIS, apercu, dernieresPurges, lireDuree } from '../purge/service.js';

const duree = { type: 'integer', minimum: DUREE_MIN_MOIS, maximum: DUREE_MAX_MOIS };

// Durée de conservation des demandes, et suivi de la purge automatique.
export async function routesAdminConservation(app, { pool, aujourdhui }) {
  async function etat() {
    let mois;
    try {
      mois = await lireDuree(pool);
    } catch (erreur) {
      throw new ErreurMetier(409, `${erreur.message}. Enregistrez une durée valide : tant qu'elle ne l'est pas, aucune purge n'a lieu.`);
    }
    const prevu = await apercu(pool, { mois, aujourdhui: aujourdhui() });
    return {
      moisConservation: mois,
      dureeMin: DUREE_MIN_MOIS,
      dureeMax: DUREE_MAX_MOIS,
      dateLimite: prevu.dateLimite,
      demandesAPurger: prevu.demandes,
      evenementsAPurger: prevu.evenements,
      dernieresPurges: await dernieresPurges(pool),
    };
  }

  app.get('/conservation', etat);

  // Ce que supprimerait une durée donnée, sans rien enregistrer ni supprimer : pour mesurer l'effet avant de la changer.
  app.get('/conservation/apercu', {
    schema: { querystring: { type: 'object', required: ['mois'], properties: { mois: duree } } },
  }, async (requete) => {
    const prevu = await apercu(pool, { mois: requete.query.mois, aujourdhui: aujourdhui() });
    return { mois: prevu.mois, dateLimite: prevu.dateLimite, demandesAPurger: prevu.demandes, evenementsAPurger: prevu.evenements };
  });

  // Enregistrer une durée ne supprime rien sur le moment : les demandes concernées partent à la prochaine purge automatique.
  app.put('/conservation', {
    schema: { body: { type: 'object', required: ['moisConservation'], additionalProperties: false, properties: { moisConservation: duree } } },
  }, async (requete) => {
    const ancienne = await lireDuree(pool).catch(() => null);
    await pool.query(
      `INSERT INTO parametres (cle, valeur) VALUES ('conservation_passe_mois', $1::jsonb)
       ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur, modifie_le = now()`,
      [JSON.stringify(requete.body.moisConservation)],
    );
    requete.log.warn(
      { par: Number(requete.utilisateur.id), ancienne, nouvelle: requete.body.moisConservation },
      'durée de conservation modifiée',
    );
    return etat();
  });
}
