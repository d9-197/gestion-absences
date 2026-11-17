import { aujourdhui as jourDeLEntreprise } from '../calendrier/dates.js';
import { entretien, purger } from './service.js';

export const HEURE_PURGE = 3; // la purge automatique n'a pas lieu avant 3 h, heure de l'entreprise
const INTERVALLE_MS = 15 * 60 * 1000;

// Lance la purge une fois par jour, la nuit. Le contrôle se répète toutes les 15 minutes : si l'API était arrêtée à
// 3 h, la purge du jour a lieu dès son redémarrage ; si elle échoue, elle est retentée.
export function creerPlanificateurPurge({ pool, config, log, maintenant = () => new Date() }) {
  const fuseau = config.fuseau ?? 'Europe/Paris';
  let minuteur = null;
  let enCours = null;

  const verifier = () => {
    enCours ??= (async () => {
      const instant = maintenant();
      // Par composantes : le texte d'une heure formatée varie selon la langue (« 02 h » en français).
      const heure = Number(new Intl.DateTimeFormat('en-GB', { timeZone: fuseau, hour: '2-digit', hourCycle: 'h23' })
        .formatToParts(instant).find((partie) => partie.type === 'hour')?.value);
      // Heure illisible ou trop tôt : on ne supprime rien.
      if (!Number.isInteger(heure) || heure < HEURE_PURGE) return null;
      const resultat = await purger(pool, {
        aujourdhui: jourDeLEntreprise(fuseau, instant), origine: 'automatique', unParJour: true,
      });
      if (resultat) {
        log?.info(resultat, 'purge des demandes terminée');
        log?.info(await entretien(pool), 'entretien : sessions et liens périmés supprimés');
      }
      return resultat;
    })().finally(() => { enCours = null; });
    return enCours;
  };

  const surveiller = () => verifier().catch((erreur) => log?.error(erreur, 'purge des demandes impossible'));

  return {
    verifier,
    demarrer() {
      if (minuteur) return;
      minuteur = setInterval(surveiller, INTERVALLE_MS);
      minuteur.unref();
      surveiller();
    },
    async arreter() {
      if (minuteur) clearInterval(minuteur);
      minuteur = null;
      await enCours?.catch(() => {});
    },
  };
}
