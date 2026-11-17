import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router';
import { appeler } from '../api.js';
import { useSession } from '../session.jsx';

// Bandeau commun aux pages réservées aux personnes connectées.
export default function Cadre({ children, large = false }) {
  const { utilisateur, deconnecter } = useSession();
  const valideur = utilisateur.role !== 'collaborateur';
  const directeur = utilisateur.role === 'directeur';
  const [aTraiter, setATraiter] = useState(0);
  const [echecsEmails, setEchecsEmails] = useState(0);

  // Nombre de demandes en attente de la personne connectée, remis à jour après chaque décision.
  const actualiser = useCallback(() => {
    if (valideur) appeler('/demandes/compteur').then((r) => setATraiter(r.aTraiter)).catch(() => {});
    if (directeur) appeler('/admin/envois-email/compteur').then((r) => setEchecsEmails(r.echecs)).catch(() => {});
  }, [valideur, directeur]);
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
          <NavLink to="/planning">Planning</NavLink>
          {valideur && <NavLink to="/export">Export</NavLink>}
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
              <NavLink to="/admin/emails">E-mails</NavLink>
            </>
          )}
        </nav>
        <span className="bandeau-droite">
          {utilisateur.prenom} {utilisateur.nom}
          <button className="bouton lien" type="button" onClick={deconnecter}>Se déconnecter</button>
        </span>
      </header>
      <main className={large ? 'page page-large' : 'page'}>
        {echecsEmails > 0 && (
          <p className="message erreur" role="alert">
            {echecsEmails === 1 ? "1 e-mail n'a pas pu être envoyé" : `${echecsEmails} e-mails n'ont pas pu être envoyés`}
            {' '}(décisions ou notifications). <Link to="/admin/emails">Voir et relancer</Link>
          </p>
        )}
        {children}
      </main>
    </>
  );
}
