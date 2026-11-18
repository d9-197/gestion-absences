import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useATraiter, useDonnees } from '../donnees.js';
import { aujourdhui, estWeekEnd, initialeJour, joursDuMois, libelleMois, moisCourant, moisSuivant, numeroDemiJournee } from '../dates.js';
import { formatPeriode, jourCourt, nomComplet } from '../format.js';
import { useSession } from '../session.jsx';
import Cadre from '../composants/Cadre.jsx';
import TableauDeBord from '../composants/TableauDeBord.jsx';
import DetailDemande from '../composants/DetailDemande.jsx';
import FormulaireDemande, { initialePourModification } from '../composants/FormulaireDemande.jsx';

const NOMBRE_COULEURS = 8;
const STATUTS = { confirmee: 'Confirmée', en_attente: 'En attente' };

// Réglages mémorisés dans le navigateur, propres à chaque utilisateur : la vue et le filtre d'équipe.
const cleReglages = (id) => `absences:${id}:planning`;
function lireReglages(id) {
  try { return JSON.parse(window.localStorage.getItem(cleReglages(id))) ?? {}; } catch { return {}; }
}
function ecrireReglages(id, reglages) {
  try { window.localStorage.setItem(cleReglages(id), JSON.stringify(reglages)); } catch { /* stockage indisponible : on s'en passe */ }
}
const petitEcran = () => window.matchMedia?.('(max-width: 640px)').matches ?? false;
const indiceParDefaut = () => (window.matchMedia?.('(pointer: fine)').matches ?? true
  ? 'Cliquez sur un jour libre pour poser une absence à partir de cette date (glissez pour choisir aussi le dernier jour), ou utilisez « Nouvelle demande ».'
  : 'Touchez un jour libre pour poser une absence à partir de cette date, ou utilisez « Nouvelle demande ».');
const demiJournee = (creneau) => (creneau % 2 ? 'après-midi' : 'matin');

// Pour chaque demi-journée du mois, l'absence qui l'occupe (la confirmée l'emporte sur celle en attente).
function creneauxDe(personne, premier, nombre) {
  const creneaux = new Array(nombre).fill(null);
  const ordre = [...personne.absences].sort((a, b) => (a.statut === 'en_attente' ? 0 : 1) - (b.statut === 'en_attente' ? 0 : 1));
  for (const absence of ordre) {
    const debut = Math.max(numeroDemiJournee(absence.dateDebut, absence.debutDemiJournee) - premier, 0);
    const fin = Math.min(numeroDemiJournee(absence.dateFin, absence.finDemiJournee) - premier, nombre - 1);
    for (let i = debut; i <= fin; i++) creneaux[i] = absence;
  }
  return creneaux;
}

const classeCouleur = (absence, types) => {
  if (!absence.type) return 'type-cache';
  return `type-${Math.max(types.findIndex((t) => t.id === absence.type.id), 0) % NOMBRE_COULEURS}`;
};

