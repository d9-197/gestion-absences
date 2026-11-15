import { useCallback, useEffect, useState } from 'react';
import { appeler } from './api.js';

// Charge une ressource de l'API et permet de la recharger après une modification.
export function useDonnees(chemin) {
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState('');

  const recharger = useCallback(async () => {
    try {
      setDonnees(await appeler(chemin));
      setErreur('');
    } catch (e) {
      setErreur(e.message);
    }
  }, [chemin]);

  useEffect(() => { recharger(); }, [recharger]);
  return { donnees, erreur, recharger };
}

// Gère l'envoi d'un formulaire : état « en cours » et message d'erreur.
export function useEnvoi() {
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState('');

  async function envoyer(action) {
    setErreur('');
    setEnCours(true);
    try {
      await action();
      return true;
    } catch (e) {
      setErreur(e.message);
      return false;
    } finally {
      setEnCours(false);
    }
  }
  return { enCours, erreur, envoyer };
}
