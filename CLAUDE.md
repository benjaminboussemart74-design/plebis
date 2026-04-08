# Plébis — CLAUDE.md

## Charte graphique

**Référence obligatoire pour toute implémentation UI : [`DESIGN.md`](./DESIGN.md)**

Avant tout travail sur le frontend (composants, CSS, layout), lire `DESIGN.md`.
Il contient : typographie, palette, espacements, composants, et principes éditoriaux.

---

## Objectif

Moteur de recherche des parlementaires français actifs sur une thématique donnée.
L'utilisateur saisit un sujet → l'IA génère des mots-clés → Supabase retourne les parlementaires classés par activité (phase 1 : amendements AN 17e législature).

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
├── src/
│   ├── components/
│   │   ├── Header.jsx / .module.css
│   │   ├── SearchBar.jsx / .module.css
│   │   ├── KeywordsDisplay.jsx / .module.css
│   │   ├── ParlementaireCard.jsx / .module.css
│   │   ├── ResultsList.jsx / .module.css
│   │   └── AmendementPanel.jsx / .module.css   ← panneau latéral amendements
│   ├── lib/
│   │   ├── supabase.js       (client Supabase)
│   │   ├── anthropic.js      (appel Edge Function expand-query)
│   │   └── search.js         (orchestration recherche + scoring + fetchAmendements)
│   ├── styles/
│   │   └── variables.css     (tokens design + Playfair Display)
│   ├── App.jsx
│   └── main.jsx
├── supabase/
│   ├── schema.sql            (référence — tables appliquées via MCP)
│   └── functions/
│       └── expand-query/
│           └── index.ts      (Edge Function Deno)
├── scripts/
│   └── ingest.js             (ingestion amendements AN, Node.js ESM)
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
  - API : `https://www.assemblee-nationale.fr/dyn/opendata/{texteRef}.json`
  - Utilisée côté frontend dans `AmendementPanel` pour afficher le titre du texte amendé
  - Cache en mémoire (Map) pour éviter les appels dupliqués

### Phase 2 (à venir)
- Questions écrites AN
- Comptes rendus de séance AN
- Données Sénat

---

## Schéma Supabase

### Tables

**`parlementaires`** : id, nom, prenom, chambre (AN|Senat), groupe_sigle, groupe_libelle, orientation (gauche|centre|droite), couleur_groupe, circonscription, photo_url

**`amendements`** : id, parlementaire_id (FK), objet, expose_motifs, sort, date_depot, legislature (défaut 17), texte_legis_ref, division_titre, texte_recherche (TSVECTOR généré, FTS French)

> Note : le champ `titre` n'existe pas dans les données AN (`corps.contenuAuteur` ne contient que `dispositif` et `exposeSommaire`). Le numéro d'amendement est extrait de l'`id` via regex `N(\d+)$`.

### Fonctions RPC
- `search_parlementaires(keywords TEXT[], orientation_filter TEXT, chambre_filter TEXT)` → parlementaires + score (COUNT amendements matchés)
- `truncate_all()` → TRUNCATE des deux tables en cascade (appelée par `ingest.js` au lieu de DELETE)

### Indexes
- `idx_amendements_fts` : GIN sur `texte_recherche`
- `idx_amendements_trgm_objet` : GIN trigram sur `objet`
- `idx_amendements_parlementaire` : B-tree sur `parlementaire_id`
- Index sur `orientation` et `chambre` (filtres)

---

## Variables d'environnement

```
VITE_SUPABASE_URL=https://mncyqaovonldvfzqmric.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
# Côté Edge Function uniquement (jamais dans le bundle frontend) :
ANTHROPIC_API_KEY=<sk-ant-...>
```

---

## Décisions d'architecture

1. **Clé Anthropic côté serveur** : l'appel à l'API Anthropic passe par une Edge Function Supabase (`expand-query`). La clé n'est jamais exposée dans le bundle JS.
2. **Scoring** : COUNT des amendements matchés, normalisé (max = 100%) côté frontend dans `search.js`.
3. **Fallback expansion** : si l'Edge Function échoue, `anthropic.js` renvoie simplement la requête originale comme seul mot-clé.
4. **Photo parlementaire** : URL construite à partir de l'ID AN (`https://www.assemblee-nationale.fr/dyn/static/tribun/{id}/photo`). Fallback initiales + couleur du groupe.
5. **Panneau amendements** : clic sur une carte → `AmendementPanel` (slide-in droite). Charge les amendements du député filtrés par les mots-clés courants via `fetchAmendements()`. Fermeture par clic backdrop ou Échap.
6. **Titres des textes en live** : fetché depuis `assemblee-nationale.fr/dyn/opendata/{ref}.json` à l'ouverture du panneau, mis en cache global (Map) pour éviter les appels répétés.
7. **Nettoyage base** : `TRUNCATE CASCADE` via RPC `truncate_all()` — le DELETE `.neq('id','')` timeout sur 100k+ rows.

---

## État d'avancement

### Fait ✅
- [x] Projet Vite initialisé, `@supabase/supabase-js` installé
- [x] Tables Supabase créées via MCP (+ fonctions RPC)
- [x] `supabase/schema.sql` (référence)
- [x] Edge Function `expand-query` déployée sur Supabase — secret `ANTHROPIC_API_KEY` configuré
- [x] `scripts/ingest.js` : ingestion AMO10 députés + Amendements, TRUNCATE via RPC
- [x] `.env` créé avec `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- [x] Ingestion : **577 députés** + **99 583 amendements** en base
- [x] `src/styles/variables.css` (tokens design, Playfair Display, couleurs partisanes)
- [x] Composants : Header, SearchBar, KeywordsDisplay, ParlementaireCard, ResultsList, AmendementPanel
- [x] Lib : supabase.js, anthropic.js, search.js
- [x] App.jsx assemblé
- [x] Panneau latéral amendements avec texte amendé, exposé des motifs, titre du texte (API live), lien AN ↗

### Reste à faire ⏳
- [ ] Tester `npm run dev` et valider une recherche de bout en bout
- [ ] Ajouter `prefixeOrganeExamen` (organe examinant) dans les amendements — nécessite re-ingestion
- [ ] Phase 2 : questions écrites + interventions en séance
- [ ] Déploiement Vercel (frontend)

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
