import Fastify from 'fastify';

// Construit l'application sans l'écouter, pour pouvoir la tester.
export function construireApp({ pool, logger = true }) {
  const app = Fastify({ logger });

  app.get('/api/health', async (_requete, reponse) => {
    try {
      await pool.query('SELECT 1');
      return { statut: 'ok', base: 'ok' };
    } catch (erreur) {
      app.log.error(erreur, 'base de données injoignable');
      return reponse.code(503).send({ statut: 'erreur', base: 'injoignable' });
    }
  });

  return app;
}