export default function Planning() {
  const { utilisateur } = useSession();
  const [mois, setMois] = useState(moisCourant);
  // Sans choix mémorisé, un petit écran s'ouvre sur la liste, plus lisible que la grille.
  const [vue, setVue] = useState(() => lireReglages(utilisateur.id).vue ?? (petitEcran() ? 'liste' : 'calendrier'));
  const [equipe, setEquipe] = useState(() => lireReglages(utilisateur.id).equipe ?? '');
  const [detail, setDetail] = useState(null);
  const [nouvelle, setNouvelle] = useState(null); // formulaire de demande ouvert depuis le planning, avec ce qu'il pré-remplit
  const [modification, setModification] = useState(null); // demande en attente que l'on remplace
  const [info, setInfo] = useState('');

  const jours = useMemo(() => joursDuMois(mois.annee, mois.mois), [mois]);
  const debut = jours[0];
  const fin = jours[jours.length - 1];
  const planning = useDonnees(`/planning?debut=${debut}&fin=${fin}`);
  const aujourdhuiIso = aujourdhui();
  const defilement = useRef(null);
  const indice = useRef(null);
  const glisse = useRef(null); // balayage en cours : { ligne, personne, depart, courant } (numéros de demi-journée du mois)
  const finGlisse = useRef(0); // instant du dernier balayage, pour ignorer le clic qui le suit
  const donnees = planning.donnees?.debut === debut ? planning.donnees : null; // pas de données d'un autre mois

  const seul = utilisateur.role === 'collaborateur';
  const aTraiter = useATraiter(!seul);

  const choisirVue = (valeur) => { setVue(valeur); ecrireReglages(utilisateur.id, { ...lireReglages(utilisateur.id), vue: valeur }); };
  const choisirEquipe = (valeur) => { setEquipe(valeur); ecrireReglages(utilisateur.id, { ...lireReglages(utilisateur.id), equipe: valeur }); };
  // Un filtre mémorisé sur une équipe qu'on ne voit plus est ignoré, sans être effacé.
  const equipeActive = donnees && donnees.equipes.some((e) => String(e.id) === String(equipe)) ? equipe : '';

  // Ma ligne est toujours la première et ne dépend pas du filtre d'équipe, qui ne s'applique qu'aux autres.
  const { moi, autres } = useMemo(() => {
    if (!donnees) return { moi: null, autres: [] };
    const premier = numeroDemiJournee(debut, 'matin');
    const toutes = donnees.personnes.map((p) => ({ personne: p, creneaux: creneauxDe(p, premier, jours.length * 2) }));
    return {
      moi: toutes.find((l) => l.personne.id === utilisateur.id) ?? null,
      autres: toutes.filter((l) => l.personne.id !== utilisateur.id && (!equipeActive || l.personne.equipeId === Number(equipeActive))),
    };
  }, [donnees, equipeActive, debut, jours, utilisateur.id]);
  const personnesParId = useMemo(() => new Map((donnees?.personnes ?? []).map((p) => [p.id, p])), [donnees]);

  // Sur un petit écran, la grille s'ouvre sur aujourd'hui plutôt que sur le 1er du mois.
  useEffect(() => {
    const conteneur = defilement.current;
    if (!conteneur) return;
    const colonne = conteneur.querySelector('th.aujourdhui');
    conteneur.scrollLeft = colonne ? Math.max(0, colonne.offsetLeft - conteneur.clientWidth / 2) : 0;
  }, [donnees, vue]);

  // L'indication sous la grille change à chaque survol : on la met à jour directement, sans refaire toute la grille.
  useEffect(() => { if (indice.current) indice.current.textContent = indiceParDefaut(); }, [donnees, vue]);

  const titre = seul ? 'Mon planning' : 'Planning';
  const changerMois = (pas) => { setMois(moisSuivant(mois, pas)); setInfo(''); };

  // Un clic sur un jour libre ouvre le formulaire : ce jour (et cette demi-journée) est le départ de l'absence.
  const celluleLibre = (evenement) => evenement.target.closest?.('td[data-jour]');
  const poser = (evenement) => {
    if (Date.now() - finGlisse.current < 500) return; // le clic qui suit un balayage a déjà été traité
    const cellule = celluleLibre(evenement);
    if (!cellule) return;
    setInfo('');
    setNouvelle({
      collaborateurId: Number(cellule.dataset.personne),
      dateDebut: cellule.dataset.jour,
      debutDemiJournee: cellule.dataset.moitie === '1' ? 'apres_midi' : 'matin',
    });
  };
  const survoler = (evenement) => {
    if (!indice.current || glisse.current) return;
    const cellule = celluleLibre(evenement);
    if (!cellule) { indice.current.textContent = indiceParDefaut(); return; }
    const personne = personnesParId.get(Number(cellule.dataset.personne));
    const pour = personne && personne.id !== utilisateur.id ? ` pour ${nomComplet(personne)}` : '';
    indice.current.textContent = `Poser une absence${pour} à partir de ${jourCourt(cellule.dataset.jour)}, ${cellule.dataset.moitie === '1' ? 'après-midi' : 'matin'}`;
  };

  // Glisser sur une ligne choisit le début ET la fin : de la demi-journée d'appui à celle où l'on relâche.
  // Réservé à la souris : au doigt, glisser fait défiler la grille, et un appui suffit à ouvrir le formulaire.
  const periodeDe = (a, b) => {
    const [d, f] = a <= b ? [a, b] : [b, a];
    return { dateDebut: jours[Math.floor(d / 2)], debutDemiJournee: d % 2 ? 'apres_midi' : 'matin', dateFin: jours[Math.floor(f / 2)], finDemiJournee: f % 2 ? 'apres_midi' : 'matin' };
  };
  const surligner = (g) => {
    const [d, f] = g.depart <= g.courant ? [g.depart, g.courant] : [g.courant, g.depart];
    for (let i = 1; i < g.ligne.cells.length; i++) g.ligne.cells[i].classList.toggle('selection', i - 1 >= d && i - 1 <= f);
  };
  const terminerBalayage = () => {
    const g = glisse.current;
    glisse.current = null;
    if (!g) return;
    for (const cellule of g.ligne.cells) cellule.classList.remove('selection');
    if (indice.current) indice.current.textContent = indiceParDefaut();
    if (g.courant === g.depart) return; // un simple clic : traité par poser
    finGlisse.current = Date.now();
    setInfo('');
    setNouvelle({ collaborateurId: g.personne, ...periodeDe(g.depart, g.courant) });
  };
  const commencerBalayage = (evenement) => {
    if (evenement.button !== 0 || evenement.pointerType !== 'mouse') return;
    const cellule = celluleLibre(evenement);
    if (!cellule) return;
    const creneau = cellule.cellIndex - 1; // la première cellule de la ligne est le nom
    glisse.current = { ligne: cellule.parentElement, personne: Number(cellule.dataset.personne), depart: creneau, courant: creneau };
    window.addEventListener('pointerup', terminerBalayage, { once: true });
  };
  const balayer = (evenement) => {
    const g = glisse.current;
    const cellule = evenement.target.closest?.('td.cellule');
    if (!g || !cellule || cellule.parentElement !== g.ligne) return; // on reste sur la ligne de départ
    g.courant = cellule.cellIndex - 1;
    surligner(g);
    if (indice.current && g.courant !== g.depart) {
      const p = periodeDe(g.depart, g.courant);
      indice.current.textContent = `Du ${jourCourt(p.dateDebut)}, ${demiJournee(g.depart <= g.courant ? g.depart : g.courant)} au ${jourCourt(p.dateFin)}, ${demiJournee(g.depart <= g.courant ? g.courant : g.depart)} inclus`;
    }
  };

  function libelleAbsence(personne, absence, jour, moitie) {
    const type = absence.type ? absence.type.libelle : 'Absent';
    return `${nomComplet(personne)} : ${type}, ${jourCourt(jour)} ${moitie === 0 ? 'matin' : 'après-midi'}, ${STATUTS[absence.statut].toLowerCase()}`;
  }

  const ferie = new Map((donnees?.joursFeries ?? []).map((j) => [j.jour, j.libelle]));
  const nomEquipe = Object.fromEntries((donnees?.equipes ?? []).map((e) => [e.id, e.nom]));

  const ligne = ({ personne, creneaux }, estMoi) => {
    const imposes = new Map((donnees.imposesParEquipe[personne.equipeId] ?? []).map((j) => [j.jour, j.libelle]));
    const libre = personne.actif; // on ne pose pas d'absence pour une personne désactivée
    const classesLigne = [estMoi && 'ligne-moi', !personne.actif && 'inactif'].filter(Boolean).join(' ');
    return (
      <tr key={personne.id} className={classesLigne || undefined}>
        <th scope="row" className="nom" title={nomComplet(personne)}>
          {nomComplet(personne)}
          {estMoi && !seul && <span className="pastille">moi</span>}
          {!personne.actif && <span className="pastille">Désactivé</span>}
        </th>
        {jours.flatMap((jour, i) => [0, 1].map((moitie) => {
          const absence = creneaux[i * 2 + moitie];
          const classes = ['cellule', moitie === 0 ? 'debut-jour' : '',
            estWeekEnd(jour) ? 'we' : '', ferie.has(jour) ? 'ferie' : '', imposes.has(jour) ? 'impose' : '',
            jour === aujourdhuiIso ? 'aujourdhui' : '', !absence && libre ? 'libre' : ''].filter(Boolean).join(' ');
          const raison = ferie.get(jour) ?? imposes.get(jour);
          if (!absence) {
            return (
              <td key={`${jour}-${moitie}`} className={classes} title={raison}
                data-jour={libre ? jour : undefined} data-moitie={libre ? moitie : undefined} data-personne={libre ? personne.id : undefined} />
            );
          }
          const etiquette = libelleAbsence(personne, absence, jour, moitie);
          const apparence = `abs ${classeCouleur(absence, donnees.types)}${absence.statut === 'en_attente' ? ' attente' : ''}`;
          return (
            <td key={`${jour}-${moitie}`} className={classes}>
              {absence.demandeId ? (
                <button type="button" className={apparence} title={etiquette} aria-label={etiquette}
                  onClick={() => setDetail(absence.demandeId)} />
              ) : (
                <span className={apparence} title={etiquette} role="img" aria-label={etiquette} />
              )}
            </td>
          );
        }))}
      </tr>
    );
  };

  const grille = donnees && (
    <div className="planning-defilant" ref={defilement}>
      <table className="planning" onClick={poser} onMouseOver={survoler} onMouseLeave={survoler}
        onPointerDown={commencerBalayage} onPointerOver={balayer}>
        <caption className="visuellement-cache">{`${titre}, ${libelleMois(mois)}`}</caption>
        <thead>
          <tr>
            <th className="nom" scope="col"><span className="visuellement-cache">Collaborateur</span></th>
            {jours.map((jour) => (
              <th key={jour} colSpan={2} scope="col"
                className={`jour${estWeekEnd(jour) ? ' we' : ''}${ferie.has(jour) ? ' ferie' : ''}${jour === aujourdhuiIso ? ' aujourdhui' : ''}`}
                title={ferie.get(jour) ? `${jourCourt(jour)} : ${ferie.get(jour)}` : jourCourt(jour)}>
                <span className="jour-sem" aria-hidden="true">{initialeJour(jour)}</span>
                <span className="jour-num">{Number(jour.slice(8))}</span>
                {ferie.has(jour) && <span className="visuellement-cache"> (férié : {ferie.get(jour)})</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {moi && ligne(moi, true)}
          {autres.map((l, i) => [
            (i === 0 || autres[i - 1].personne.equipeId !== l.personne.equipeId) && (
              <tr key={`equipe-${l.personne.equipeId}-${l.personne.id}`} className="ligne-equipe">
                <th scope="row" className="nom nom-equipe">{nomEquipe[l.personne.equipeId]}</th>
                <td colSpan={jours.length * 2} />
              </tr>
            ),
            ligne(l, false),
          ])}
          {!moi && autres.length === 0 && <tr><td colSpan={jours.length * 2 + 1} className="vide">Aucun collaborateur à afficher.</td></tr>}
        </tbody>
      </table>
    </div>
  );

  // Vue en liste : les mêmes absences, sous forme de tableau.
  const toutes = [moi, ...autres].filter(Boolean);
  const liste = donnees && (
    <div className="tableau-defilant">
      <table>
        <thead><tr><th>Collaborateur</th><th>Type</th><th>Période</th><th>Statut</th><th>Actions</th></tr></thead>
        <tbody>
          {toutes.flatMap(({ personne }) => personne.absences.map((a, i) => (
            <tr key={`${personne.id}-${i}`}>
              <td>{nomComplet(personne)}{!seul && <span className="sous-texte">{nomEquipe[personne.equipeId]}</span>}</td>
              <td>{a.type ? a.type.libelle : 'Absent'}</td>
              <td>{formatPeriode(a)}</td>
              <td><span className={`statut ${a.statut === 'en_attente' ? 'statut-en_attente' : 'statut-approuvee'}`}>{STATUTS[a.statut]}</span></td>
              <td className="actions-ligne">
                {a.demandeId && (
                  <button className="bouton lien" type="button" onClick={() => setDetail(a.demandeId)}
                    aria-label={`Détail de l'absence de ${nomComplet(personne)} du ${a.dateDebut}`}>Détail</button>
                )}
              </td>
            </tr>
          )))}
          {toutes.every(({ personne }) => personne.absences.length === 0) && (
            <tr><td colSpan={5} className="vide">Aucune absence ce mois-ci.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <Cadre large>
      <div className="entete-page">
        <h1>{titre}</h1>
        <div className="navigation-mois">
          <button className="bouton secondaire compact" type="button" onClick={() => changerMois(-1)}
            aria-label={`Mois précédent, ${libelleMois(moisSuivant(mois, -1))}`}>←</button>
          <h2 aria-live="polite">{libelleMois(mois)}</h2>
          <button className="bouton secondaire compact" type="button" onClick={() => changerMois(1)}
            aria-label={`Mois suivant, ${libelleMois(moisSuivant(mois, 1))}`}>→</button>
          <button className="bouton secondaire compact" type="button" onClick={() => { setMois(moisCourant()); setInfo(''); }}>Aujourd'hui</button>
        </div>
      </div>

      {aTraiter > 0 && (
        <p className="message alerte">
          {aTraiter === 1 ? '1 demande attend' : `${aTraiter} demandes attendent`} votre décision.{' '}
          <Link to="/a-traiter">Les traiter</Link>
        </p>
      )}

      {utilisateur.role === 'directeur' && <TableauDeBord />}

      <div className="barre-planning">
        <button className="bouton compact" type="button" onClick={() => { setInfo(''); setNouvelle({}); }}>Nouvelle demande</button>
        {donnees && donnees.equipes.length > 1 && (
          <div>
            <label htmlFor="filtre-equipe" className="etiquette-filtre">Équipe</label>
            <select id="filtre-equipe" className="selecteur" value={equipeActive} onChange={(e) => choisirEquipe(e.target.value)}>
              <option value="">Toutes les équipes</option>
              {donnees.equipes.map((e) => <option key={e.id} value={e.id}>{e.nom}</option>)}
            </select>
          </div>
        )}
        <button className="bouton secondaire compact" type="button" onClick={() => window.print()}>Imprimer</button>
        <div className="choix-vue" role="group" aria-label="Affichage">
          {[['calendrier', 'Calendrier'], ['liste', 'Liste']].map(([valeur, libelle]) => (
            <button key={valeur} type="button" className={`bouton secondaire compact${vue === valeur ? ' actif' : ''}`}
              aria-pressed={vue === valeur} onClick={() => choisirVue(valeur)}>{libelle}</button>
          ))}
        </div>
      </div>

      {info && <p className="message succes" role="status">{info}</p>}
      {!donnees ? (
        <p className={planning.erreur ? 'message erreur' : 'chargement'}>{planning.erreur || 'Chargement…'}</p>
      ) : (
        <>
          {vue === 'calendrier' ? grille : liste}
          {vue === 'calendrier' && <p className="aide indice-planning" ref={indice} aria-hidden="true" />}
          <ul className="legende" aria-label="Légende">
            {donnees.types.map((t, i) => (
              <li key={t.id}><span className={`echantillon abs type-${i % NOMBRE_COULEURS}`} aria-hidden="true" /> {t.libelle}</li>
            ))}
            <li><span className="echantillon abs type-0 attente" aria-hidden="true" /> Demande en attente (hachurée)</li>
            <li><span className="echantillon cellule we" aria-hidden="true" /> Week-end</li>
            <li><span className="echantillon cellule ferie" aria-hidden="true" /> Jour férié</li>
            <li><span className="echantillon cellule impose" aria-hidden="true" /> Jour non travaillé imposé</li>
          </ul>
          <p className="impression-pied">
            Imprimé le {new Date().toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Paris' })} par {nomComplet(utilisateur)}.
          </p>
        </>
      )}

      {modification && (
        <FormulaireDemande
          remplace={modification.id}
          initiale={initialePourModification(modification)}
          onFermer={() => setModification(null)}
          onEnregistre={(message) => { setModification(null); setInfo(message); planning.recharger(); }}
        />
      )}
      {nouvelle && (
        <FormulaireDemande
          initiale={nouvelle}
          onFermer={() => setNouvelle(null)}
          onEnregistre={(message) => { setNouvelle(null); setInfo(message); planning.recharger(); }}
        />
      )}
      {detail && (
        <DetailDemande
          id={detail}
          onFermer={() => setDetail(null)}
          onChange={(message) => { setDetail(null); setInfo(message); planning.recharger(); }}
          onModifier={(demande) => { setDetail(null); setModification(demande); }}
        />
      )}
    </Cadre>
  );
}
