import { useState } from 'react';
import { enregistrerFichier, telecharger } from '../api.js';
import { useDonnees, useEnvoi } from '../donnees.js';
import { joursDuMois, moisCourant } from '../dates.js';
import { STATUTS, nomComplet } from '../format.js';
import Cadre from '../composants/Cadre.jsx';

const STATUTS_PAR_DEFAUT = ['approuvee', 'enregistree']; // les absences valables

export default function Export() {
  const options = useDonnees('/export/options');
  const [champs, setChamps] = useState(() => {
    const jours = joursDuMois(moisCourant().annee, moisCourant().mois);
    return { debut: jours[0], fin: jours[jours.length - 1], equipeId: '', collaborateurId: '', typeId: '', format: 'xlsx' };
  });
  const [statuts, setStatuts] = useState(new Set(STATUTS_PAR_DEFAUT));
  const [info, setInfo] = useState('');
  const { enCours, erreur, envoyer } = useEnvoi();

  if (!options.donnees) {
    return <Cadre><p className={options.erreur ? 'message erreur' : 'chargement'}>{options.erreur || 'Chargement…'}</p></Cadre>;
  }

  const modifier = (champ) => (e) => setChamps({ ...champs, [champ]: e.target.value });
  const basculer = (statut) => {
    const suivants = new Set(statuts);
    if (suivants.has(statut)) suivants.delete(statut); else suivants.add(statut);
    setStatuts(suivants);
  };

  async function soumettre(evenement) {
    evenement.preventDefault();
    setInfo('');
    const parametres = new URLSearchParams({
      debut: champs.debut, fin: champs.fin, format: champs.format, statut: [...statuts].join(','),
    });
    for (const cle of ['equipeId', 'collaborateurId', 'typeId']) if (champs[cle]) parametres.set(cle, champs[cle]);

    await envoyer(async () => {
      const fichier = await telecharger(`/export/absences?${parametres}`);
      if (fichier.lignes === 0) {
        setInfo('Aucune absence ne correspond à ces critères : aucun fichier n\'a été téléchargé.');
        return;
      }
      enregistrerFichier(fichier);
      setInfo(`${fichier.lignes} ligne${fichier.lignes > 1 ? 's' : ''} exportée${fichier.lignes > 1 ? 's' : ''} dans ${fichier.nom}.`);
    });
  }

  return (
    <Cadre>
      <div className="entete-page"><h1>Export des absences</h1></div>
      {info && <p className="message succes" role="status">{info}</p>}
      {erreur && <p className="message erreur" role="alert">{erreur}</p>}

      <form onSubmit={soumettre} className="formulaire-large">
        <p className="aide">
          Le fichier liste les absences qui touchent la période, parmi celles que vous avez le droit de voir.
          Il contient des données personnelles, dont les absences pour maladie : conservez-le avec précaution.
        </p>
        <div className="ligne-champs">
          <div>
            <label htmlFor="x-debut">Du</label>
            <input id="x-debut" type="date" required value={champs.debut} onChange={modifier('debut')} />
          </div>
          <div>
            <label htmlFor="x-fin">Au</label>
            <input id="x-fin" type="date" required min={champs.debut} value={champs.fin} onChange={modifier('fin')} />
          </div>
        </div>

        <label htmlFor="x-equipe">Équipe</label>
        <select id="x-equipe" value={champs.equipeId} onChange={modifier('equipeId')}>
          <option value="">Toutes les équipes</option>
          {options.donnees.equipes.map((e) => <option key={e.id} value={e.id}>{e.nom}</option>)}
        </select>
        <label htmlFor="x-collaborateur">Collaborateur</label>
        <select id="x-collaborateur" value={champs.collaborateurId} onChange={modifier('collaborateurId')}>
          <option value="">Tous les collaborateurs</option>
          {options.donnees.collaborateurs.map((c) => (
            <option key={c.id} value={c.id}>{nomComplet(c)}{c.actif ? '' : ' (désactivé)'}</option>
          ))}
        </select>
        <label htmlFor="x-type">Type d'absence</label>
        <select id="x-type" value={champs.typeId} onChange={modifier('typeId')}>
          <option value="">Tous les types</option>
          {options.donnees.types.map((t) => <option key={t.id} value={t.id}>{t.libelle}{t.actif ? '' : ' (désactivé)'}</option>)}
        </select>

        <fieldset>
          <legend>Statuts</legend>
          {Object.entries(STATUTS).map(([valeur, libelle]) => (
            <label className="case" key={valeur}>
              <input type="checkbox" checked={statuts.has(valeur)} onChange={() => basculer(valeur)} />
              {libelle}
            </label>
          ))}
          <p className="aide">Par défaut : les absences valables, approuvées ou enregistrées.</p>
        </fieldset>

        <fieldset>
          <legend>Format</legend>
          <label className="case">
            <input type="radio" name="format" value="xlsx" checked={champs.format === 'xlsx'} onChange={modifier('format')} />
            Excel (.xlsx)
          </label>
          <label className="case">
            <input type="radio" name="format" value="csv" checked={champs.format === 'csv'} onChange={modifier('format')} />
            CSV (séparateur point-virgule, UTF-8, ouvrable directement avec Excel)
          </label>
        </fieldset>

        <div className="actions">
          <button className="bouton" type="submit" disabled={enCours || statuts.size === 0}>
            {enCours ? 'Préparation…' : 'Télécharger'}
          </button>
        </div>
        {statuts.size === 0 && <p className="aide">Choisissez au moins un statut.</p>}
      </form>
    </Cadre>
  );
}
