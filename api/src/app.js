import './base.js';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { creerSessions } from './auth/sessions.js';
import { routesAuth } from './auth/routes.js';
import { routesAdmin } from './admin/index.js';
import { routesCalendrier } from './calendrier/routes.js';
import { routesDemandes } from './demandes/routes.js';
import { routesPlanning } from './planning/routes.js';
import { routesExport } from './export/routes.js';
import { routesSuivi } from './suivi/routes.js';
import { routesFiches } from './fiches/routes.js';
import { routesCompteurs } from './compteurs/routes.js';
import { aujourdhui as aujourdhuiEntreprise } from './calendrier/dates.js';
import { gestionnaireErreurs } from './erreurs.js';
import { creerFileEmails } from './emails/file.js';

const LIMITES = {
  connexion: { max: 10, timeWindow: '1 minute' },
  oubli: { max: 5, timeWindow: '1 minute' },
};

// Construit l'application sans l'écouter, pour pouvoir la tester.
export async function construireApp({
  pool, config, courriel, microsoft = null, logger = true, limites = LIMITES, autologin = false,
  // Date du jour dans le fuseau de l'entreprise ; remplaçable dans les tests.
  aujourdhui = () => aujourdhuiEntreprise(config.fuseau),
}) {
  // L'API n'est jointe qu'à travers nginx : l'adresse du client vient de l'en-tête X-Forwarded-For.
  const app = Fastify({ logger, trustProxy: true });
  const sessions = creerSessions({ pool, config });

  // File des e-mails de notification et de décision (envoi en arrière-plan, nouvelles tentatives).
  const fileEmails = creerFileEmails({ pool, courriel, config, log: app.log });
  app.decorate('fileEmails', fileEmails);
  app.addHook('onClose', () => fileEmails.arreter());

  app.setErrorHandler(gestionnaireErreurs);

  await app.register(cookie);
  // Limites appliquées seulement aux routes qui en déclarent une (connexion, mot de passe).
  await app.register(rateLimit, { global: false });

  app.decorateRequest('utilisateur', null);

  // À placer en preHandler des routes réservées aux personnes connectées.
  app.decorate('authentifier', async (requete, reponse) => {
    const utilisateur = await sessions.lire(requete);
    if (!utilisateur) return reponse.code(401).send({ erreur: 'Connexion requise' });
    requete.utilisateur = utilisateur;
  });

  // À placer après authentifier : app.exigerRole('responsable', 'directeur').
  app.decorate('exigerRole', (...roles) => async (requete, reponse) => {
    if (!roles.includes(requete.utilisateur?.role)) {
      return reponse.code(403).send({ erreur: 'Action non autorisée' });
    }
  });

  app.get('/api/health', async (_requete, reponse) => {
    try {
      await pool.query('SELECT 1');
      return { statut: 'ok', base: 'ok' };
    } catch (erreur) {
      app.log.error(erreur, 'base de données injoignable');
      return reponse.code(503).send({ statut: 'erreur', base: 'injoignable' });
    }
  });

  await app.register(routesAuth, { pool, config, sessions, courriel, microsoft, limites, autologin });
  await app.register(routesAdmin, { prefix: '/api/admin', pool, config, courriel, aujourdhui });
  await app.register(routesCalendrier, { prefix: '/api', pool });
  await app.register(routesDemandes, { prefix: '/api', pool, aujourdhui });
  await app.register(routesPlanning, { prefix: '/api', pool });
  await app.register(routesSuivi, { prefix: '/api', pool, aujourdhui });
  await app.register(routesFiches, { prefix: '/api', pool, config, aujourdhui });
  await app.register(routesCompteurs, { prefix: '/api', pool, aujourdhui });
  await app.register(routesExport, { prefix: '/api', pool, config });

  return app;
}
