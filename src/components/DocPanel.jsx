import { useEffect, useMemo, useState } from 'react'
import styles from './DocPanel.module.css'
import { getGroupeLogo } from '../lib/groupeLogos'
import {
  SORT_LABEL, anUrl, amendNum, texteNum, texteUrl,
  senatAmendUrl, senatTexteAmendUrl, senatTexteNum, senatQuestionUrl,
  formatDate, excerptAround, highlight as _highlight, fetchTexteMeta,
} from '../lib/panelUtils'

function hl(text, keywords) {
  return _highlight(text, keywords, styles.highlight)
}

function DocAuteur({ parlementaireId, parlIndex }) {
  const p = parlIndex?.[parlementaireId]
  if (!p) return null
  return (
    <span className={styles.auteur} style={{ '--auteur-color': p.couleur_groupe || '#9A9A92' }}>
      {p.prenom} {p.nom}
    </span>
  )
}

const TYPE_LABEL = {
  amendements: 'Amendements',
  questions: 'Questions écrites',
  interventions: 'Interventions en séance',
  dossiers: 'Dossiers législatifs',
}

function renderAmendItem(a, texteMetas, keywords, parlIndex, styles) {
  const sortInfo = SORT_LABEL[a.sort] ?? null
  const isSenat = a.id?.startsWith('SEN_AMN_')
  const url = isSenat ? senatTexteAmendUrl(a.texte_legis_ref) : texteUrl(a.texte_legis_ref)
  const meta = (!isSenat && a.texte_legis_ref) ? texteMetas[a.texte_legis_ref] : null
  const texteLabel = isSenat
    ? (senatTexteNum(a.texte_legis_ref) ? `Sénat — Texte n°${senatTexteNum(a.texte_legis_ref)}` : null)
    : (meta?.titre || meta?.denomination || (texteNum(a.texte_legis_ref) ? `Texte n°${texteNum(a.texte_legis_ref)}` : null))

  return (
    <li key={a.id} className={styles.item}>
      <DocAuteur parlementaireId={a.parlementaire_id} parlIndex={parlIndex} />
      {texteLabel && (
        <div className={styles.itemRef}>
          {url
            ? <a href={url} target="_blank" rel="noopener noreferrer" className={styles.itemRefLink}>{texteLabel}</a>
            : <span className={styles.itemRefLabel}>{texteLabel}</span>
          }
          {a.division_titre && <span className={styles.itemRefSub}> · {a.division_titre}</span>}
        </div>
      )}
      <div className={styles.itemMeta}>
        <span className={styles.itemTitre}>{amendNum(a.id)}</span>
        <div className={styles.itemMetaRight}>
          {sortInfo && <span className={`${styles.sort} ${styles[sortInfo.cls]}`}>{sortInfo.label}</span>}
          {a.date_depot && <span className={styles.date}>{formatDate(a.date_depot)}</span>}
          {isSenat
            ? <a href={senatAmendUrl(a.id)} target="_blank" rel="noopener noreferrer" className={styles.link}>Sénat ↗</a>
            : <a href={anUrl(a.id)} target="_blank" rel="noopener noreferrer" className={styles.link}>AN ↗</a>
          }
        </div>
      </div>
      {a.objet && <p className={styles.itemText}>{hl(a.objet, keywords)}</p>}
    </li>
  )
}

function renderQuestionItem(q, keywords, parlIndex, styles) {
  return (
    <li key={q.id} className={styles.item}>
      <DocAuteur parlementaireId={q.parlementaire_id} parlIndex={parlIndex} />
      <div className={styles.itemMeta}>
        <div className={styles.itemQuestionMeta}>
          {q.rubrique && <span className={styles.rubrique}>{q.rubrique}</span>}
          {q.ministere && <span className={styles.ministere}>→ {q.ministere}</span>}
        </div>
        <div className={styles.itemMetaRight}>
          {q.date_depot && <span className={styles.date}>{formatDate(q.date_depot)}</span>}
          {q.id?.startsWith('SEN_Q')
            ? senatQuestionUrl(q.id, q.date_depot) && (
              <a href={senatQuestionUrl(q.id, q.date_depot)} target="_blank" rel="noopener noreferrer" className={styles.link}>Sénat ↗</a>
            )
            : <a href={`https://www.assemblee-nationale.fr/dyn/17/questions/${q.id}`} target="_blank" rel="noopener noreferrer" className={styles.link}>AN ↗</a>
          }
        </div>
      </div>
      {q.tete_analyse && <p className={styles.itemText}>{hl(q.tete_analyse, keywords)}</p>}
      {q.texte_question && <p className={styles.itemTextMuted}>{hl(excerptAround(q.texte_question, keywords), keywords)}</p>}
    </li>
  )
}

function renderIntervItem(i, keywords, parlIndex, styles) {
  return (
    <li key={i.id} className={styles.item}>
      <DocAuteur parlementaireId={i.parlementaire_id} parlIndex={parlIndex} />
      <div className={styles.itemMeta}>
        {i.point_titre && <span className={styles.itemRefLabel}>{i.point_titre}</span>}
        <div className={styles.itemMetaRight}>
          {i.date_seance && <span className={styles.date}>{formatDate(i.date_seance)}</span>}
        </div>
      </div>
      {i.texte && <p className={styles.itemText}>{hl(excerptAround(i.texte, keywords), keywords)}</p>}
    </li>
  )
}

