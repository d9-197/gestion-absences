import { useEffect, useState } from 'react';
import { appeler } from '../../api.js';
import { useDonnees, useEnvoi } from '../../donnees.js';
import { formatDateHeure } from '../../format.js';
import Cadre from '../../composants/Cadre.jsx';

const ORIGINES = { automatique: 'Automatique', ligne_de_commande: 'Ligne de commande' };
const jour = (iso) => iso.split('-').reverse().join('/');
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;
const lignes = (n) => `${n} ${n > 1 ? "lignes" : "ligne"} d'historique`;

export default function Conservation() {
  const etat = useDonnees('/admin/conservation');
  const [saisie, setSaisie] = useState('');
  const [apercu, setApercu] = useState(null);
  const [info, setInfo] = useState('');
  const { enCours, erreur, envoyer } = useEnvoi();
  const donnees = etat.donnees;

  useEffect(() => { if (donnees && saisie === '') setSaisie(String(donnees.moisConservation)); }, [donnees, saisie]);

  const mois = Number(saisie);
  const valide = donnees && Number.isInteger(mois) && mois >= donnees.dureeMin && mois <= donnees.dureeMax;

  // L'effet de la durée saisie, mesuré par le serveur avant tout enregistrement.
  useEffect(() => {
    if (!valide) { setApercu(null); return undefined; }
    let abandonne = false;
    const delai = setTimeout(() => {
      appeler(`/admin/conservation/apercu?mois=${mois}`).then((r) => { if (!abandonne) setApercu(r); }).catch(() => { if (!abandonne) setApercu(null); });
    }, 300);
    return () => { abandonne = true; clearTimeout(delai); };
  }, [mois, valide]);

  if (!donnees) {
    return <Cadre><p className={etat.erreur ? 'message erreur' : 'chargement'}>{etat.erreur || 'Chargement…'}</p></Cadre>;
  }

  const inchangee = mois === donnees.moisConservation;
  const aSupprimer = apercu?.demandesAPurger ?? 0;

  async function enregistrer(evenement) {
    evenement.preventDefault();
    setInfo('');
    if (aSupprimer > 0 && !window.confirm(
      `Avec ${mois} mois, ${pluriel(aSupprimer, 'demande')} (${lignes(apercu.evenementsAPurger)}) `
      + `seront supprimées définitivement à la prochaine purge automatique, cette nuit après 3 h. Cette action est irréversible. Confirmer ?`,
    )) return;
    const reussi = await envoyer(() => appeler('/admin/conservation', { methode: 'PUT', corps: { moisConservation: mois } }));
    if (reussi) {
      setInfo(`Durée enregistrée : ${mois} mois.${aSupprimer > 0 ? ' Les demandes concernées seront supprimées à la prochaine purge automatique.' : ''}`);
      etat.recharger();
    }
  }

  return (
    <Cadre>
      <div className="entete-page"><h1>Conservation des demandes</h1></div>
      {info && <p className="message succes" role="status">{info}</p>}
      {etat.erreur && <p className="message erreur" role="alert">{etat.erreur}</p>}

      <section aria-labelledby="titre-duree">
        <h2 id="titre-duree">Durée de conservation</h2>
        <p>
          Chaque nuit après 3 h, les demandes <strong>terminées depuis plus de {donnees.moisConservation} mois</strong>, soit
          avant le {jour(donnees.dateLimite)}, sont <strong>supprimées définitivement</strong>, avec leur historique.
          Les PDF déjà envoyés par e-mail ne sont pas concernés.
        </p>
        <p className="aide">
          {donnees.demandesAPurger === 0
            ? "Aucune demande n'est concernée aujourd'hui."
            : `Aujourd'hui, ${pluriel(donnees.demandesAPurger, 'demande')} (${lignes(donnees.evenementsAPurger)}) ${donnees.demandesAPurger > 1 ? 'seront supprimées' : 'sera supprimée'} à la prochaine purge.`}
        </p>

        <form onSubmit={enregistrer} className="formulaire-large">
          {erreur && <p className="message erreur" role="alert">{erreur}</p>}
          <label htmlFor="duree">Durée de conservation, en mois</label>
          <input id="duree" type="number" required min={donnees.dureeMin} max={donnees.dureeMax} step="1" inputMode="numeric"
            value={saisie} onChange={(e) => { setSaisie(e.target.value); setInfo(''); }} aria-describedby="aide-duree" />
          <p id="aide-duree" className="aide">
            De {donnees.dureeMin} à {donnees.dureeMax} mois. Cette durée limite aussi la saisie : une demande ne peut pas
            porter sur une période plus ancienne.
          </p>

          <div aria-live="polite" className="apercu">
            {valide && !inchangee && apercu && (
              aSupprimer > 0 ? (
                <p className="message alerte">
                  Avec {mois} mois, les demandes terminées avant le {jour(apercu.dateLimite)} seraient supprimées :
                  {' '}<strong>{pluriel(aSupprimer, 'demande')}</strong> ({lignes(apercu.evenementsAPurger)}),
                  à la prochaine purge automatique. <strong>Suppression irréversible.</strong>
                </p>
              ) : (
                <p className="aide">Avec {mois} mois, aucune demande supplémentaire ne serait supprimée.</p>
              )
            )}
          </div>

          <div className="actions">
            <button className="bouton" type="submit" disabled={enCours || !valide || inchangee}>
              {enCours ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </section>

      <section aria-labelledby="titre-purges" className="section-suivante">
        <h2 id="titre-purges">Dernières purges</h2>
        <div className="tableau-defilant">
          <table>
            <thead>
              <tr><th>Exécutée le</th><th>Terminées avant le</th><th className="nombre">Demandes</th><th className="nombre">Historique</th><th>Origine</th></tr>
            </thead>
            <tbody>
              {donnees.dernieresPurges.map((p) => (
                <tr key={p.id}>
                  <td>{formatDateHeure(p.executeeLe)}</td>
                  <td>{jour(p.avant)}</td>
                  <td className="nombre">{p.demandesSupprimees}</td>
                  <td className="nombre">{p.evenementsSupprimes}</td>
                  <td>{ORIGINES[p.origine]}</td>
                </tr>
              ))}
              {donnees.dernieresPurges.length === 0 && <tr><td colSpan={5} className="vide">Aucune purge pour l'instant.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </Cadre>
  );
}
