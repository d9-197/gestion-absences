import { routesAdminCalendrier } from './calendrier.js';
import { routesCollaborateurs } from './collaborateurs.js';
import { routesEquipes } from './equipes.js';
import { routesTypesAbsence } from './types-absence.js';

// Toutes les routes /api/admin sont réservées aux directeurs.
export async function routesAdmin(app, { pool, config, courriel }) {
  const options = { pool, config, courriel };
  app.addHook('onRequest', app.authentifier);
  app.addHook('onRequest', app.exigerRole('directeur'));

  await app.register(routesEquipes, options);
  await app.register(routesCollaborateurs, options);
  await app.register(routesTypesAbsence, options);
  await app.register(routesAdminCalendrier, options);
}
