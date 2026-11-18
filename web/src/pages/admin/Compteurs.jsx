import { useEffect, useState } from 'react';
import { appeler } from '../../api.js';
import { useDonnees, useEnvoi } from '../../donnees.js';
import { nomComplet, nombre } from '../../format.js';
import Cadre from '../../composants/Cadre.jsx';

// Compteurs de congés : interrupteur global, et par type, le droit et le report de chaque salarié.
export default function Compteurs() {
  const general = useDonnees('/admin/compteurs');
  const [typeId, setTypeId] = useState(null);
  const [vue, setVue] = useState(null);
  const [erreurVue, setErreurVue] = useState('');
  const [info, setInfo] = useState('');
  const [version, setVersion] = useState(0);
  const { enCours, erreur, envoyer } = useEnvoi();

  const types = general.donnees?.types ?? [];
  useEffect(() => { if (typeId === null && types.length) setTypeId(types[0].id); }, [types, typeId]);
  useEffect(() => {
    if (typeId === null || !general.donnees?.actif) { setVue(null); return undefined; }
    let annule = false;
    setErreurVue('');
    appeler(`/admin/compteurs/type/${typeId}`).then((v) => { if (!annule) setVue(v); }).catch((e) => { if (!annule) setErreurVue(e.message); });
    return () => { annule = true; };
  }, [typeId, general.donnees?.actif, version]);

  if (!general.donnees) return <Cadre><p className={general.erreur ? 'message erreur' : 'chargement'}>{general.erreur || 'Chargement…'}</p></Cadre>;
  const { actif, mention } = general.donnees;
  const type = types.find((t) => t.id === typeId);

  const basculer = () => envoyer(async () => {
    setInfo('');
    await appeler('/admin/compteurs/actif', { methode: 'PUT', corps: { actif: !actif } });
    setInfo(actif ? 'Les compteurs sont désactivés : plus aucun solde ni avertissement.' : 'Les compteurs sont activés.');
    general.recharger();
  });
  const enregistrer = (chemin, corps, message) => envoyer(async () => {
    setInfo('');
    await appeler(`/admin/compteurs/${chemin}`, { methode: 'PUT', corps });
    setInfo(message);
    setVersion((v) => v + 1);
  });

  return (
    <Cadre>
      <div className="entete-page"><h1>Compteurs de congés</h1></div>
      <p className="message alerte">{mention} Les salariés peuvent recaler leur propre solde : il sert d'information, pas de contrôle.</p>
      {info && <p className="message succes" role="status">{info}</p>}
      {(erreur || erreurVue) && <p className="message erreur" role="alert">{erreur || erreurVue}</p>}
      <p>
        <strong>Compteurs {actif ? 'activés' : 'désactivés'}.</strong>{' '}
        <button className={`bouton compact${actif ? ' secondaire' : ''}`} type="button" disabled={enCours} onClick={basculer}>
          {actif ? 'Désactiver les compteurs' : 'Activer les compteurs'}
        </button>
      </p>
      <p className="aide">
        Le compteur s'active type par type dans « Types d'absence » (droit annuel, début de période, report). Désactivés, les soldes ne s'affichent plus nulle part
        et la saisie n'avertit plus ; les données saisies sont conservées.
      </p>
      {types.length === 0 && <p>Aucun type d'absence n'a de compteur. Activez-le dans « Types d'absence ».</p>}
      {actif && types.length > 0 && (
        <>
          <div className="barre-outils">
            <div>
              <label htmlFor="cpt-type">Type</label>
              <select id="cpt-type" value={typeId ?? ''} onChange={(e) => { setVue(null); setTypeId(Number(e.target.value)); }}>
                {types.map((t) => <option key={t.id} value={t.id}>{t.libelle}</option>)}
              </select>
            </div>
          </div>
          {!vue && !erreurVue && <p className="chargement">Chargement…</p>}
          {vue && type && (
            <div className="tableau-defilant">
              <table>
                <caption className="visuellement-cache">Soldes {vue.libelle}</caption>
                <thead>
                  <tr>
                    <th>Salarié</th><th>Droit annuel</th><th>Report</th><th>Acquis</th><th>Pris</th><th>Solde</th>
                  </tr>
                </thead>
                <tbody>
                  {vue.lignes.map((l) => (
                    <Ligne key={l.collaborateurId} ligne={l} type={type} enCours={enCours} enregistrer={enregistrer} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="aide">
            Droit annuel : valeur du type, sauf ajustement pour un salarié (temps partiel, ancienneté). Vide = valeur du type.
            {type && !type.reportAutomatique && ' Ce type ne reporte pas automatiquement : saisissez le report de chaque salarié pour la période en cours.'}
          </p>
        </>
      )}
    </Cadre>
  );
}

function Ligne({ ligne, type, enCours, enregistrer }) {
  const s = ligne.solde;
  const [droit, setDroit] = useState(s?.dotationPersonnelle ? String(s.dotation) : '');
  const [report, setReport] = useState(s ? String(s.report) : '0');
  const nom = nomComplet(ligne);
  if (!s) {
    return (
      <tr>
        <th scope="row">{nom}</th>
        <td colSpan={5}>
          <span className="aide">Pas de droit défini : </span>
          <input aria-label={`Droit annuel de ${nom}`} type="number" min="0" max="400" step="0.5" value={droit} onChange={(e) => setDroit(e.target.value)} className="champ-court" />
          <button className="bouton lien" type="button" disabled={enCours || droit === ''}
            onClick={() => enregistrer('dotation', { collaborateurId: ligne.collaborateurId, typeId: type.id, jours: Number(droit) }, `Droit de ${nom} enregistré.`)}>Définir</button>
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <th scope="row">{nom}</th>
      <td>
        <input aria-label={`Droit annuel de ${nom}`} type="number" min="0" max="400" step="0.5" placeholder={String(type.dotationAnnuelle ?? '')} value={droit}
          onChange={(e) => setDroit(e.target.value)} className="champ-court" />
        <button className="bouton lien" type="button" disabled={enCours || droit === (s.dotationPersonnelle ? String(s.dotation) : '')}
          onClick={() => enregistrer('dotation', { collaborateurId: ligne.collaborateurId, typeId: type.id, jours: droit === '' ? null : Number(droit) }, `Droit de ${nom} enregistré.`)}>OK</button>
      </td>
      <td>
        {type.reportAutomatique ? nombre(s.report) : (
          <>
            <input aria-label={`Report de ${nom}`} type="number" min="0" max="500" step="0.5" value={report} onChange={(e) => setReport(e.target.value)} className="champ-court" />
            <button className="bouton lien" type="button" disabled={enCours || Number(report) === s.report}
              onClick={() => enregistrer('report', { collaborateurId: ligne.collaborateurId, typeId: type.id, jours: Number(report) }, `Report de ${nom} enregistré.`)}>OK</button>
          </>
        )}
      </td>
      <td className="nombre">{nombre(s.acquis)}</td>
      <td className="nombre">{nombre(s.pris)}{s.enAttente > 0 && <span className="aide"> (+{nombre(s.enAttente)} en attente)</span>}</td>
      <td className="nombre"><strong>{nombre(s.solde)}</strong>{s.recalage && <span className="aide"> recalé</span>}</td>
    </tr>
  );
}
