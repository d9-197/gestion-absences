import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { creerSessions } from './auth/sessions.js';
import { routesAuth } from './auth/routes.js';

const LIMITES = {
  connexion: { max: 10, timeWindow: '1 minute' },
  oubli: { max: 5, timeWindow: '1 minute' },
};

// Construit l'application sans l'écouter, pour pouvoir la tester.
export async function construireApp({ pool, config, courriel, microsoft = null, logger = true, limites = LIMITES }) {
  // L'API n'est jointe qu'à travers nginx : l'adresse du client vient de l'en-tête X-Forwarded-For.
  const app = Fastify({ logger, trustProxy: true });
  const sessions = creerSessions({ pool, config });

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

  await app.register(routesAuth, { pool, config, sessions, courriel, microsoft, limites });

  return app;
}
