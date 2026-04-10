# Plébis — CLAUDE.md

## Charte graphique

**Référence obligatoire pour toute implémentation UI : [`DESIGN.md`](./DESIGN.md)**

Avant tout travail sur le frontend (composants, CSS, layout), lire `DESIGN.md`.
Il contient : typographie, palette, espacements, composants, et principes éditoriaux.

---

## Objectif

Moteur de recherche des parlementaires français actifs sur une thématique donnée.
L'utilisateur saisit un sujet → l'IA génère des mots-clés → Supabase retourne les parlementaires classés par activité (amendements + questions écrites + interventions en séance + dossiers législatifs, AN 17e législature).

---

## Dépôt GitHub

https://github.com/benjaminboussemart74-design/plebis

> Le fichier `.env` est exclu du dépôt (`.gitignore`). Ne jamais le committer.

---

## Stack technique

| Couche | Outil |
|---|---|
| Frontend | React + Vite (CSS Modules) |
| Base de données | Supabase (PostgreSQL, projet `mncyqaovonldvfzqmric`) |
| Recherche | `pg_trgm` + `tsvector` French FTS |
| IA (expansion requête) | Anthropic `claude-sonnet-4-20250514` via Edge Function |
| Déploiement | Vercel (frontend) + Supabase (BDD + Edge Function) |

---

## Structure des dossiers

```
parlsearch/
├── CLAUDE.md
├── DESIGN.md
├── src/
│   ├── components/
│   │   ├── Header.jsx / .module.css
│   │   ├── SearchBar.jsx / .module.css
│   │   ├── KeywordsDisplay.jsx / .module.css
│   │   ├── LandingHero.jsx / .module.css       ← page d'accueil : podiums top amendeurs/questionneurs/efficaces + suggestions
│   │   ├── ParlementaireCard.jsx / .module.css
│   │   ├── ResultsList.jsx / .module.css       ← résultats + DocView (vue documents inline tous parlementaires)
│   │   └── AmendementPanel.jsx / .module.css   ← panneau latéral par parlementaire (4 onglets)
│   ├── lib/
│   │   ├── supabase.js       (client Supabase)
│   │   ├── anthropic.js      (appel Edge Function expand-query)
│   │   ├── search.js         (orchestration recherche + scoring + fetch* 4 sources)
│   │   ├── panelUtils.jsx    (utilitaires partagés panel : hl, anUrl, amendNum, formatDate, fetchTexteMeta…)
│   │   └── groupeLogos.js    (mapping sigle → logo PNG importé)
│   ├── assets/
│   │   ├── hero.png
│   │   └── Logos/            (logos PNG des groupes parlementaires AN)
│   ├── styles/
│   │   └── variables.css     (tokens design + Playfair Display)
│   ├── App.jsx
│   └── main.jsx
├── supabase/
│   ├── schema.sql            (référence — tables appliquées via MCP)
│   └── functions/
│       ├── expand-query/
│       │   └── index.ts      (Edge Function : expansion IA de la requête)
│       └── an-proxy/
│           └── index.ts      (Edge Function : proxy CORS photos + opendata AN)
├── scripts/
│   ├── ingest.js             (ingestion députés + amendements + questions écrites)
│   ├── ingest-comptes-rendus.js  (ingestion séances syceron XML)
│   ├── ingest-dossiers.js    (ingestion dossiers législatifs AN — Dossiers_Legislatifs.json.zip)
│   ├── update-photos.js      (met à jour photo_url → nosdeputes.fr slugs)
│   ├── upload-photos.js      (télécharge photos + upload Supabase Storage)
│   └── inspect-xml.mjs       (outil diagnostic format XML syceron)
└── .env.example
```

---

## Sources de données

