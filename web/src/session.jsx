import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { appeler } from './api.js';

const ContexteSession = createContext(null);

// Charge le profil de la personne connectée et le met à disposition de toute l'application.
export function FournisseurSession({ children }) {
  // undefined : chargement en cours ; null : personne n'est connecté.
  const [utilisateur, setUtilisateur] = useState(undefined);
  // Pourquoi personne n'est connecté : « expiree » (la session a pris fin) ou « volontaire » (déconnexion demandée).
  const [motif, setMotif] = useState(null);
  const connecte = useRef(false);
  useEffect(() => { connecte.current = Boolean(utilisateur); }, [utilisateur]);

  const recharger = useCallback(async () => {
    try {
      const moi = await appeler('/auth/moi');
      setUtilisateur(moi);
      setMotif(null);
      return moi;
    } catch {
      setUtilisateur(null);
      return null;
    }
  }, []);

  const deconnecter = useCallback(async () => {
    await appeler('/auth/deconnexion', { methode: 'POST' }).catch(() => {});
    setMotif('volontaire');
    setUtilisateur(null);
  }, []);

  useEffect(() => { recharger(); }, [recharger]);

  // Une requête refusée pour défaut de connexion alors qu'on se croyait connecté : la session a expiré.
  useEffect(() => {
    const surExpiration = () => {
      if (!connecte.current) return;
      setMotif('expiree');
      setUtilisateur(null);
    };
    window.addEventListener('session-expiree', surExpiration);
    return () => window.removeEventListener('session-expiree', surExpiration);
  }, []);

  return (
    <ContexteSession.Provider value={{ utilisateur, motif, recharger, deconnecter }}>
      {children}
    </ContexteSession.Provider>
  );
}

export const useSession = () => useContext(ContexteSession);
