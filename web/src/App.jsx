import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { FournisseurSession, useSession } from './session.jsx';
import Accueil from './pages/Accueil.jsx';
import MesDemandes from './pages/MesDemandes.jsx';
import Planning from './pages/Planning.jsx';
import Export from './pages/Export.jsx';
import ATraiter from './pages/ATraiter.jsx';
import Connexion from './pages/Connexion.jsx';
import MotDePasseOublie from './pages/MotDePasseOublie.jsx';
import DefinirMotDePasse from './pages/DefinirMotDePasse.jsx';
import Collaborateurs from './pages/admin/Collaborateurs.jsx';
import Equipes from './pages/admin/Equipes.jsx';
import TypesAbsence from './pages/admin/TypesAbsence.jsx';
import Calendrier from './pages/admin/Calendrier.jsx';
import Emails from './pages/admin/Emails.jsx';

// Réserve une page aux personnes connectées.
function Protegee({ children, role }) {
  const { utilisateur } = useSession();
  if (utilisateur === undefined) return <p className="chargement">Chargement…</p>;
  if (utilisateur === null) return <Navigate to="/connexion" replace />;
  // Simple confort d'affichage : l'API refuse de toute façon ces routes aux autres rôles.
  if (role && ![].concat(role).includes(utilisateur.role)) return <Navigate to="/" replace />;
  return children;
}

function Pages() {
  const { utilisateur } = useSession();
  if (utilisateur === undefined) return <p className="chargement">Chargement…</p>;
  return (
    <Routes>
      <Route path="/connexion" element={<Connexion />} />
      <Route path="/mot-de-passe-oublie" element={<MotDePasseOublie />} />
      <Route path="/definir-mot-de-passe" element={<DefinirMotDePasse />} />
      <Route path="/" element={<Protegee><Accueil /></Protegee>} />
      <Route path="/demandes" element={<Protegee><MesDemandes /></Protegee>} />
      <Route path="/planning" element={<Protegee><Planning /></Protegee>} />
      <Route path="/export" element={<Protegee role={['responsable', 'directeur']}><Export /></Protegee>} />
      <Route path="/a-traiter" element={<Protegee role={['responsable', 'directeur']}><ATraiter /></Protegee>} />
      <Route path="/admin/collaborateurs" element={<Protegee role="directeur"><Collaborateurs /></Protegee>} />
      <Route path="/admin/equipes" element={<Protegee role="directeur"><Equipes /></Protegee>} />
      <Route path="/admin/calendrier" element={<Protegee role="directeur"><Calendrier /></Protegee>} />
      <Route path="/admin/emails" element={<Protegee role="directeur"><Emails /></Protegee>} />
      <Route path="/admin/types-absence" element={<Protegee role="directeur"><TypesAbsence /></Protegee>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <FournisseurSession>
        <Pages />
      </FournisseurSession>
    </BrowserRouter>
  );
}
