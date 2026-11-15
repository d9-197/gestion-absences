import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { FournisseurSession, useSession } from './session.jsx';
import Accueil from './pages/Accueil.jsx';
import Connexion from './pages/Connexion.jsx';
import MotDePasseOublie from './pages/MotDePasseOublie.jsx';
import DefinirMotDePasse from './pages/DefinirMotDePasse.jsx';

// Réserve une page aux personnes connectées.
function Protegee({ children }) {
  const { utilisateur } = useSession();
  if (utilisateur === undefined) return <p className="chargement">Chargement…</p>;
  if (utilisateur === null) return <Navigate to="/connexion" replace />;
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
