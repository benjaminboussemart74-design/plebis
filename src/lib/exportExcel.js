import * as XLSX from 'xlsx'

function slugify(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
}

function extractNumero(id) {
  const m = id?.match(/N(\d+)$/)
  return m ? `N°${parseInt(m[1], 10)}` : id
}

export function exportParlementaire(parlementaire, amendements, questionsEcrites, interventions) {
  const wb = XLSX.utils.book_new()

  // ── Onglet Amendements ────────────────────────────────────
  const amendementsRows = amendements.map(a => {
    const url = `https://www.assemblee-nationale.fr/dyn/17/amendements/${a.id}`
    return {
      'Numéro': extractNumero(a.id),
      'Référence texte législatif': a.texte_legis_ref ?? '',
      'Division/Article': a.division_titre ?? '',
      'Objet': a.objet ?? '',
      'Exposé des motifs': a.expose_motifs ?? '',
      'Sort': a.sort ?? '',
      'Date de dépôt': a.date_depot ?? '',
      'Lien AN': { t: 's', v: 'Voir AN', l: { Target: url } },
    }
  })

  const wsAmendements = XLSX.utils.json_to_sheet(
    amendementsRows.map(r => ({
      ...r,
      'Lien AN': r['Lien AN'].v,
    }))
  )
  // Injecter les hyperliens cellule par cellule
  amendementsRows.forEach((row, i) => {
    const cellAddr = XLSX.utils.encode_cell({ c: 7, r: i + 1 }) // col H, row i+1 (0-indexed + header)
    if (wsAmendements[cellAddr]) {
      wsAmendements[cellAddr].l = row['Lien AN'].l
    }
  })
  XLSX.utils.book_append_sheet(wb, wsAmendements, 'Amendements')

  // ── Onglet Questions écrites ──────────────────────────────
  const questionsRows = (questionsEcrites ?? []).map(q => {
    const url = `https://www.assemblee-nationale.fr/dyn/17/questions/${q.id}`
    return {
      'Rubrique': q.rubrique ?? '',
      'Tête d\'analyse': q.tete_analyse ?? '',
      'Ministère destinataire': q.ministere ?? '',
      'Texte de la question': q.texte_question ?? '',
      'Date de dépôt': q.date_depot ?? '',
      'Lien AN': { v: 'Voir AN', l: { Target: url } },
    }
  })

  const wsQuestions = XLSX.utils.json_to_sheet(
    questionsRows.map(r => ({ ...r, 'Lien AN': r['Lien AN'].v }))
  )
  questionsRows.forEach((row, i) => {
    const cellAddr = XLSX.utils.encode_cell({ c: 5, r: i + 1 }) // col F
    if (wsQuestions[cellAddr]) {
      wsQuestions[cellAddr].l = row['Lien AN'].l
    }
  })
  XLSX.utils.book_append_sheet(wb, wsQuestions, 'Questions écrites')

  // ── Onglet Interventions en séance ────────────────────────
  const interventionsData = (interventions ?? []).map(i => ({
    'Date de séance': i.date_seance ?? '',
    'Point à l\'ordre du jour': i.point_titre ?? '',
    'Texte de l\'intervention': i.texte ?? '',
  }))
  const wsInterventions = XLSX.utils.json_to_sheet(interventionsData)
  XLSX.utils.book_append_sheet(wb, wsInterventions, 'Interventions en séance')

  // ── Nom du fichier ────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10)
  const filename = `plebis_${slugify(parlementaire.prenom)}_${slugify(parlementaire.nom)}_${today}.xlsx`

  XLSX.writeFile(wb, filename)
}
