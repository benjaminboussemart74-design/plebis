-- ============================================================
-- Plébis — Schéma Supabase
-- Référence : ce fichier documente le schéma appliqué via MCP.
-- Pour l'appliquer manuellement : coller dans l'éditeur SQL Supabase.
-- ============================================================

-- Extension trigram pour la recherche approximative
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Table parlementaires
CREATE TABLE IF NOT EXISTS parlementaires (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  prenom TEXT NOT NULL,
  chambre TEXT NOT NULL CHECK (chambre IN ('AN', 'Senat')),
  groupe_sigle TEXT,
  groupe_libelle TEXT,
  orientation TEXT CHECK (orientation IN ('gauche', 'centre', 'droite')),
  couleur_groupe TEXT,
  circonscription TEXT,
  photo_url TEXT
);

-- Table amendements (phase 1 : AN 17e législature uniquement)
CREATE TABLE IF NOT EXISTS amendements (
  id TEXT PRIMARY KEY,
  parlementaire_id TEXT REFERENCES parlementaires(id) ON DELETE CASCADE,
  titre TEXT,
  objet TEXT,
  expose_motifs TEXT,
  sort TEXT,
  date_depot DATE,
  legislature INT DEFAULT 17,
  texte_legis_ref TEXT,
  division_titre TEXT,
  texte_recherche TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('french',
      COALESCE(titre, '') || ' ' ||
      COALESCE(objet, '') || ' ' ||
      COALESCE(expose_motifs, '')
    )
  ) STORED
);

CREATE INDEX IF NOT EXISTS idx_amendements_fts
  ON amendements USING GIN(texte_recherche);

CREATE INDEX IF NOT EXISTS idx_amendements_trgm_objet
  ON amendements USING GIN(objet gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_amendements_parlementaire
  ON amendements(parlementaire_id);

CREATE INDEX IF NOT EXISTS idx_parlementaires_orientation
  ON parlementaires(orientation);

CREATE INDEX IF NOT EXISTS idx_parlementaires_chambre
  ON parlementaires(chambre);

-- Fonction utilitaire : vide toutes les tables (appelée depuis ingest.js via RPC)
CREATE OR REPLACE FUNCTION truncate_all()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  TRUNCATE TABLE amendements, parlementaires RESTART IDENTITY CASCADE;
END;
$$;

-- Fonction de recherche principale
CREATE OR REPLACE FUNCTION search_parlementaires(
  keywords TEXT[],
  orientation_filter TEXT DEFAULT NULL,
  chambre_filter TEXT DEFAULT NULL
)
RETURNS TABLE (
  id TEXT,
  nom TEXT,
  prenom TEXT,
  chambre TEXT,
  groupe_sigle TEXT,
  groupe_libelle TEXT,
  orientation TEXT,
  couleur_groupe TEXT,
  circonscription TEXT,
  photo_url TEXT,
  score BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    p.id,
    p.nom,
    p.prenom,
    p.chambre,
    p.groupe_sigle,
    p.groupe_libelle,
    p.orientation,
    p.couleur_groupe,
    p.circonscription,
    p.photo_url,
    COUNT(a.id) AS score
  FROM parlementaires p
  JOIN amendements a ON a.parlementaire_id = p.id
  WHERE
    (orientation_filter IS NULL OR p.orientation = orientation_filter)
    AND (chambre_filter IS NULL OR p.chambre = chambre_filter)
    AND (
      a.texte_recherche @@ (
        SELECT ts_query
        FROM (
          SELECT to_tsquery('french', string_agg(keyword, ' | '))
          FROM unnest(keywords) AS keyword
        ) sub(ts_query)
      )
      OR EXISTS (
        SELECT 1 FROM unnest(keywords) AS kw
        WHERE a.objet ILIKE '%' || kw || '%'
      )
    )
  GROUP BY p.id, p.nom, p.prenom, p.chambre, p.groupe_sigle,
           p.groupe_libelle, p.orientation, p.couleur_groupe,
           p.circonscription, p.photo_url
  ORDER BY score DESC
  LIMIT 50;
$$;
