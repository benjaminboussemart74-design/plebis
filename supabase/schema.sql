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

-- Table questions_ecrites (phase 2 : AN 17e législature)
CREATE TABLE IF NOT EXISTS questions_ecrites (
  id TEXT PRIMARY KEY,
  parlementaire_id TEXT REFERENCES parlementaires(id) ON DELETE CASCADE,
  rubrique TEXT,
  tete_analyse TEXT,
  texte_question TEXT,
  ministere TEXT,
  date_depot DATE,
  legislature INT DEFAULT 17,
  texte_recherche TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('french',
      COALESCE(rubrique, '') || ' ' ||
      COALESCE(tete_analyse, '') || ' ' ||
      COALESCE(texte_question, '')
    )
  ) STORED
);

CREATE INDEX IF NOT EXISTS idx_questions_fts
  ON questions_ecrites USING GIN(texte_recherche);

CREATE INDEX IF NOT EXISTS idx_questions_trgm_rubrique
  ON questions_ecrites USING GIN(rubrique gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_questions_parlementaire
  ON questions_ecrites(parlementaire_id);

-- Table interventions (comptes rendus de séance, phase 2 : AN 17e législature)
CREATE TABLE IF NOT EXISTS interventions (
  id TEXT PRIMARY KEY,
  parlementaire_id TEXT NOT NULL REFERENCES parlementaires(id) ON DELETE CASCADE,
  date_seance DATE,
  point_titre TEXT,
  texte TEXT,
  texte_recherche TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('french', coalesce(texte, ''))
  ) STORED
);

CREATE INDEX IF NOT EXISTS idx_interventions_fts
  ON interventions USING GIN(texte_recherche);

CREATE INDEX IF NOT EXISTS idx_interventions_parlementaire
  ON interventions(parlementaire_id);

-- Fonction utilitaire : vide toutes les tables (appelée depuis ingest.js via RPC)
CREATE OR REPLACE FUNCTION truncate_all()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  TRUNCATE TABLE interventions, questions_ecrites, amendements, parlementaires RESTART IDENTITY CASCADE;
END;
$$;

-- Fonction de recherche principale (score = amendements + questions écrites + interventions)
-- SECURITY DEFINER + SET statement_timeout : contourne le timeout de la clé anon (3-8s)
-- Résultats exhaustifs : aucun LIMIT sur les scans FTS, scan complet des 3 tables
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
  score BIGINT,
  amendements_count BIGINT,
  questions_count BIGINT,
  interventions_count BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET statement_timeout TO '30s'
SET max_parallel_workers_per_gather TO '2'
AS $$
  WITH ts AS (
    SELECT string_agg(plainto_tsquery('french', kw)::text, ' | ')::tsquery AS ts_query
    FROM unnest(keywords) AS kw
    WHERE trim(kw) != ''
  ),
  scores_amend AS (
    SELECT a.parlementaire_id, COUNT(a.id) AS cnt
    FROM amendements a, ts
    WHERE a.texte_recherche @@ ts.ts_query
    GROUP BY a.parlementaire_id
  ),
  scores_questions AS (
    SELECT q.parlementaire_id, COUNT(q.id) AS cnt
    FROM questions_ecrites q, ts
    WHERE q.texte_recherche @@ ts.ts_query
    GROUP BY q.parlementaire_id
  ),
  scores_interventions AS (
    SELECT i.parlementaire_id, COUNT(i.id) AS cnt
    FROM interventions i, ts
    WHERE i.texte_recherche @@ ts.ts_query
    GROUP BY i.parlementaire_id
  )
  SELECT
    p.id, p.nom, p.prenom, p.chambre, p.groupe_sigle, p.groupe_libelle,
    p.orientation, p.couleur_groupe, p.circonscription, p.photo_url,
    COALESCE(sa.cnt, 0) + COALESCE(sq.cnt, 0) + COALESCE(si.cnt, 0) AS score,
    COALESCE(sa.cnt, 0) AS amendements_count,
    COALESCE(sq.cnt, 0) AS questions_count,
    COALESCE(si.cnt, 0) AS interventions_count
  FROM parlementaires p
  LEFT JOIN scores_amend sa ON sa.parlementaire_id = p.id
  LEFT JOIN scores_questions sq ON sq.parlementaire_id = p.id
  LEFT JOIN scores_interventions si ON si.parlementaire_id = p.id
  WHERE
    (COALESCE(sa.cnt, 0) + COALESCE(sq.cnt, 0) + COALESCE(si.cnt, 0)) > 0
    AND (orientation_filter IS NULL OR p.orientation = orientation_filter)
    AND (chambre_filter IS NULL OR p.chambre = chambre_filter)
  ORDER BY score DESC
  LIMIT 50;
$$;
