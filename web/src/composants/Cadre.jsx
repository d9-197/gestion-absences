import { useCallback, useEffect, useState } from 'react';
import { NavLink } from 'react-router';
import { appeler } from '../api.js';
import { useSession } from '../session.jsx';

// Bandeau commun aux pages réservées aux personnes connectées.
export default function Cadre({ children }) {
  const { utilisateur, deconnecter } = useSession();
  const valideur = utilisateur.role !== 'collaborateur';
  const [aTraiter, setATraiter] = useState(0);

  // Nombre de demandes en attente de la personne connectée, remis à jour après chaque décision.
  const actualiser = useCallback(() => {
    if (valideur) appeler('/demandes/compteur').then((r) => setATraiter(r.aTraiter)).catch(() => {});
  }, [valideur]);
  useEffect(() => {
    actualiser();
    window.addEventListener('demandes-changees', actualiser);
    return () => window.removeEventListener('demandes-changees', actualiser);
  }, [actualiser]);

  return (
    <>
      <header className="bandeau">
        <strong>Gestion des absences</strong>
        <nav className="navigation" aria-label="Navigation principale">
          <NavLink to="/" end>Accueil</NavLink>
          <NavLink to="/demandes">Mes demandes</NavLink>
          {valideur && (
            <NavLink to="/a-traiter">
              À traiter{aTraiter > 0 && <span className="badge">{aTraiter}<span className="visuellement-cache"> en attente</span></span>}
            </NavLink>
          )}
          {utilisateur.role === 'directeur' && (
            <>
              <NavLink to="/admin/collaborateurs">Collaborateurs</NavLink>
              <NavLink to="/admin/equipes">Équipes</NavLink>
              <NavLink to="/admin/types-absence">Types d'absence</NavLink>
              <NavLink to="/admin/calendrier">Calendrier</NavLink>
            </>
          )}
        </nav>
        <span className="bandeau-droite">
          {utilisateur.prenom} {utilisateur.nom}
          <button className="bouton lien" type="button" onClick={deconnecter}>Se déconnecter</button>
        </span>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
