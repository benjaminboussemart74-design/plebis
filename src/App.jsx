import { useState, useCallback } from 'react'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import KeywordsDisplay from './components/KeywordsDisplay'
import ResultsList from './components/ResultsList'
import AmendementPanel from './components/AmendementPanel'
import { searchParlementaires, fetchAmendements, fetchQuestionsEcrites, fetchInterventions } from './lib/search'

export default function App() {
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [results, setResults] = useState([])
  const [groupStats, setGroupStats] = useState([])
  const [keywords, setKeywords] = useState([])
  const [lastQuery, setLastQuery] = useState('')
  const [error, setError] = useState(null)
  const [selectedParlementaire, setSelectedParlementaire] = useState(null)
  const [amendements, setAmendemens] = useState([])
  const [questionsEcrites, setQuestionsEcrites] = useState([])
  const [interventions, setInterventions] = useState([])
  const [loadingAmendements, setLoadingAmendements] = useState(false)

  async function handleSearch({ query, orientation, chambre }) {
    setLoading(true)
    setError(null)
    setLastQuery(query)

    try {
      const { keywords: kws, results: res } = await searchParlementaires({
        query, orientation, chambre,
      })
      setKeywords(kws)
      setResults(res)
      setSearched(true)

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

  const handleSelectParlementaire = useCallback(async (parlementaire) => {
    setSelectedParlementaire(parlementaire)
    setAmendemens([])
    setQuestionsEcrites([])
    setInterventions([])
    setLoadingAmendements(true)
    try {
      const [amends, questions, intervs] = await Promise.all([
        fetchAmendements(parlementaire.id, keywords),
        fetchQuestionsEcrites(parlementaire.id, keywords),
        fetchInterventions(parlementaire.id, keywords),
      ])
      setAmendemens(amends)
      setQuestionsEcrites(questions)
      setInterventions(intervs)
    } catch {
      setAmendemens([])
      setQuestionsEcrites([])
      setInterventions([])
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
        <ResultsList
          results={results}
          groupStats={groupStats}
          loading={loading}
          searched={searched}
          onSelectParlementaire={handleSelectParlementaire}
        />
      </main>
      <AmendementPanel
        parlementaire={selectedParlementaire}
        amendements={amendements}
        questionsEcrites={questionsEcrites}
        interventions={interventions}
        keywords={keywords}
        loading={loadingAmendements}
        onClose={() => setSelectedParlementaire(null)}
      />
    </>
  )
}
