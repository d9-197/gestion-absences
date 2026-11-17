import pg from './base.js';
import { config } from './config.js';
import { construireApp } from './app.js';
import { creerCourriel } from './courriel.js';
import { creerMicrosoft } from './auth/microsoft.js';
import { assurerAnnee } from './calendrier/service.js';
import { creerPlanificateurPurge } from './purge/planificateur.js';

const pool = new pg.Pool(config.db);
const app = await construireApp({
  pool,
  config,
  courriel: creerCourriel(config.smtp),
  autologin: config.autologin,
  microsoft: config.microsoft ? creerMicrosoft({ ...config.microsoft, appUrl: config.appUrl }) : null,
});

if (config.autologin) {
  app.log.error(
    'AUTOLOGIN_TEST est ACTIF : toute personne qui atteint cette adresse peut se connecter sans mot de passe '
    + 'en tant que n\'importe quel collaborateur, directeurs compris. À désactiver dès la fin des tests.',
  );
}
if (config.appUrl.startsWith('http://')) {
  app.log.warn(
    `APP_URL (${config.appUrl}) est en HTTP : mots de passe et sessions circulent en clair sur le réseau. `
    + 'À réserver aux essais ; en production, servir l\'application en HTTPS.',
  );
}
if (config.cookieSecure && config.appUrl.startsWith('http://')) {
  app.log.error('COOKIE_SECURE=true avec une adresse en HTTP : les navigateurs refuseront le cookie et personne ne pourra se connecter.');
}

// Une connexion inactive coupée (base redémarrée) émet une erreur sur le pool :
// sans ce gestionnaire, elle arrêterait le processus.
pool.on('error', (erreur) => app.log.error(erreur, 'connexion à la base perdue'));

// Purge des demandes dépassant la durée de conservation : une fois par jour, la nuit.
const purge = creerPlanificateurPurge({ pool, config, log: app.log });

async function arreter(signal) {
  app.log.info(`${signal} reçu, arrêt`);
  await purge.arreter();
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
  app.fileEmails.demarrer(config.emailsIntervalleSecondes * 1000);
  purge.demarrer();
  await app.listen({ host: '0.0.0.0', port: config.port });
} catch (erreur) {
  app.log.error(erreur);
  process.exit(1);
}
