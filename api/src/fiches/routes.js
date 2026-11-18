import { ErreurMetier } from '../erreurs.js';
import { chargerParametresPdf } from '../emails/donnees.js';
import { genererFichesPdf } from './pdf.js';
import { enteteTelechargement } from '../nom-fichier.js';
import { transaction } from '../admin/outils.js';
import { cloturerMois, etatCloture, ficheDe, rouvrirMois, verifierAcces, verifierMois } from './service.js';

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
    return ficheDe(pool, { collaborateurId, mois: requete.query.mois, aujourdhui: aujourdhui() });
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
    for (const id of ids) fiches.push(await ficheDe(pool, { collaborateurId: id, mois: requete.query.mois, aujourdhui: aujourdhui() }));
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
      .header('Content-Disposition', enteteTelechargement(`${nom}.pdf`))
      .header('Cache-Control', 'no-store')
      .send(pdf);
  });

  // Clôture et réouverture d'un mois : réservées aux directeurs.
  const directeur = async (requete) => {
    if (requete.utilisateur.role !== 'directeur') throw new ErreurMetier(403, 'Réservé aux directeurs');
  };
  const corps = { type: 'object', required: ['mois'], additionalProperties: false, properties: { mois, confirmerProvisoire: { type: 'boolean' } } };

  app.get('/fiches-rh/cloture', {
    onRequest: directeur, schema: { querystring: { type: 'object', required: ['mois'], properties: { mois } } },
  }, async (requete) => ({ cloture: await etatCloture(pool, requete.query.mois) }));

  app.post('/fiches-rh/cloture', { onRequest: directeur, schema: { body: corps } }, async (requete, reponse) => {
    await verifierMois(pool, { mois: requete.body.mois, aujourdhui: aujourdhui() });
    const nombre = await transaction(pool, (client) => cloturerMois(client, {
      mois: requete.body.mois, auteurId: Number(requete.utilisateur.id), aujourdhui: aujourdhui(), confirmerProvisoire: requete.body.confirmerProvisoire,
    }));
    return reponse.code(201).send({ fiches: nombre, cloture: await etatCloture(pool, requete.body.mois) });
  });

  app.post('/fiches-rh/reouverture', { onRequest: directeur, schema: { body: corps } }, async (requete) => {
    await transaction(pool, (client) => rouvrirMois(client, { mois: requete.body.mois, auteurId: Number(requete.utilisateur.id) }));
    return { cloture: null };
  });
}
