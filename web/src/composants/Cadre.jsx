import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { appeler } from '../api.js';
import { useATraiter } from '../donnees.js';
import { useSession } from '../session.jsx';
import { ROLES } from '../pages/Compte.jsx';

const ECRANS_ADMIN = [
  ['/admin/collaborateurs', 'Collaborateurs'],
  ['/admin/equipes', 'Équipes'],
  ['/admin/types-absence', "Types d'absence"],
  ['/admin/calendrier', 'Calendrier'],
  ['/admin/emails', 'E-mails'],
  ['/admin/conservation', 'Conservation'],
  ['/admin/journal', 'Journal'],
];

// Menu déroulant des écrans d'administration : se ferme au choix d'un écran, à Échap et au clic ailleurs.
function MenuAdministration({ echecsEmails }) {
  const { pathname } = useLocation();
  const menu = useRef(null);
  const [ouvert, setOuvert] = useState(false);
  const actif = pathname.startsWith('/admin/');

  useEffect(() => { setOuvert(false); }, [pathname]);
  useEffect(() => {
    if (!ouvert) return undefined;
    const clic = (e) => { if (!menu.current?.contains(e.target)) setOuvert(false); };
    const touche = (e) => { if (e.key === 'Escape') { setOuvert(false); menu.current?.querySelector('button')?.focus(); } };
    document.addEventListener('mousedown', clic);
    document.addEventListener('keydown', touche);
    return () => { document.removeEventListener('mousedown', clic); document.removeEventListener('keydown', touche); };
  }, [ouvert]);

  return (
    <div className="menu-admin" ref={menu}>
      <button type="button" className={`menu-admin-bouton${actif ? ' active' : ''}`} aria-expanded={ouvert} aria-controls="menu-admin-liste"
        onClick={() => setOuvert(!ouvert)}>
        Administration
        {echecsEmails > 0 && <span className="badge">{echecsEmails}<span className="visuellement-cache"> e-mails en échec</span></span>}
        <span aria-hidden="true"> ▾</span>
      </button>
      {ouvert && (
        <ul id="menu-admin-liste" className="menu-admin-liste">
          {ECRANS_ADMIN.map(([chemin, libelle]) => (
            <li key={chemin}><NavLink to={chemin}>{libelle}</NavLink></li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Bandeau commun aux pages réservées aux personnes connectées.
export default function Cadre({ children, large = false }) {
  const { utilisateur, deconnecter } = useSession();
  const valideur = utilisateur.role !== 'collaborateur';
  const directeur = utilisateur.role === 'directeur';
  const aTraiter = useATraiter(valideur);
  const [echecsEmails, setEchecsEmails] = useState(0);

  // E-mails en échec, signalés aux directeurs ; remis à jour après chaque relance.
  const actualiser = useCallback(() => {
    if (directeur) appeler('/admin/envois-email/compteur').then((r) => setEchecsEmails(r.echecs)).catch(() => {});
  }, [directeur]);
  useEffect(() => {
    actualiser();
    window.addEventListener('demandes-changees', actualiser);
    return () => window.removeEventListener('demandes-changees', actualiser);
  }, [actualiser]);

  return (
    <>
      <header className="bandeau">
        <Link to="/" className="marque">Gestion des absences</Link>
        <nav className="navigation" aria-label="Navigation principale">
          <NavLink to="/planning">Planning</NavLink>
          <NavLink to="/demandes">Mes demandes</NavLink>
          {valideur && <NavLink to="/export">Export</NavLink>}
          {valideur && (
            <NavLink to="/a-traiter">
              À traiter{aTraiter > 0 && <span className="badge">{aTraiter}<span className="visuellement-cache"> en attente</span></span>}
            </NavLink>
          )}
          {directeur && <MenuAdministration echecsEmails={echecsEmails} />}
        </nav>
        <span className="bandeau-droite">
          <Link to="/compte" className="compte" aria-label={`Mon compte : ${utilisateur.prenom} ${utilisateur.nom}, ${utilisateur.equipe.nom}, ${ROLES[utilisateur.role]}`}>
            <span className="compte-nom">{utilisateur.prenom} {utilisateur.nom}</span>
            <span className="compte-detail">{utilisateur.equipe.nom} · {ROLES[utilisateur.role]}</span>
          </Link>
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
