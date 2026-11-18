import { useEffect } from 'react';
import { Link } from 'react-router';
import { useDonnees } from '../donnees.js';
import { jourCourt, nomComplet } from '../format.js';

const INITIALES = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const jourDeSemaine = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

// Bandeau de la direction, au-dessus du planning : qui est absent, ce qui traîne, ce qui est en panne.
export default function TableauDeBord() {
  const tableau = useDonnees('/admin/tableau-de-bord');
  const { recharger } = tableau;
  useEffect(() => {
    window.addEventListener('demandes-changees', recharger);
    return () => window.removeEventListener('demandes-changees', recharger);
  }, [recharger]);

  if (tableau.erreur) return <p className="message erreur" role="alert">{tableau.erreur}</p>;
  const t = tableau.donnees;
  if (!t) return null;
  const { absentsAujourdhui: absents, semaine, enAttente, emails, purge } = t;
  const nbAnciennes = enAttente.anciennes.length;

  return (
    <details className="tableau-de-bord" open>
      <summary>Vue d'ensemble de la direction</summary>
      <div className="cartes">
        <section aria-labelledby="tb-absents">
          <h2 id="tb-absents">Absents aujourd'hui</h2>
          {absents.length === 0 ? <p className="aide">Personne.</p> : (
            <ul className="liste-simple">
              {absents.map((a) => (
                <li key={a.id}>
                  {nomComplet(a)} <span className="sous-texte">{a.equipe} · {a.type}
                    {a.matin && !a.apresMidi ? ' · matin' : ''}{!a.matin && a.apresMidi ? ' · après-midi' : ''}
                    {a.statut === 'en_attente' ? ' · en attente' : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="tb-semaine">
          <h2 id="tb-semaine">Cette semaine</h2>
          <ol className="semaine">
            {semaine.map((j) => (
              <li key={j.jour} className={j.jour === t.jour ? 'aujourdhui' : j.travaille ? undefined : 'chome'}
                title={`${jourCourt(j.jour)} : ${j.travaille ? `${j.matin} absent(s) le matin, ${j.apresMidi} l'après-midi` : 'jour non travaillé'}`}>
                <span className="initiale">{INITIALES[jourDeSemaine(j.jour)]}</span>
                <span className="valeur">{j.travaille ? Math.max(j.matin, j.apresMidi) : '–'}</span>
                <span className="visuellement-cache">{jourCourt(j.jour)} : {j.travaille ? `${j.matin} absent(s) le matin, ${j.apresMidi} l'après-midi` : 'jour non travaillé'}</span>
              </li>
            ))}
          </ol>
          <p className="aide">Nombre de personnes absentes par jour.</p>
        </section>

        <section aria-labelledby="tb-attente">
          <h2 id="tb-attente">En attente</h2>
          <p>
            <strong>{enAttente.total}</strong> demande{enAttente.total > 1 ? 's' : ''} en attente
            {nbAnciennes > 0 && <>, dont <strong>{nbAnciennes}{nbAnciennes === 20 ? ' ou plus' : ''}</strong> depuis plus de {enAttente.seuilJours} jours</>}.
          </p>
          {nbAnciennes > 0 && (
            <ul className="liste-simple">
              {enAttente.anciennes.slice(0, 5).map((d) => <li key={d.id}>{nomComplet(d)} : {jourCourt(d.dateDebut)}</li>)}
            </ul>
          )}
          {enAttente.total > 0 && <p><Link to="/a-traiter">Voir les demandes à traiter</Link></p>}
        </section>

        <section aria-labelledby="tb-systeme">
          <h2 id="tb-systeme">Fonctionnement</h2>
          <p>
            {emails.echecs > 0
              ? <><strong>{emails.echecs}</strong> e-mail{emails.echecs > 1 ? 's' : ''} en échec. <Link to="/admin/emails">Voir</Link></>
              : 'Aucun e-mail en échec.'}
            {emails.enAttente > 0 && <> {emails.enAttente} en attente d'envoi.</>}
          </p>
          {purge && (
            <p>
              Prochaine purge cette nuit, après {purge.apresHeure} h : {purge.demandes} demande{purge.demandes > 1 ? 's' : ''} terminée{purge.demandes > 1 ? 's' : ''} avant le {jourCourt(purge.dateLimite)}
              {' '}(conservation : {purge.moisConservation} mois). <Link to="/admin/conservation">Régler</Link>
            </p>
          )}
        </section>
      </div>
    </details>
  );
}
