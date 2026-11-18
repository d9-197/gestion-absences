import { useEffect, useState } from 'react';
import { appeler } from '../../api.js';
import { formatDateHeure } from '../../format.js';
import Cadre from '../../composants/Cadre.jsx';

// Les valeurs saisies, lisibles : « role : responsable ».
const resume = (details) => {
  const corps = details?.corps;
  if (!corps || typeof corps !== 'object') return '';
  return Object.entries(corps).map(([cle, valeur]) => `${cle} : ${typeof valeur === 'object' ? JSON.stringify(valeur) : valeur}`).join(' · ');
};

export default function Journal() {
  const [lignes, setLignes] = useState(null);
  const [suite, setSuite] = useState(null);
  const [erreur, setErreur] = useState('');

  async function charger(avant) {
    try {
      const page = await appeler(`/admin/journal?limite=50${avant ? `&avant=${avant}` : ''}`);
      setLignes((anciennes) => (avant ? [...(anciennes ?? []), ...page.lignes] : page.lignes));
      setSuite(page.suite);
      setErreur('');
    } catch (e) {
      setErreur(e.message);
    }
  }
  useEffect(() => { charger(null); }, []);

  return (
    <Cadre large>
      <div className="entete-page"><h1>Journal des modifications</h1></div>
      <p className="aide">
        Qui a modifié l'administration (collaborateurs, rôles, équipes, délégations, types, calendrier, réglages), et quand.
        Le journal n'enregistre que les nouvelles valeurs saisies ; il ne peut ni être modifié ni être effacé.
      </p>
      {erreur && <p className="message erreur" role="alert">{erreur}</p>}
      {!lignes ? (
        !erreur && <p className="chargement">Chargement…</p>
      ) : (
        <div className="tableau-defilant">
          <table>
            <thead><tr><th>Date</th><th>Par</th><th>Action</th><th>Sur</th><th>Valeurs</th></tr></thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.id}>
                  <td>{formatDateHeure(l.le)}</td>
                  <td>{l.auteur}</td>
                  <td>{l.action}</td>
                  <td>{l.cible ?? '—'}</td>
                  <td>{resume(l.details) || '—'}</td>
                </tr>
              ))}
              {lignes.length === 0 && <tr><td colSpan={5} className="vide">Aucune modification enregistrée.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {suite && <p><button className="bouton secondaire compact" type="button" onClick={() => charger(suite)}>Voir les modifications plus anciennes</button></p>}
    </Cadre>
  );
}
