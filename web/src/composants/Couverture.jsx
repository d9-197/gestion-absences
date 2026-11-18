import { useDonnees } from '../donnees.js';
import { formatPeriode, nomComplet } from '../format.js';

// Pour décider : qui d'autre, dans la même équipe, est absent pendant la période demandée.
export default function Couverture({ demandeId }) {
  const { donnees, erreur } = useDonnees(`/demandes/${demandeId}/couverture`);
  if (erreur) return <p className="message erreur" role="alert">{erreur}</p>;
  if (!donnees) return null;
  const { absences, effectif, equipe } = donnees;
  const personnes = new Set(absences.map((a) => a.collaborateur.id)).size;
  return (
    <div className="couverture">
      <h3>Couverture de l'équipe {equipe.nom}</h3>
      {absences.length === 0 ? (
        <p className="aide">Personne d'autre n'est absent dans l'équipe sur cette période ({effectif} personne{effectif > 1 ? 's' : ''} dans l'équipe).</p>
      ) : (
        <>
          <p className={personnes * 2 >= effectif ? 'message alerte' : 'aide'}>
            {personnes} collègue{personnes > 1 ? 's' : ''} déjà absent{personnes > 1 ? 's' : ''} sur {effectif} personne{effectif > 1 ? 's' : ''} dans l'équipe.
          </p>
          <ul className="liste-simple">
            {absences.map((a) => (
              <li key={a.demandeId}>
                {nomComplet(a.collaborateur)} : {formatPeriode(a)}, {a.type}
                {a.statut === 'en_attente' && <span className="pastille">En attente</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
