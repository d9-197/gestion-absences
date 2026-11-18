import { routesAdminConservation } from './conservation.js';
import { routesAdminCalendrier } from './calendrier.js';
import { routesAdminEmails } from './emails.js';
import { routesCollaborateurs } from './collaborateurs.js';
import { routesImportCollaborateurs } from './import-collaborateurs.js';
import { routesAdminNotifications } from './notifications.js';
import { routesTableauDeBord } from './tableau-de-bord.js';
import { routesEquipes } from './equipes.js';
import { routesAdminCompteurs } from '../compteurs/routes.js';
import { routesTypesAbsence } from './types-absence.js';
import { journaliser, routesJournal } from './journal.js';

// Toutes les routes /api/admin sont réservées aux directeurs.
export async function routesAdmin(app, { pool, config, courriel, aujourdhui }) {
  const options = { pool, config, courriel, aujourdhui };
  app.addHook('onRequest', app.authentifier);
  app.addHook('onRequest', app.exigerRole('directeur'));

  journaliser(app, pool);
  await app.register(routesJournal, options);
  await app.register(routesEquipes, options);
  await app.register(routesImportCollaborateurs, options);
  await app.register(routesCollaborateurs, options);
  await app.register(routesTypesAbsence, options);
  await app.register(routesAdminCalendrier, options);
  await app.register(routesAdminEmails, options);
  await app.register(routesAdminConservation, options);
  await app.register(routesAdminNotifications, options);
  await app.register(routesAdminCompteurs, options);
  await app.register(routesTableauDeBord, options);
}
