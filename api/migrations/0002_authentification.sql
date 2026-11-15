-- Up Migration

-- Sessions ouvertes. Seule l'empreinte du jeton est stockée : une fuite de la base ne donne pas de session utilisable.
CREATE TABLE sessions (
  jeton_hash        text PRIMARY KEY,
  collaborateur_id  bigint NOT NULL REFERENCES collaborateurs (id) ON DELETE CASCADE,
  cree_le           timestamptz NOT NULL DEFAULT now(),
  expire_le         timestamptz NOT NULL
);
CREATE INDEX sessions_collaborateur_idx ON sessions (collaborateur_id);
CREATE INDEX sessions_expiration_idx ON sessions (expire_le);

-- Jetons à usage unique pour définir ou réinitialiser un mot de passe.
CREATE TABLE jetons_mot_de_passe (
  jeton_hash        text PRIMARY KEY,
  collaborateur_id  bigint NOT NULL REFERENCES collaborateurs (id) ON DELETE CASCADE,
  cree_le           timestamptz NOT NULL DEFAULT now(),
  expire_le         timestamptz NOT NULL,
  utilise_le        timestamptz
);
CREATE INDEX jetons_mot_de_passe_collaborateur_idx ON jetons_mot_de_passe (collaborateur_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON sessions, jetons_mot_de_passe TO absences_api;

-- Down Migration

DROP TABLE jetons_mot_de_passe, sessions;
