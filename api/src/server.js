import pg from './base.js';
import { config } from './config.js';
import { construireApp } from './app.js';
import { creerCourriel } from './courriel.js';
import { creerMicrosoft } from './auth/microsoft.js';
import { assurerAnnee } from './calendrier/service.js';

const pool = new pg.Pool(config.db);
const app = await construireApp({
  pool,
  config,
  courriel: creerCourriel(config.smtp),
  microsoft: config.microsoft ? creerMicrosoft({ ...config.microsoft, appUrl: config.appUrl }) : null,
});

// Une connexion inactive coupée (base redémarrée) émet une erreur sur le pool :
// sans ce gestionnaire, elle arrêterait le processus.
pool.on('error', (erreur) => app.log.error(erreur, 'connexion à la base perdue'));

async function arreter(signal) {
  app.log.info(`${signal} reçu, arrêt`);
  await app.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', () => arreter('SIGTERM'));
process.on('SIGINT', () => arreter('SIGINT'));

// Préremplit les jours fériés de l'année en cours et de la suivante. Un échec ne bloque pas le démarrage :
// le préremplissage est refait à la première utilisation du calendrier.
const anneeCourante = new Date().getFullYear();
for (const an of [anneeCourante, anneeCourante + 1]) {
  await assurerAnnee(pool, an).catch((erreur) => app.log.warn(erreur, `jours fériés ${an} non préremplis`));
}

try {
  await app.listen({ host: '0.0.0.0', port: config.port });
} catch (erreur) {
  app.log.error(erreur);
  process.exit(1);
}
