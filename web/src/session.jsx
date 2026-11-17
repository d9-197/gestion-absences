import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { appeler } from './api.js';

const ContexteSession = createContext(null);

// Charge le profil de la personne connectée et le met à disposition de toute l'application.
export function FournisseurSession({ children }) {
  // undefined : chargement en cours ; null : personne n'est connecté.
  const [utilisateur, setUtilisateur] = useState(undefined);

  const recharger = useCallback(async () => {
    try {
      const moi = await appeler('/auth/moi');
      setUtilisateur(moi);
      return moi;
    } catch {
      setUtilisateur(null);
      return null;
    }
  }, []);

  const deconnecter = useCallback(async () => {
    await appeler('/auth/deconnexion', { methode: 'POST' }).catch(() => {});
    setUtilisateur(null);
  }, []);

  useEffect(() => { recharger(); }, [recharger]);

  return (
    <ContexteSession.Provider value={{ utilisateur, recharger, deconnecter }}>
      {children}
    </ContexteSession.Provider>
  );
}

export const useSession = () => useContext(ContexteSession);
