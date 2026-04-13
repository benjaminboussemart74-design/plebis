import { useState, useCallback } from 'react'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import KeywordsDisplay from './components/KeywordsDisplay'
import ResultsList from './components/ResultsList'
import AmendementPanel from './components/AmendementPanel'
import DocPanel from './components/DocPanel'
import LandingHero from './components/LandingHero'
import { searchParlementaires, fetchAmendements, fetchQuestionsEcrites, fetchInterventions, fetchDossiers, fetchAllParlementaires, fetchDocCounts } from './lib/search'
import { expandQuery } from './lib/anthropic'
import styles from './App.module.css'

export default function App() {
  const [searched, setSearched] = useState(false)
  const [resultsAN, setResultsAN] = useState([])
  const [resultsSenat, setResultsSenat] = useState([])
  const [loadingAN, setLoadingAN] = useState(false)
  const [loadingSenat, setLoadingSenat] = useState(false)
  const [keywords, setKeywords] = useState([])
  const [lastQuery, setLastQuery] = useState('')
  const [error, setError] = useState(null)
  const [selectedParlementaire, setSelectedParlementaire] = useState(null)
  const [amendements, setAmendements] = useState([])
  const [questionsEcrites, setQuestionsEcrites] = useState([])
  const [interventions, setInterventions] = useState([])
  const [dossiers, setDossiers] = useState([])
  const [loadingAmendements, setLoadingAmendements] = useState(false)

  // null | { type: 'amendements'|'questions'|'interventions'|'dossiers', data: [], loading: bool }
  const [activeDocView, setActiveDocView] = useState(null)
  const [parlIndex, setParlIndex] = useState({})
  const [docCounts, setDocCounts] = useState({ amendements: 0, questions: 0, interventions: 0, dossiers: 0 })

  async function handleSearch({ query, orientation, useAI }) {
    setLoadingAN(true)
    setLoadingSenat(true)
    setError(null)
    setLastQuery(query)
    setActiveDocView(null)

    try {
      // Expansion IA une seule fois, partagée entre les deux chambres
      const kws = useAI ? await expandQuery(query) : [query]
      setKeywords(kws)

      const [[resAN, resSenat], allParls, counts] = await Promise.all([
        Promise.allSettled([
          searchParlementaires({ query, orientation, chambre: 'AN', keywords: kws }),
          searchParlementaires({ query, orientation, chambre: 'Senat', keywords: kws }),
        ]),
        fetchAllParlementaires(),
        fetchDocCounts(kws),
      ])

      setResultsAN(resAN.status === 'fulfilled' ? resAN.value.results : [])
      setLoadingAN(false)
      setResultsSenat(resSenat.status === 'fulfilled' ? resSenat.value.results : [])
      setLoadingSenat(false)
      setDocCounts(counts)
      setSearched(true)
      setParlIndex(Object.fromEntries(allParls.map(p => [p.id, p])))
    } catch (err) {
      setError(err.message ?? 'Une erreur est survenue.')
      setResultsAN([])
      setResultsSenat([])
      setKeywords([])
      setDocCounts({ amendements: 0, questions: 0, interventions: 0, dossiers: 0 })
      setLoadingAN(false)
      setLoadingSenat(false)
      setSearched(true)
    }
  }

  const handleTotalClick = useCallback(async (type) => {
    // Toggle : clic sur le type actif ferme le panneau
    if (activeDocView?.type === type && !activeDocView?.loading) {
      setActiveDocView(null)
      return
    }
    setActiveDocView({ type, data: [], loading: true })
    setSelectedParlementaire(null)
    try {
      let data = []
      if (type === 'amendements')        data = await fetchAmendements(null, keywords)
      else if (type === 'questions')     data = await fetchQuestionsEcrites(null, keywords)
      else if (type === 'interventions') data = await fetchInterventions(null, keywords)
      else if (type === 'dossiers')      data = await fetchDossiers(null, keywords)
      setActiveDocView({ type, data, loading: false })
    } catch {
      setActiveDocView({ type, data: [], loading: false })
    }
  }, [keywords, activeDocView])

  const handleSelectParlementaire = useCallback(async (parlementaire) => {
    setSelectedParlementaire(parlementaire)
    setActiveDocView(null)
    setAmendements([])
    setQuestionsEcrites([])
    setInterventions([])
    setDossiers([])
    setLoadingAmendements(true)
    try {
      const [amends, questions, intervs, doss] = await Promise.all([
        fetchAmendements(parlementaire.id, keywords),
        fetchQuestionsEcrites(parlementaire.id, keywords),
        fetchInterventions(parlementaire.id, keywords),
        fetchDossiers(parlementaire.id, keywords),
      ])
      setAmendements(amends)
      setQuestionsEcrites(questions)
      setInterventions(intervs)
      setDossiers(doss)
    } catch {
      setAmendements([])
      setQuestionsEcrites([])
      setInterventions([])
      setDossiers([])
    } finally {
      setLoadingAmendements(false)
    }
  }, [keywords])

  const isLoading = loadingAN || loadingSenat

  return (
    <>
      <Header />
      <main>
        <SearchBar onSearch={handleSearch} loading={isLoading} />
        {error && (
          <div style={{
            maxWidth: 900, margin: '1rem auto 0', padding: '0 1.5rem',
            color: 'var(--color-editorial)', fontSize: '13px',
            background: 'var(--color-editorial-light)', border: 'var(--border-light)',
            borderLeft: '3px solid var(--color-editorial)',
          }}>
            {error}
          </div>
        )}
        {searched && !isLoading && (
          <KeywordsDisplay keywords={keywords} query={lastQuery} />
        )}
        {!searched && !isLoading && (
          <LandingHero onSearch={handleSearch} />
        )}
        {(searched || isLoading) && <div className={styles.biChambreLayout}>
          <div className={styles.colonne}>
            <h2 className={styles.colonneTitre}>Assemblée nationale</h2>
            <ResultsList
              results={resultsAN}
              loading={loadingAN}
              searched={searched}
              onSelectParlementaire={handleSelectParlementaire}
              activeDocView={activeDocView}
              onTotalClick={handleTotalClick}
              onCloseDocView={() => setActiveDocView(null)}
              parlIndex={parlIndex}
              keywords={keywords}
              docCounts={docCounts}
            />
          </div>
        </div>}
      </main>
      <AmendementPanel
        parlementaire={selectedParlementaire}
        amendements={amendements}
        questionsEcrites={questionsEcrites}
        interventions={interventions}
        dossiers={dossiers}
        keywords={keywords}
        loading={loadingAmendements}
        onClose={() => setSelectedParlementaire(null)}
      />
      <DocPanel
        activeDocView={activeDocView}
        docCounts={docCounts}
        parlIndex={parlIndex}
        keywords={keywords}
        onClose={() => setActiveDocView(null)}
      />
    </>
  )
}
