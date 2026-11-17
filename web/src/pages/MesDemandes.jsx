import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useDonnees } from '../donnees.js';
import { formatDuree, formatPeriode } from '../format.js';
import Cadre from '../composants/Cadre.jsx';
import DetailDemande from '../composants/DetailDemande.jsx';
import FormulaireDemande from '../composants/FormulaireDemande.jsx';
import Statut from '../composants/Statut.jsx';

export default function MesDemandes() {
  const demandes = useDonnees('/demandes?portee=mes');
  const [parametres, setParametres] = useSearchParams();
  const [nouvelle, setNouvelle] = useState(parametres.get('nouvelle') === '1');
  const [detail, setDetail] = useState(null);
  const [info, setInfo] = useState('');

  if (!demandes.donnees) {
    return <Cadre><p className={demandes.erreur ? 'message erreur' : 'chargement'}>{demandes.erreur || 'Chargement…'}</p></Cadre>;
  }

  const fermerNouvelle = () => { setNouvelle(false); if (parametres.has('nouvelle')) setParametres({}, { replace: true }); };

  return (
    <Cadre>
      <div className="entete-page">
        <h1>Mes demandes</h1>
        <button className="bouton compact" type="button" onClick={() => setNouvelle(true)}>Nouvelle demande</button>
      </div>
      {info && <p className="message succes" role="status">{info}</p>}
      <div className="tableau-defilant">
        <table>
          <thead>
            <tr><th>Période</th><th>Type</th><th>Durée</th><th>Statut</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {demandes.donnees.map((d) => (
              <tr key={d.id} className={['refusee', 'retiree', 'annulee'].includes(d.statut) ? 'inactif' : undefined}>
                <td>{formatPeriode(d)}</td>
                <td>
                  {d.nature === 'annulation' && <span className="pastille">Annulation</span>} {d.type.libelle}
                </td>
                <td>{formatDuree(d.dureeDemiJournees)}</td>
                <td><Statut statut={d.statut} /></td>
                <td className="actions-ligne">
                  <button className="bouton lien" type="button" onClick={() => setDetail(d.id)}
                    aria-label={`Détail de la demande du ${d.dateDebut}`}>Détail</button>
                </td>
              </tr>
            ))}
            {demandes.donnees.length === 0 && (
              <tr><td colSpan={5} className="vide">Aucune demande. Utilisez « Nouvelle demande » pour en créer une.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {nouvelle && (
        <FormulaireDemande
          onFermer={fermerNouvelle}
          onEnregistre={(message) => { fermerNouvelle(); setInfo(message); demandes.recharger(); }}
        />
      )}
      {detail && (
        <DetailDemande
          id={detail}
          onFermer={() => setDetail(null)}
          onChange={(message) => { setDetail(null); setInfo(message); demandes.recharger(); }}
        />
      )}
    </Cadre>
  );
}
