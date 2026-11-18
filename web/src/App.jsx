import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { BASE } from './api.js';
import { FournisseurSession, useSession } from './session.jsx';
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
import Compteurs from './pages/admin/Compteurs.jsx';
import Calendrier from './pages/admin/Calendrier.jsx';
import Emails from './pages/admin/Emails.jsx';
import FichesRh from './pages/FichesRh.jsx';
import Journal from './pages/admin/Journal.jsx';
import Conservation from './pages/admin/Conservation.jsx';
import Compte from './pages/Compte.jsx';

// Réserve une page aux personnes connectées.
function Protegee({ children, role }) {
  const { utilisateur, motif } = useSession();
  const lieu = useLocation();
  if (utilisateur === undefined) return <p className="chargement">Chargement…</p>;
  // La page demandée est mémorisée pour y revenir après la connexion, sauf après une déconnexion volontaire.
  if (utilisateur === null) {
    return <Navigate to="/connexion" replace state={motif === 'volontaire' ? null : { depuis: lieu.pathname + lieu.search }} />;
  }
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
      <Route path="/" element={<Navigate to="/planning" replace />} />
      <Route path="/compte" element={<Protegee><Compte /></Protegee>} />
      <Route path="/demandes" element={<Protegee><MesDemandes /></Protegee>} />
      <Route path="/planning" element={<Protegee><Planning /></Protegee>} />
      <Route path="/fiches-rh" element={<Protegee><FichesRh /></Protegee>} />
      <Route path="/export" element={<Protegee role={['responsable', 'directeur']}><Export /></Protegee>} />
      <Route path="/a-traiter" element={<Protegee role={['responsable', 'directeur']}><ATraiter /></Protegee>} />
      <Route path="/admin/collaborateurs" element={<Protegee role="directeur"><Collaborateurs /></Protegee>} />
      <Route path="/admin/equipes" element={<Protegee role="directeur"><Equipes /></Protegee>} />
      <Route path="/admin/calendrier" element={<Protegee role="directeur"><Calendrier /></Protegee>} />
      <Route path="/admin/emails" element={<Protegee role="directeur"><Emails /></Protegee>} />
      <Route path="/admin/journal" element={<Protegee role="directeur"><Journal /></Protegee>} />
      <Route path="/admin/conservation" element={<Protegee role="directeur"><Conservation /></Protegee>} />
      <Route path="/admin/compteurs" element={<Protegee role="directeur"><Compteurs /></Protegee>} />
      <Route path="/admin/types-absence" element={<Protegee role="directeur"><TypesAbsence /></Protegee>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter basename={BASE || undefined}>
      <FournisseurSession>
        <Pages />
      </FournisseurSession>
    </BrowserRouter>
  );
}
