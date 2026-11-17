import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { appeler } from '../api.js';
import { useSession } from '../session.jsx';
import Cadre from '../composants/Cadre.jsx';

const ROLES = { collaborateur: 'Collaborateur', responsable: 'Responsable', directeur: 'Directeur' };

export default function Accueil() {
  const { utilisateur } = useSession();
  const valideur = utilisateur.role !== 'collaborateur';
  const [aTraiter, setATraiter] = useState(null);

  useEffect(() => {
    if (valideur) appeler('/demandes/compteur').then((r) => setATraiter(r.aTraiter)).catch(() => {});
  }, [valideur]);

  return (
    <Cadre>
      <h1>Bonjour {utilisateur.prenom}</h1>
      {valideur && aTraiter > 0 && (
        <p className="message alerte">
          {aTraiter === 1 ? '1 demande attend' : `${aTraiter} demandes attendent`} votre décision.{' '}
          <Link to="/a-traiter">Les traiter</Link>
        </p>
      )}
      <p><Link className="bouton compact lien-bouton" to="/demandes?nouvelle=1">Nouvelle demande d'absence</Link></p>
      <dl className="fiche">
        <dt>Adresse e-mail</dt><dd>{utilisateur.email}</dd>
        <dt>Équipe</dt><dd>{utilisateur.equipe.nom}</dd>
        <dt>Rôle</dt><dd>{ROLES[utilisateur.role]}</dd>
      </dl>
    </Cadre>
  );
}