### Phase 1 (implémentée)
- **Députés en exercice AN 17e législature**
  - URL : `https://data.assemblee-nationale.fr/static/openData/repository/17/amo/deputes_actifs_mandats_actifs_organes/AMO10_deputes_actifs_mandats_actifs_organes.json.zip`
  - Format : ZIP de fichiers JSON individuels — `json/acteur/PA*.json` + `json/organe/PO*.json`
  - Champs utilisés : `acteur.uid["#text"]`, `etatCivil.ident`, mandats GP (`organes.organeRef` → organe `libelleAbrege`/`libelle`), mandat ASSEMBLEE (`election.lieu`)
  - Résultat : **577 députés** avec groupe politique, orientation, circonscription

- **Amendements AN 17e législature**
  - URL : `https://data.assemblee-nationale.fr/static/openData/repository/17/loi/amendements_div_legis/Amendements.json.zip`
  - Format : ZIP de fichiers JSON individuels (1 fichier = 1 amendement)
  - Champs utilisés : `uid`, `signataires.auteur.acteurRef`, `corps.contenuAuteur.dispositif` (objet), `corps.contenuAuteur.exposeSommaire` (exposé), `cycleDeVie.sort`, `cycleDeVie.dateDepot`, `texteLegislatifRef`, `pointeurFragmentTexte.division.titre`
  - Résultat : **99 583 amendements** liés aux 577 députés actifs

- **Titres des textes législatifs (live)**
  - Via Edge Function `an-proxy` : `?type=opendata&ref={texteRef}`
  - Utilisée côté frontend dans `AmendementPanel` pour afficher le titre du texte amendé
  - Cache en mémoire (Map) pour éviter les appels dupliqués

