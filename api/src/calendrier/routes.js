import { ErreurMetier } from '../erreurs.js';
import { calculerDuree, nombreDeJours } from './dates.js';
import { calendrierEquipe, joursNonTravailles } from './service.js';

const PERIODE_MAX_JOURS = 800;
const date = { type: 'string', format: 'date' };
const demiJournee = { enum: ['matin', 'apres_midi'] };

function verifierPeriode(debut, fin) {
  if (fin < debut) throw new ErreurMetier(400, 'La date de fin précède la date de début');
  if (nombreDeJours(debut, fin) > PERIODE_MAX_JOURS) throw new ErreurMetier(400, 'Période trop longue');
}

// Calendrier vu par la personne connectée : il dépend de son équipe.
export async function routesCalendrier(app, { pool }) {
  app.addHook('onRequest', app.authentifier);

  app.get('/calendrier', {
    schema: { querystring: { type: 'object', required: ['debut', 'fin'], properties: { debut: date, fin: date } } },
  }, async (requete) => {
    const { debut, fin } = requete.query;
    verifierPeriode(debut, fin);
    return calendrierEquipe(pool, { equipeId: requete.utilisateur.equipe_id, debut, fin });
  });

  // Durée qu'aurait une absence de la personne connectée, pour l'afficher avant la soumission.
  app.post('/calendrier/duree', {
    schema: {
      body: {
        type: 'object', required: ['dateDebut', 'dateFin'],
        properties: { dateDebut: date, debutDemiJournee: demiJournee, dateFin: date, finDemiJournee: demiJournee },
      },
    },
  }, async (requete) => {
    const { dateDebut, dateFin } = requete.body;
    verifierPeriode(dateDebut, dateFin);
    const nonTravailles = await joursNonTravailles(pool, {
      equipeId: requete.utilisateur.equipe_id, debut: dateDebut, fin: dateFin,
    });
    const demiJournees = calculerDuree({ ...requete.body, nonTravailles });
    return { demiJournees, jours: demiJournees / 2 };
  });
}
