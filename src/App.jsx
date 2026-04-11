import { useState, useCallback } from 'react'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import KeywordsDisplay from './components/KeywordsDisplay'
import ResultsList from './components/ResultsList'
import AmendementPanel from './components/AmendementPanel'
import LandingHero from './components/LandingHero'
import { searchParlementaires, fetchAmendements, fetchQuestionsEcrites, fetchInterventions, fetchDossiers, fetchAllParlementaires } from './lib/search'

export default function App() {
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [results, setResults] = useState([])
  const [groupStats, setGroupStats] = useState([])
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

  async function handleSearch({ query, orientation, chambre, useAI }) {
    setLoading(true)
    setError(null)
    setLastQuery(query)
    setActiveDocView(null)

    try {
      const [{ keywords: kws, results: res }, allParls] = await Promise.all([
        searchParlementaires({ query, orientation, chambre, useAI }),
        fetchAllParlementaires(),
      ])
      setKeywords(kws)
      setResults(res)
      setSearched(true)
      setParlIndex(Object.fromEntries(allParls.map(p => [p.id, p])))

      const totalScore = res.reduce((sum, p) => sum + (p.score ?? 0), 0)
      const grouped = res.reduce((acc, p) => {
        const key = p.groupe_sigle
        if (!acc[key]) {
          acc[key] = { sigle: p.groupe_sigle, libelle: p.groupe_libelle, couleur: p.couleur_groupe, totalScore: 0, count: 0 }
        }
        acc[key].totalScore += p.score ?? 0
        acc[key].count += 1
        return acc
      }, {})
      const groupStats = Object.values(grouped)
        .map(g => ({
          ...g,
          avgScore: Math.round(g.totalScore / g.count),
          pct: totalScore > 0 ? Math.round((g.totalScore / totalScore) * 100) : 0,
        }))
        .sort((a, b) => b.totalScore - a.totalScore)
      setGroupStats(groupStats)
    } catch (err) {
      setError(err.message ?? 'Une erreur est survenue.')
      setResults([])
      setKeywords([])
      setGroupStats([])
    } finally {
      setLoading(false)
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
        <SearchBar onSearch={handleSearch} loading={loading} />
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
        {searched && !loading && (
          <KeywordsDisplay keywords={keywords} query={lastQuery} />
        )}
        {!searched && !loading && (
          <LandingHero onSearch={handleSearch} />
        )}
        <ResultsList
          results={results}
          groupStats={groupStats}
          loading={loading}
          searched={searched}
          onSelectParlementaire={handleSelectParlementaire}
          activeDocView={activeDocView}
          onTotalClick={handleTotalClick}
          onCloseDocView={() => setActiveDocView(null)}
          parlIndex={parlIndex}
          keywords={keywords}
        />
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
    </>
  )
}
