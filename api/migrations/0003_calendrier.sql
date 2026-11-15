-- Up Migration

-- Années dont les jours fériés légaux ont déjà été préremplis.
-- Sans ce suivi, un jour férié supprimé par un directeur (journée de solidarité, par exemple)
-- serait recréé au préremplissage suivant.
CREATE TABLE annees_calendrier (
  annee          integer PRIMARY KEY CHECK (annee BETWEEN 2000 AND 2100),
  preremplie_le  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON annees_calendrier TO absences_api;

-- Down Migration

DROP TABLE annees_calendrier;
