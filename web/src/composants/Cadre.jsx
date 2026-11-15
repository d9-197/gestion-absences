import { NavLink } from 'react-router';
import { useSession } from '../session.jsx';

// Bandeau commun aux pages réservées aux personnes connectées.
export default function Cadre({ children }) {
  const { utilisateur, deconnecter } = useSession();
  return (
    <>
      <header className="bandeau">
        <strong>Gestion des absences</strong>
        <nav className="navigation" aria-label="Navigation principale">
          <NavLink to="/" end>Accueil</NavLink>
          {utilisateur.role === 'directeur' && (
            <>
              <NavLink to="/admin/collaborateurs">Collaborateurs</NavLink>
              <NavLink to="/admin/equipes">Équipes</NavLink>
              <NavLink to="/admin/types-absence">Types d'absence</NavLink>
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
