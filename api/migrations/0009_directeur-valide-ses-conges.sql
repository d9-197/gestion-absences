-- Up Migration

-- Un directeur peut valider ses propres demandes (il n'a personne au-dessus de lui, et il est parfois le seul directeur).
-- Les responsables, eux, ne se valident toujours pas eux-mêmes.
-- Pour les notifications, les autres directeurs sont prévenus en priorité ; le demandeur ne l'est que s'il est le seul.
CREATE OR REPLACE FUNCTION valideurs_de(p_collaborateur bigint) RETURNS SETOF bigint
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE cible AS (
    SELECT equipe_id FROM collaborateurs WHERE id = p_collaborateur
  ),
  chaine AS (
    SELECT e.id, e.parent_id, e.responsable_id
    FROM equipes e JOIN cible ON e.id = cible.equipe_id
    UNION ALL
    SELECT p.id, p.parent_id, p.responsable_id
    FROM equipes p JOIN chaine ON p.id = chaine.parent_id
  ),
  concernees AS (
    SELECT id, responsable_id FROM chaine
    WHERE responsable_id IS DISTINCT FROM p_collaborateur
  )
  SELECT p.id FROM collaborateurs p
  WHERE p.actif
    AND p.role IN ('responsable', 'directeur')
    AND (p.id <> p_collaborateur OR p.role = 'directeur')
    AND (
      p.role = 'directeur'
      OR p.id IN (SELECT responsable_id FROM concernees WHERE responsable_id IS NOT NULL)
      OR p.id IN (SELECT d.delegue_id FROM delegations d JOIN concernees c ON c.id = d.equipe_id
                  WHERE delegation_active(d.date_debut, d.date_fin))
    )
$$;

CREATE OR REPLACE FUNCTION valideurs_proches_de(p_collaborateur bigint) RETURNS SETOF bigint
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
      JOIN delegations d ON d.equipe_id = c.id AND delegation_active(d.date_debut, d.date_fin)
      JOIN collaborateurs p ON p.id = d.delegue_id
    WHERE p.actif AND p.role IN ('responsable', 'directeur') AND p.id <> p_collaborateur
  )
  SELECT id FROM candidats WHERE niveau = (SELECT min(niveau) FROM candidats)
  UNION
  SELECT p.id FROM collaborateurs p
  WHERE p.actif AND p.role = 'directeur'
    AND NOT EXISTS (SELECT 1 FROM candidats)
    AND (p.id <> p_collaborateur OR NOT EXISTS (
      SELECT 1 FROM collaborateurs o WHERE o.actif AND o.role = 'directeur' AND o.id <> p_collaborateur))
$$;

-- Down Migration

CREATE OR REPLACE FUNCTION valideurs_de(p_collaborateur bigint) RETURNS SETOF bigint
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE cible AS (
    SELECT equipe_id FROM collaborateurs WHERE id = p_collaborateur
  ),
  chaine AS (
    SELECT e.id, e.parent_id, e.responsable_id
    FROM equipes e JOIN cible ON e.id = cible.equipe_id
    UNION ALL
    SELECT p.id, p.parent_id, p.responsable_id
    FROM equipes p JOIN chaine ON p.id = chaine.parent_id
  ),
  concernees AS (
    SELECT id, responsable_id FROM chaine
    WHERE responsable_id IS DISTINCT FROM p_collaborateur
  )
  SELECT p.id FROM collaborateurs p
  WHERE p.actif
    AND p.role IN ('responsable', 'directeur')
    AND p.id <> p_collaborateur
    AND (
      p.role = 'directeur'
      OR p.id IN (SELECT responsable_id FROM concernees WHERE responsable_id IS NOT NULL)
      OR p.id IN (SELECT d.delegue_id FROM delegations d JOIN concernees c ON c.id = d.equipe_id
                  WHERE delegation_active(d.date_debut, d.date_fin))
    )
$$;

CREATE OR REPLACE FUNCTION valideurs_proches_de(p_collaborateur bigint) RETURNS SETOF bigint
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
      JOIN delegations d ON d.equipe_id = c.id AND delegation_active(d.date_debut, d.date_fin)
      JOIN collaborateurs p ON p.id = d.delegue_id
    WHERE p.actif AND p.role IN ('responsable', 'directeur') AND p.id <> p_collaborateur
  )
  SELECT id FROM candidats WHERE niveau = (SELECT min(niveau) FROM candidats)
  UNION
  SELECT p.id FROM collaborateurs p
  WHERE p.actif AND p.role = 'directeur' AND p.id <> p_collaborateur
    AND NOT EXISTS (SELECT 1 FROM candidats)
$$;
