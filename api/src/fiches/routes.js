import { ErreurMetier } from '../erreurs.js';
import { chargerParametresPdf } from '../emails/donnees.js';
import { genererFichesPdf } from './pdf.js';
import { calculerFiche, verifierAcces, verifierMois } from './service.js';

const mois = { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' };
const NOMBRE_MAX = 100;

// Fiche RH mensuelle : à l'écran (JSON) pour une personne, en PDF pour une ou plusieurs personnes (une page chacune).
export async function routesFiches(app, { pool, config, aujourdhui }) {
  app.addHook('onRequest', app.authentifier);

  app.get('/fiches-rh', {
    schema: { querystring: { type: 'object', required: ['mois'], properties: { mois, collaborateurId: { type: 'integer', minimum: 1 } } } },
  }, async (requete) => {
    const collaborateurId = requete.query.collaborateurId ?? Number(requete.utilisateur.id);
    await verifierAcces(pool, { utilisateur: requete.utilisateur, collaborateurId });
    await verifierMois(pool, { mois: requete.query.mois, aujourdhui: aujourdhui() });
    return calculerFiche(pool, { collaborateurId, mois: requete.query.mois });
  });

  // `collaborateurIds` : plusieurs fiches (un valideur ou un directeur) ; sans, la sienne.
  app.get('/fiches-rh/pdf', {
    schema: {
      querystring: {
        type: 'object', required: ['mois'],
        properties: { mois, collaborateurIds: { type: 'string', pattern: '^\\d+(,\\d+)*$', maxLength: 2000 } },
      },
    },
  }, async (requete, reponse) => {
    const ids = requete.query.collaborateurIds
      ? [...new Set(requete.query.collaborateurIds.split(',').map(Number))]
      : [Number(requete.utilisateur.id)];
    if (ids.length > NOMBRE_MAX) throw new ErreurMetier(400, `Au plus ${NOMBRE_MAX} fiches à la fois`);
    for (const id of ids) await verifierAcces(pool, { utilisateur: requete.utilisateur, collaborateurId: id });
    await verifierMois(pool, { mois: requete.query.mois, aujourdhui: aujourdhui() });

    const fiches = [];
    for (const id of ids) fiches.push(await calculerFiche(pool, { collaborateurId: id, mois: requete.query.mois }));
    fiches.sort((a, b) => a.collaborateur.nom.localeCompare(b.collaborateur.nom, 'fr') || a.collaborateur.prenom.localeCompare(b.collaborateur.prenom, 'fr'));
    const parametres = await chargerParametresPdf(pool);
    const pdf = await genererFichesPdf(fiches, {
      raisonSociale: parametres.raisonSociale, editeePar: `${requete.utilisateur.prenom} ${requete.utilisateur.nom}`, fuseau: config.fuseau ?? 'Europe/Paris',
    });
    const nom = fiches.length === 1
      ? `fiche-rh-${requete.query.mois}-${fiches[0].collaborateur.nom}-${fiches[0].collaborateur.prenom}`
      : `fiches-rh-${requete.query.mois}`;
    return reponse
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${nom.normalize('NFD').replace(/[^\w.-]+/g, '_')}.pdf"`)
      .header('Cache-Control', 'no-store')
      .send(pdf);
  });
}