### Phase 2 (implémentée)
- **Questions écrites AN 17e législature**
  - URL : `https://data.assemblee-nationale.fr/static/openData/repository/17/questions/questions_ecrites/Questions_ecrites.json.zip`
  - Format : ZIP de fichiers JSON individuels
  - Champs : `uid`, `auteur.acteurRef`, `rubrique`, `titreGroupe` (tête d'analyse), `texteQuestion`, `ministereAttributaire`, `dateDepot`
  - Ingérées dans `ingest.js` (même script que les amendements)

- **Comptes rendus de séance AN 17e législature**
  - URL : `https://data.assemblee-nationale.fr/static/openData/repository/17/vp/syceronbrut/syseron.xml.zip`
  - Format : ZIP de fichiers XML individuels (un par séance), mis à jour quotidiennement
  - Structure : `compteRendu > metadonnees.dateSeance` + `contenu.point[].paragraphe[]` (attribut `@_id_acteur`)
  - Date format Syceron : `"20241106140000000"` → `"2024-11-06"`
  - Ingérés via `scripts/ingest-comptes-rendus.js` (script séparé)

### Phase 3 (implémentée)
- **Dossiers législatifs AN 17e législature**
  - URL : `https://data.assemblee-nationale.fr/static/openData/repository/17/loi/dossiers/Dossiers_Legislatifs.json.zip`
  - Format : ZIP de fichiers JSON individuels (1 fichier = 1 dossier)
  - Champs utilisés : `uid`, `titrePrincipal`, `procedureLibelle`, acteurs co-signataires/rapporteurs (`acteurs.acteur[].acteurRef`)
  - Ingéré via `scripts/ingest-dossiers.js`
  - Table : `dossiers_legislatifs`

### Phase 4 (à venir)
- Données Sénat

---

## Schéma Supabase

### Tables

**`parlementaires`** : id, nom, prenom, chambre (AN|Senat), groupe_sigle, groupe_libelle, orientation (gauche|centre|droite), couleur_groupe, circonscription, photo_url

**`amendements`** : id, parlementaire_id (FK), objet, expose_motifs, sort, date_depot, legislature (défaut 17), texte_legis_ref, division_titre, texte_recherche (TSVECTOR généré, FTS French)

> Note : le champ `titre` n'existe pas dans les données AN (`corps.contenuAuteur` ne contient que `dispositif` et `exposeSommaire`). Le numéro d'amendement est extrait de l'`id` via regex `N(\d+)$`.

**`questions_ecrites`** : id, parlementaire_id (FK), rubrique, tete_analyse, texte_question, ministere, date_depot, legislature (défaut 17), texte_recherche (TSVECTOR : rubrique + tete_analyse + texte_question)

**`interventions`** : id (`{seanceUid}__{acteurId}___{index}`), parlementaire_id (FK), date_seance, point_titre, texte, texte_recherche (TSVECTOR sur texte)

**`dossiers_legislatifs`** : id (`{dossier_uid}_{parlementaire_id}`), dossier_uid, parlementaire_id (FK), titre, procedure_libelle, legislature (défaut 17), texte_recherche (TSVECTOR généré sur titre)

### Fonctions RPC
- `search_parlementaires(keywords TEXT[], orientation_filter TEXT, chambre_filter TEXT)` → parlementaires + `score` (somme amendements + questions + interventions + dossiers matchés) + `dossiers_count`. **SECURITY DEFINER** + `SET statement_timeout TO '30s'` — scan exhaustif des 4 tables, contourne le timeout de la clé anon.
- `truncate_all()` → TRUNCATE des 5 tables en cascade (dossiers_legislatifs, interventions, questions_ecrites, amendements, parlementaires)
- `get_top_amendeurs(lim INT)` → top deputés par nombre d'amendements déposés
- `get_top_questionneurs(lim INT)` → top deputés par nombre de questions écrites déposées
- `get_top_efficaces(lim INT)` → top deputés par taux d'adoption (min 10 amendements)

### Indexes
- `idx_amendements_fts`, `idx_questions_fts`, `idx_interventions_fts`, `idx_dossiers_fts` : GIN sur `texte_recherche`
- `idx_amendements_trgm_objet`, `idx_questions_trgm_rubrique` : GIN trigram
- `idx_amendements_parlementaire`, `idx_questions_parlementaire`, `idx_interventions_parlementaire`, `idx_dossiers_parlementaire` : B-tree sur `parlementaire_id`
- Index sur `orientation` et `chambre` (filtres)

---

## Variables d'environnement

```
VITE_SUPABASE_URL=https://mncyqaovonldvfzqmric.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
# Scripts d'ingestion uniquement (jamais dans le bundle frontend) :
SUPABASE_SERVICE_ROLE_KEY=<service role key>
# Côté Edge Function uniquement (jamais dans le bundle frontend) :
ANTHROPIC_API_KEY=<sk-ant-...>
```

---

## Décisions d'architecture

1. **Clé Anthropic côté serveur** : l'appel à l'API Anthropic passe par une Edge Function Supabase (`expand-query`). La clé n'est jamais exposée dans le bundle JS.
2. **Scoring** : somme (amendements + questions + interventions + dossiers matchés), normalisé (max = 100%) côté frontend dans `search.js`.
3. **Fallback expansion** : si l'Edge Function échoue, `anthropic.js` renvoie simplement la requête originale comme seul mot-clé.
4. **Photos parlementaires** : `photo_url` en base pointe vers Supabase Storage (bucket `photos`, public). Chargées via `upload-photos.js` depuis nosdeputes.fr. Fallback initiales + couleur du groupe dans `ParlementaireCard`.
5. **Proxy CORS `an-proxy`** : Edge Function servant de proxy pour les photos AN/nosdeputes.fr (`?type=photo&id=PA…` ou `?type=photo&slug=prenom-nom`) et les métadonnées opendata (`?type=opendata&ref=…`). Évite les blocages CORS côté frontend.
6. **Panneau détail** : clic sur une carte → `AmendementPanel` (slide-in droite). Charge en parallèle amendements + questions + interventions + dossiers du député filtrés par les mots-clés. 4 onglets. Fermeture par clic backdrop ou Échap.
7. **Titres des textes en live** : fetché via `an-proxy` (`?type=opendata&ref=…`) à l'ouverture du panneau, mis en cache global (Map) pour éviter les appels dupliqués.
8. **Logos groupes** : `groupeLogos.js` mappe les sigles vers des PNG depuis `src/assets/Logos/`. Groupes couverts : LFI-NFP, SOC, EcoS, LIOT, EPR, HOR, LR, RN, UDR, DR, Dem. Fallback initiales colorées pour GDR et NI.
9. **Nettoyage base** : `TRUNCATE CASCADE` via RPC `truncate_all()` — le DELETE `.neq('id','')` timeout sur 100k+ rows.
10. **Modale compte rendu de séance** : bouton "Compte rendu" dans l'onglet Séance du panneau → fetch toutes les interventions du même `seanceUid` via plage `gte`/`lt` (`.gte('id', seanceUid + '__').lt('id', seanceUid + '~')`). NE PAS utiliser `.like()` : Supabase encode `%` en `%25` dans l'URL et PostgREST ne le reconnaît plus comme wildcard LIKE. L'intervention du député est surlignée et scrollée en vue.
11. **Modale question écrite** : bouton "Lire" → affiche le texte complet déjà chargé (pas de fetch supplémentaire). Le lien "AN ↗" est conservé en parallèle.
12. **Limites fetch panel** : `fetchAmendements`, `fetchQuestionsEcrites`, `fetchInterventions` sont plafonnées à 500 résultats (au lieu de 50/100) pour aligner les compteurs carte ↔ panneau.
13. **Vue thématique transversale (`DocView`)** : intégrée directement dans `ResultsList.jsx`. Déclenchée via `handleTotalClick` (clic sur les totaux dans `KeywordsDisplay` ou les résultats). Passe `null` comme `parlementaireId` → retourne tous les documents matchant les keywords sur 4 types (amendements, questions, interventions, dossiers). Le nom du parlementaire est résolu via `parlIndex` (map `id → parlementaire` chargé au moment de la recherche via `fetchAllParlementaires()`). Pagination client-side (50 par page, bouton "Afficher X de plus"). Remplace l'ancien `SubjectPanel`.
14. **Page d'accueil (`LandingHero`)** : affichée avant toute recherche. 3 podiums (top amendeurs, top questionneurs, top efficaces) via RPC dédiées. 5 suggestions de thématiques cliquables. Se masque dès qu'une recherche est lancée.

---

## État d'avancement

### Fait ✅
- [x] Projet Vite initialisé, `@supabase/supabase-js` installé
- [x] Tables Supabase créées via MCP (+ fonctions RPC) : parlementaires, amendements, questions_ecrites, interventions
- [x] `supabase/schema.sql` (référence)
- [x] Edge Function `expand-query` déployée — secret `ANTHROPIC_API_KEY` configuré
- [x] Edge Function `an-proxy` déployée — proxy CORS photos + opendata AN
- [x] `scripts/ingest.js` : ingestion AMO10 députés + amendements + questions écrites
- [x] `scripts/ingest-comptes-rendus.js` : ingestion séances (syceron XML)
- [x] `scripts/update-photos.js` + `scripts/upload-photos.js` : photos dans Supabase Storage
- [x] `.env` créé avec `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- [x] Ingestion : **577 députés** + **99 583 amendements** + questions écrites + interventions en base
- [x] `src/styles/variables.css` (tokens design, Playfair Display, couleurs partisanes)
- [x] Composants : Header, SearchBar, KeywordsDisplay, ParlementaireCard, ResultsList, AmendementPanel
- [x] Lib : supabase.js, anthropic.js, search.js, groupeLogos.js
- [x] App.jsx : gestion des 3 sources (amendements, questions, interventions) en parallèle
- [x] Panneau détail (AmendementPanel) : 3 onglets — Amendements, Questions écrites, Séance
- [x] Scoring RPC agrège amendements + questions + interventions
- [x] Logos groupes (PNG) + fallback initiales colorées — tous les groupes AN 17e couverts (DR et Dem ajoutés)
- [x] Modale compte rendu de séance (onglet Séance) — fetch complet du seanceUid, surlignage + scroll auto
- [x] Modale question écrite complète (onglet Questions) — texte intégral + lien AN ↗
- [x] RPC `search_parlementaires` : SECURITY DEFINER + timeout 30s + scan exhaustif (plus de LIMIT intermédiaire)
- [x] Limites fetch panel corrigées : 500 pour amendements, questions et interventions
- [x] `SubjectPanel` remplacé par `DocView` (intégrée dans `ResultsList`) : vue thématique inline, résolution des noms via `parlIndex`, pagination 50/page
- [x] `fetchAmendements` / `fetchQuestionsEcrites` / `fetchInterventions` / `fetchDossiers` : `parlementaireId` optionnel (filtre `.eq()` conditionnel)
- [x] `fetchAllParlementaires()` : chargé en parallèle de la recherche pour alimenter `parlIndex`
- [x] Table `dossiers_legislatifs` : 4e source d'activité parlementaire
- [x] `scripts/ingest-dossiers.js` : ingestion dossiers législatifs AN (Dossiers_Legislatifs.json.zip)
- [x] RPC `search_parlementaires` mise à jour : inclut `dossiers_count` dans le score + DROP/CREATE (incompatible type retour)
- [x] RPC utilitaires : `get_top_amendeurs`, `get_top_questionneurs`, `get_top_efficaces`
- [x] `LandingHero` : page d'accueil avec podiums + suggestions de thématiques
- [x] `panelUtils.jsx` : utilitaires mutualisés pour les vues documents (highlight, URL AN, formatDate, fetchTexteMeta)
- [x] `AmendementPanel` : 4e onglet Dossiers

### Reste à faire ⏳
- [ ] Déploiement Vercel (frontend)
- [ ] Phase 4 : données Sénat

---

## Points de vigilance

- Le lien amendement → député passe par `signataires.auteur.acteurRef`. ~3 456 amendements ignorés (auteur non député actif : gouvernement, commissions…).
- Le groupe politique des députés est dans `mandats.mandat[].organes.organeRef` (pas `organeRef` directement). L'uid de l'organe dans le ZIP est une chaîne plain, pas un objet `{"#text":...}`.
- Les refs de textes législatifs ont deux formats : `BTC\d+` (ex: `BTC1376`) et `B\d+` (ex: `B0856`). La fonction `texteNum()` gère les deux via `/B(?:TC)?(\d+)/`.
- Les timeouts Supabase sur l'upsert sont bénins : le batch suivant reprend, les données sont complètes.
- Le mapping groupes → orientations est manuel (12 groupes en 17e législature). À mettre à jour si des groupes changent.
- La CLI Supabase ne s'installe pas via `npm install -g` sur Windows — utiliser le MCP.
- `pg_trgm` doit être activé dans Supabase (déjà fait via migration).
- Les amendements AN n'ont pas de champ `titre` — afficher le numéro extrait de l'ID (`N001852` → `n°1852`).
- Le format date syceron (comptes rendus) est `"20241106140000000"` — ne pas utiliser `new Date()` directement, extraire par slices de chaîne.
- Les interventions syceron sont dans `compteRendu.contenu.point[].paragraphe[]` avec l'attribut `@_id_acteur` (ou `@_id_acteur` selon le niveau de nesting). Les textes peuvent être des tableaux ou des chaînes.
- L'ID d'une intervention est construit comme `{seanceUid}__{acteurId}___{index}` — le préfixe avant `__` est le `seanceUid`. Pour fetcher toutes les interventions d'une séance : `.gte('id', seanceUid + '__').lt('id', seanceUid + '~')`. Ne jamais utiliser `.like()` (le `%` est mal encodé par le client Supabase JS).
- `upload-photos.js` crée le bucket `photos` si absent, puis upload les images et met `photo_url` à jour avec l'URL publique Supabase Storage.
- **17 230 amendements (17%) ont `objet` et `expose_motifs` NULL** : ce sont des amendements budgétaires (ÉTAT B crédits) ou de suppression sans corps textuel dans le flux opendata AN. FTS ne peut pas les matcher. Limitation source, non récupérable sans appel API externe par amendement.
