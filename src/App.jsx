import { useState, useCallback, useMemo } from 'react'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import KeywordsDisplay from './components/KeywordsDisplay'
import ResultsList from './components/ResultsList'
import AmendementPanel from './components/AmendementPanel'
import DocPanel from './components/DocPanel'
import LandingHero from './components/LandingHero'
import { searchParlementaires, fetchAmendements, fetchQuestionsEcrites, fetchInterventions, fetchDossiers, fetchAllParlementaires } from './lib/search'
import { expandQuery } from './lib/anthropic'
import styles from './App.module.css'

export default function App() {
  const [searched, setSearched] = useState(false)
  const [resultsAN, setResultsAN] = useState([])
  const [loadingAN, setLoadingAN] = useState(false)
  const [keywords, setKeywords] = useState([])
  const [lastQuery, setLastQuery] = useState('')
  const [error, setError] = useState(null)
  const [selectedParlementaire, setSelectedParlementaire] = useState(null)
  const [amendements, setAmendements] = useState([])
  const [questionsEcrites, setQuestionsEcrites] = useState([])
  const [interventions, setInterventions] = useState([])
  const [dossiers, setDossiers] = useState([])
  const [loadingAmendements, setLoadingAmendements] = useState(false)
  const [activeDocView, setActiveDocView] = useState(null)
  const [parlIndex, setParlIndex] = useState({})
  const [docCounts, setDocCounts] = useState({ amendements: 0, questions: 0, interventions: 0, dossiers: 0 })

  const docCountsComputed = useMemo(() =>
    resultsAN.reduce((acc, p) => ({
      amendements: acc.amendements + (p.amendements_count ?? 0),
      questions: acc.questions + (p.questions_count ?? 0),
      interventions: acc.interventions + (p.interventions_count ?? 0),
      dossiers: acc.dossiers + (p.dossiers_count ?? 0),
    }), { amendements: 0, questions: 0, interventions: 0, dossiers: 0 }),
  [resultsAN])

  async function handleSearch({ query, orientation, useAI }) {
    setLoadingAN(true)
    setError(null)
    setLastQuery(query)
    setActiveDocView(null)
    setSelectedParlementaire(null)

    try {
      const kws = useAI ? await expandQuery(query) : [query]
      setKeywords(kws)

      const [resAN, allParls] = await Promise.all([
        searchParlementaires({ query, orientation, chambre: 'AN', keywords: kws }),
        fetchAllParlementaires(),
      ])

      setResultsAN(resAN.results)
      setDocCounts(
        resAN.results.reduce((acc, p) => ({
          amendements: acc.amendements + (p.amendements_count ?? 0),
          questions: acc.questions + (p.questions_count ?? 0),
          interventions: acc.interventions + (p.interventions_count ?? 0),
          dossiers: acc.dossiers + (p.dossiers_count ?? 0),
        }), { amendements: 0, questions: 0, interventions: 0, dossiers: 0 })
      )
      setParlIndex(Object.fromEntries(allParls.map(p => [p.id, p])))
      setSearched(true)
    } catch (err) {
      setError(err.message ?? 'Une erreur est survenue.')
      setResultsAN([])
      setDocCounts({ amendements: 0, questions: 0, interventions: 0, dossiers: 0 })
      setKeywords([])
      setSearched(true)
    } finally {
      setLoadingAN(false)
    }
  }

  const handleTotalClick = useCallback(async (type) => {
    setActiveDocView({ type, data: [], loading: true })
    setSelectedParlementaire(null)
    try {
      let data = []
      if (type === 'amendements')    data = await fetchAmendements(null, keywords)
      else if (type === 'questions') data = await fetchQuestionsEcrites(null, keywords)
      else if (type === 'interventions') data = await fetchInterventions(null, keywords)
      else if (type === 'dossiers')  data = await fetchDossiers(null, keywords)
      setActiveDocView({ type, data, loading: false })
    } catch {
      setActiveDocView({ type, data: [], loading: false })
    }
  }, [keywords])

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

  return (
    <>
      <Header />
      <main>
        <SearchBar onSearch={handleSearch} loading={loadingAN} />
        {error && <div className={styles.error}>{error}</div>}
        {searched && !loadingAN && (
          <KeywordsDisplay keywords={keywords} query={lastQuery} />
        )}
        {!searched && !loadingAN && (
          <LandingHero onSearch={handleSearch} />
        )}
        {(searched || loadingAN) && (
          <ResultsList
            results={resultsAN}
            loading={loadingAN}
            searched={searched}
            onSelectParlementaire={handleSelectParlementaire}
            activeDocView={activeDocView}
            onTotalClick={handleTotalClick}
            parlIndex={parlIndex}
            keywords={keywords}
            docCounts={docCounts}
          />
        )}
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
        parlIndex={parlIndex}
        keywords={keywords}
        onClose={() => setActiveDocView(null)}
      />
    </>
  )
}
