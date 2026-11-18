import { useState } from 'react';
import { appeler } from '../api.js';
import { aujourdhui } from '../dates.js';
import { useEnvoi } from '../donnees.js';
import { nombre } from '../format.js';

// Soldes de congés indicatifs d'une personne, avec le recalage par le salarié (« à cette date, il me reste N jours »).
export default function Soldes({ donnees, collaborateurId = null, peutRecaler = false, onChange }) {
  const { enCours, erreur, envoyer } = useEnvoi();
  const [edition, setEdition] = useState(null); // { typeId, dateEffet, jours }
  if (!donnees?.actif || !donnees.soldes.length) return null;

  const enregistrer = (e) => {
    e.preventDefault();
    envoyer(async () => {
      await appeler('/compteurs/recalage', {
        methode: 'PUT',
        corps: { ...(collaborateurId ? { collaborateurId } : {}), typeId: edition.typeId, dateEffet: edition.dateEffet, joursRestants: Number(edition.jours) },
      });
      setEdition(null);
      onChange?.();
    });
  };

  return (
    <section className="soldes" aria-labelledby="titre-soldes">
      <h2 id="titre-soldes">Soldes de congés</h2>
      <p className="message alerte">{donnees.mention}</p>
      <div className="tableau-defilant">
        <table>
          <thead><tr><th>Type</th><th>Solde</th><th>Détail</th>{peutRecaler && <th>Actions</th>}</tr></thead>
          <tbody>
            {donnees.soldes.map((s) => (
              <tr key={s.typeId}>
                <th scope="row">{s.libelle}</th>
                <td className="nombre"><strong>{nombre(s.solde)} j</strong>{s.enAttente > 0 && <span className="aide"> dont {nombre(s.enAttente)} j en attente</span>}</td>
                <td>
                  {s.recalage ? `Recalé au ${s.recalage.dateEffet.split('-').reverse().join('/')} : ${nombre(s.recalage.joursRestants)} j` : `Report ${nombre(s.report)} j`}
                  {' '}+ acquis {nombre(s.acquis)} j − pris {nombre(s.pris)} j
                  <span className="aide"> · période du {s.periode.debut.split('-').reverse().join('/')} au {s.periode.fin.split('-').reverse().join('/')}</span>
                </td>
                {peutRecaler && (
                  <td>
                    <button className="bouton lien" type="button" onClick={() => setEdition({ typeId: s.typeId, dateEffet: aujourdhui(), jours: String(s.solde) })}>Corriger</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edition && (
        <form onSubmit={enregistrer} className="barre-outils">
          <div>
            <label htmlFor="rec-date">À la date du</label>
            <input id="rec-date" type="date" required value={edition.dateEffet} max={aujourdhui()} onChange={(e) => setEdition({ ...edition, dateEffet: e.target.value })} />
          </div>
          <div>
            <label htmlFor="rec-jours">il restait (jours à poser)</label>
            <input id="rec-jours" type="number" required step="0.5" min="-100" max="500" value={edition.jours} onChange={(e) => setEdition({ ...edition, jours: e.target.value })} />
          </div>
          <button className="bouton compact" type="submit" disabled={enCours}>Enregistrer</button>
          <button className="bouton secondaire compact" type="button" onClick={() => setEdition(null)}>Annuler</button>
          {erreur && <p className="message erreur" role="alert">{erreur}</p>}
          <p className="aide">Les absences posées après cette date sont déduites ; l'acquisition mensuelle reprend à partir de cette date. Chaque correction est conservée.</p>
        </form>
      )}
    </section>
  );
}
