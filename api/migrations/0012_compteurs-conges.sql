-- Up Migration

-- Compteurs de congés, à titre INDICATIF (les bulletins de paie font foi). Activables par type d'absence et
-- désactivables globalement (paramètre « compteurs_actifs »).
ALTER TABLE types_absence
  ADD COLUMN compteur_actif        boolean NOT NULL DEFAULT false,
  -- Droit annuel par défaut, en jours ; NULL = pas de droit défini (pas de solde).
  ADD COLUMN dotation_annuelle     numeric(5,1) CHECK (dotation_annuelle >= 0 AND dotation_annuelle <= 400),
  -- Mois de début de la période de référence (1 = janvier, 6 = juin) ; elle commence le 1er de ce mois.
  ADD COLUMN debut_periode_mois    smallint NOT NULL DEFAULT 1 CHECK (debut_periode_mois BETWEEN 1 AND 12),
  -- Report automatique du reliquat en fin de période, ou report fixé à la main par un directeur.
  ADD COLUMN report_automatique    boolean NOT NULL DEFAULT true;

INSERT INTO parametres (cle, valeur) VALUES ('compteurs_actifs', 'false');

-- Les trois tables ci-dessous sont en ajout seul : on ne modifie rien, on ajoute une ligne qui remplace la précédente.

-- Droit annuel propre à un salarié (temps partiel, ancienneté…). jours NULL = retour à la valeur par défaut du type.
CREATE TABLE dotations_collaborateur (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  collaborateur_id  bigint NOT NULL REFERENCES collaborateurs (id),
  type_id           bigint NOT NULL REFERENCES types_absence (id),
  jours             numeric(5,1) CHECK (jours >= 0 AND jours <= 400),
  auteur_id         bigint NOT NULL REFERENCES collaborateurs (id),
  cree_le           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dotations_collaborateur_idx ON dotations_collaborateur (collaborateur_id, type_id, id DESC);

-- Recalage du solde : « à cette date, il me reste N jours à poser ». Les absences posées après cette date sont déduites.
CREATE TABLE recalages_solde (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  collaborateur_id  bigint NOT NULL REFERENCES collaborateurs (id),
  type_id           bigint NOT NULL REFERENCES types_absence (id),
  date_effet        date NOT NULL,
  jours_restants    numeric(6,1) NOT NULL CHECK (jours_restants BETWEEN -100 AND 500),
  auteur_id         bigint NOT NULL REFERENCES collaborateurs (id),
  cree_le           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recalages_solde_idx ON recalages_solde (collaborateur_id, type_id, date_effet DESC, id DESC);

-- Report fixé à la main (types à report non automatique) pour la période commençant à periode_debut.
CREATE TABLE reports_solde (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  collaborateur_id  bigint NOT NULL REFERENCES collaborateurs (id),
  type_id           bigint NOT NULL REFERENCES types_absence (id),
  periode_debut     date NOT NULL CHECK (extract(day FROM periode_debut) = 1),
  jours             numeric(6,1) NOT NULL CHECK (jours BETWEEN 0 AND 500),
  auteur_id         bigint NOT NULL REFERENCES collaborateurs (id),
  cree_le           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_solde_idx ON reports_solde (collaborateur_id, type_id, periode_debut, id DESC);

CREATE TRIGGER dotations_collaborateur_inalterables BEFORE UPDATE OR DELETE ON dotations_collaborateur
  FOR EACH ROW EXECUTE FUNCTION refuser_modification();
CREATE TRIGGER dotations_collaborateur_sans_troncature BEFORE TRUNCATE ON dotations_collaborateur
  FOR EACH STATEMENT EXECUTE FUNCTION refuser_modification();
CREATE TRIGGER recalages_solde_inalterables BEFORE UPDATE OR DELETE ON recalages_solde
  FOR EACH ROW EXECUTE FUNCTION refuser_modification();
CREATE TRIGGER recalages_solde_sans_troncature BEFORE TRUNCATE ON recalages_solde
  FOR EACH STATEMENT EXECUTE FUNCTION refuser_modification();
CREATE TRIGGER reports_solde_inalterables BEFORE UPDATE OR DELETE ON reports_solde
  FOR EACH ROW EXECUTE FUNCTION refuser_modification();
CREATE TRIGGER reports_solde_sans_troncature BEFORE TRUNCATE ON reports_solde
  FOR EACH STATEMENT EXECUTE FUNCTION refuser_modification();

GRANT SELECT, INSERT ON dotations_collaborateur, recalages_solde, reports_solde TO absences_api;

-- Down Migration

DROP TABLE reports_solde, recalages_solde, dotations_collaborateur;
DELETE FROM parametres WHERE cle = 'compteurs_actifs';
ALTER TABLE types_absence
  DROP COLUMN report_automatique, DROP COLUMN debut_periode_mois, DROP COLUMN dotation_annuelle, DROP COLUMN compteur_actif;