function renderDossierItem(d, keywords, parlIndex, styles) {
  const anDossUrl = d.titre_chemin
    ? `https://www.assemblee-nationale.fr/dyn/17/dossiers/${d.titre_chemin}`
    : null
  return (
    <li key={d.id} className={styles.item}>
      <DocAuteur parlementaireId={d.parlementaire_id} parlIndex={parlIndex} />
      {d.procedure_libelle && (
        <div className={styles.itemRef}>
          <span className={styles.procedure}>{d.procedure_libelle}</span>
        </div>
      )}
      <div className={styles.itemMeta}>
        <span className={styles.itemTitreWrap}>{hl(d.titre, keywords)}</span>
        <div className={styles.itemMetaRight}>
          {d.date_depot && <span className={styles.date}>{formatDate(d.date_depot)}</span>}
          {anDossUrl && <a href={anDossUrl} target="_blank" rel="noopener noreferrer" className={styles.link}>AN ↗</a>}
        </div>
      </div>
    </li>
  )
}

export default function DocPanel({ activeDocView, docCounts, parlIndex, keywords, onClose }) {
  const [collapsed, setCollapsed] = useState(new Set())
  const [texteMetas, setTexteMetas] = useState({})

  const type = activeDocView?.type
  const data = activeDocView?.data ?? []
  const loading = activeDocView?.loading ?? false

  useEffect(() => {
    setCollapsed(new Set())
  }, [type])

  // Fetch titres textes pour les amendements
  useEffect(() => {
    if (type !== 'amendements' || !data.length) return
    const refs = [...new Set(data.map(a => a.texte_legis_ref).filter(r => r && !r.startsWith('SEN_')))]
    let cancelled = false
    Promise.all(refs.map(async ref => [ref, await fetchTexteMeta(ref)]))
      .then(entries => { if (!cancelled) setTexteMetas(Object.fromEntries(entries)) })
    return () => { cancelled = true }
  }, [type, data])

  // Fermeture par Échap
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Groupes par groupe_sigle
  const groups = useMemo(() => {
    if (!data.length || !parlIndex) return []
    const map = new Map()
    for (const doc of data) {
      const p = parlIndex[doc.parlementaire_id]
      const sigle = p?.groupe_sigle ?? (doc.parlementaire_id?.startsWith('SEN_') ? 'Sénat' : 'NI')
      const couleur = p?.couleur_groupe ?? '#9A9A92'
      const libelle = p?.groupe_libelle ?? 'Non inscrit'
      if (!map.has(sigle)) map.set(sigle, { sigle, couleur, libelle, items: [] })
      map.get(sigle).items.push(doc)
    }
    return [...map.values()].sort((a, b) => b.items.length - a.items.length)
  }, [data, parlIndex])

  if (!activeDocView) return null

  const totalCount = docCounts?.[type] ?? data.length

  function toggleGroup(sigle) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(sigle)) next.delete(sigle)
      else next.add(sigle)
      return next
    })
  }

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <aside className={styles.panel}>
        <div className={styles.header}>
          <div className={styles.headerInfo}>
            <span className={styles.headerTitle}>{TYPE_LABEL[type]}</span>
            {!loading && (
              <span className={styles.headerCount}>
                {totalCount.toLocaleString('fr-FR')}
                {data.length < totalCount && ` (${data.length} chargés)`}
              </span>
            )}
          </div>
          <button className={styles.close} onClick={onClose} aria-label="Fermer">×</button>
        </div>

        <div className={styles.body}>
          {loading ? (
            <div className={styles.stateMsg}>Chargement…</div>
          ) : data.length === 0 ? (
            <div className={styles.stateMsg}>Aucun document trouvé.</div>
          ) : (
            <ul className={styles.groupList}>
              {groups.map(g => {
                const logo = getGroupeLogo(g.sigle)
                const isOpen = !collapsed.has(g.sigle)
                return (
                  <li key={g.sigle} className={styles.group}>
                    <button
                      className={styles.groupHeader}
                      style={{ '--group-color': g.couleur }}
                      onClick={() => toggleGroup(g.sigle)}
                      aria-expanded={isOpen}
                    >
                      <div className={styles.groupColorBar} />
                      <div className={styles.groupLogoZone}>
                        {logo
                          ? <img src={logo} alt={g.sigle} className={styles.groupLogo} />
                          : <span className={styles.groupSigle}>{g.sigle}</span>
                        }
                      </div>
                      <span className={styles.groupLibelle}>{g.libelle}</span>
                      <span className={styles.groupCount}>{g.items.length}</span>
                      <span className={styles.groupChevron}>{isOpen ? '▾' : '▸'}</span>
                    </button>

                    {isOpen && (
                      <ul className={styles.docList}>
                        {type === 'amendements' && g.items.map(a =>
                          renderAmendItem(a, texteMetas, keywords, parlIndex, styles)
                        )}
                        {type === 'questions' && g.items.map(q =>
                          renderQuestionItem(q, keywords, parlIndex, styles)
                        )}
                        {type === 'interventions' && g.items.map(i =>
                          renderIntervItem(i, keywords, parlIndex, styles)
                        )}
                        {type === 'dossiers' && g.items.map(d =>
                          renderDossierItem(d, keywords, parlIndex, styles)
                        )}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </aside>
    </>
  )
}
