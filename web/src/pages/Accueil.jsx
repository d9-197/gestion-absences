import { useSession } from '../session.jsx';
import Cadre from '../composants/Cadre.jsx';

const ROLES = { collaborateur: 'Collaborateur', responsable: 'Responsable', directeur: 'Directeur' };

// Page provisoire : les écrans de demandes et de planning viendront ici.
export default function Accueil() {
  const { utilisateur } = useSession();
  return (
    <Cadre>
      <h1>Bonjour {utilisateur.prenom}</h1>
      <dl className="fiche">
        <dt>Adresse e-mail</dt><dd>{utilisateur.email}</dd>
        <dt>Équipe</dt><dd>{utilisateur.equipe.nom}</dd>
        <dt>Rôle</dt><dd>{ROLES[utilisateur.role]}</dd>
      </dl>
      <p className="aide">Les demandes d'absence et le planning ne sont pas encore disponibles.</p>
    </Cadre>
  );
}
