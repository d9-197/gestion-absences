import pg from 'pg';

// Les colonnes DATE sont lues comme du texte « AAAA-MM-JJ ».
// Par défaut, pg les convertit en objets Date à minuit heure locale, ce qui décale le jour selon le fuseau.
pg.types.setTypeParser(pg.types.builtins.DATE, (valeur) => valeur);

export default pg;
