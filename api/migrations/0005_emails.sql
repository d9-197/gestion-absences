-- Up Migration

-- File d'envoi : chaque e-mail est enregistré dans la même transaction que l'événement qui le provoque,
-- puis envoyé en arrière-plan. Une panne du serveur d'e-mail ne bloque donc jamais une demande,
-- et aucun e-mail n'est perdu.
ALTER TABLE envois_email
  ADD COLUMN modele text NOT NULL DEFAULT 'decision' CHECK (modele IN ('a_traiter', 'declaration', 'decision')),
  ADD COLUMN prochaine_tentative timestamptz NOT NULL DEFAULT now();
ALTER TABLE envois_email ALTER COLUMN modele DROP DEFAULT;

-- Un même événement n'envoie qu'un e-mail par destinataire.
CREATE UNIQUE INDEX envois_email_evenement_destinataire
  ON envois_email (evenement_id, lower(destinataire)) WHERE evenement_id IS NOT NULL;

-- Personnes à prévenir quand une demande attend une décision : les valideurs du niveau le plus proche
-- (responsable et délégués de l'équipe du collaborateur ; à défaut ceux de l'équipe parente, et ainsi de suite),
-- à défaut les directeurs. Mêmes règles d'exclusion que valideurs_de : jamais le collaborateur lui-même,
-- et le responsable d'une équipe n'est pas validé par sa propre équipe.
CREATE FUNCTION valideurs_proches_de(p_collaborateur bigint) RETURNS SETOF bigint
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE cible AS (
    SELECT equipe_id FROM collaborateurs WHERE id = p_collaborateur
  ),
  chaine AS (
    SELECT e.id, e.parent_id, e.responsable_id, 0 AS niveau
    FROM equipes e JOIN cible ON e.id = cible.equipe_id
    UNION ALL
    SELECT p.id, p.parent_id, p.responsable_id, ch.niveau + 1
    FROM equipes p JOIN chaine ch ON p.id = ch.parent_id
  ),
  concernees AS (
    SELECT id, responsable_id, niveau FROM chaine
    WHERE responsable_id IS DISTINCT FROM p_collaborateur
  ),
  candidats AS (
    SELECT c.niveau, p.id
    FROM concernees c JOIN collaborateurs p ON p.id = c.responsable_id
    WHERE p.actif AND p.role IN ('responsable', 'directeur') AND p.id <> p_collaborateur
    UNION
    SELECT c.niveau, p.id
    FROM concernees c
      JOIN delegations d ON d.equipe_id = c.id
      JOIN collaborateurs p ON p.id = d.delegue_id
    WHERE p.actif AND p.role IN ('responsable', 'directeur') AND p.id <> p_collaborateur
  )
  SELECT id FROM candidats WHERE niveau = (SELECT min(niveau) FROM candidats)
  UNION
  SELECT p.id FROM collaborateurs p
  WHERE p.actif AND p.role = 'directeur' AND p.id <> p_collaborateur
    AND NOT EXISTS (SELECT 1 FROM candidats)
$$;

-- Down Migration

DROP FUNCTION valideurs_proches_de(bigint);
DROP INDEX envois_email_evenement_destinataire;
ALTER TABLE envois_email DROP COLUMN prochaine_tentative, DROP COLUMN modele;
