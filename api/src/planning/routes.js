import { ErreurMetier } from '../erreurs.js';
import { nombreDeJours } from '../calendrier/dates.js';
import { construirePlanning, personnesVisibles } from './service.js';

const PERIODE_MAX_JOURS = 100;
const date = { type: 'string', format: 'date' };

export async function routesPlanning(app, { pool }) {
  app.addHook('onRequest', app.authentifier);

  app.get('/planning', {
    schema: { querystring: { type: 'object', required: ['debut', 'fin'], properties: { debut: date, fin: date } } },
  }, async (requete) => {
    const { debut, fin } = requete.query;
    if (fin < debut) throw new ErreurMetier(400, 'La date de fin précède la date de début');
    if (nombreDeJours(debut, fin) > PERIODE_MAX_JOURS) throw new ErreurMetier(400, `Le planning est limité à ${PERIODE_MAX_JOURS} jours`);
    const moi = Number(requete.utilisateur.id);
    return construirePlanning(pool, { moi, debut, fin, personnes: await personnesVisibles(pool, { moi, debut, fin }) });
  });
}
