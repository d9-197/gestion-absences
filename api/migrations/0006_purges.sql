-- Up Migration

-- Journal des purges : une ligne par exécution, avec ce qui a été supprimé. On n'y fait qu'ajouter.
-- C'est la trace de la seule suppression prévue dans l'outil.
CREATE TABLE purges (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  jour                  date NOT NULL,
  executee_le           timestamptz NOT NULL DEFAULT now(),
  -- Les demandes terminées avant cette date ont été supprimées.
  avant                 date NOT NULL,
  demandes_supprimees   integer NOT NULL CHECK (demandes_supprimees >= 0),
  evenements_supprimes  integer NOT NULL CHECK (evenements_supprimes >= 0),
  origine               text NOT NULL CHECK (origine IN ('automatique', 'ligne_de_commande'))
);
-- Une seule purge automatique par jour, même avec plusieurs processus.
CREATE UNIQUE INDEX purges_automatique_jour ON purges (jour) WHERE origine = 'automatique';

CREATE TRIGGER purges_inalterables
  BEFORE UPDATE OR DELETE ON purges
  FOR EACH ROW EXECUTE FUNCTION refuser_modification();
CREATE TRIGGER purges_sans_troncature
  BEFORE TRUNCATE ON purges
  FOR EACH STATEMENT EXECUTE FUNCTION refuser_modification();

GRANT SELECT, INSERT ON purges TO absences_api;

-- Down Migration

DROP TABLE purges;
