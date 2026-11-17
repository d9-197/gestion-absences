// Purge des demandes terminées depuis plus longtemps que la durée de conservation. SUPPRESSION DÉFINITIVE.
//
//   docker compose exec api node scripts/purger.js              simulation : indique ce qui serait supprimé
//   docker compose exec api node scripts/purger.js --executer   supprime vraiment, et consigne la purge
//
// La purge a aussi lieu toute seule, chaque nuit après 3 h. Ce script sert à la contrôler ou à la déclencher à la main.
import pg from '../src/base.js';
import { config } from '../src/config.js';
import { aujourdhui } from '../src/calendrier/dates.js';
import { apercu, lireDuree, purger } from '../src/purge/service.js';

const executer = process.argv.includes('--executer');
const pool = new pg.Pool(config.db);
try {
  const jour = aujourdhui(config.fuseau);
  const mois = await lireDuree(pool);
  const prevu = await apercu(pool, { mois, aujourdhui: jour });
  console.log(`Durée de conservation : ${mois} mois. Date limite : ${prevu.dateLimite}.`);
  console.log(`À supprimer : ${prevu.demandes} demande(s) terminée(s) avant cette date, avec ${prevu.evenements} ligne(s) d'historique.`);

  if (!executer) {
    console.log("Simulation : rien n'a été supprimé. Pour supprimer vraiment : node scripts/purger.js --executer");
  } else {
    const resultat = await purger(pool, { aujourdhui: jour, origine: 'ligne_de_commande' });
    if (!resultat) throw new Error('Une autre purge est en cours : réessayez dans un instant.');
    console.log(`Purge effectuée : ${resultat.demandesSupprimees} demande(s) et ${resultat.evenementsSupprimes} ligne(s) d'historique supprimées.`);
  }
} catch (erreur) {
  console.error(`Échec : ${erreur.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
