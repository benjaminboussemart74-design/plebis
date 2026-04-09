/**
 * Met à jour photo_url dans parlementaires avec les URLs nosdeputes.fr.
 * nosdeputes.fr sert les images avec Access-Control-Allow-Origin: *.
 * Pour les députés absents → onError affiche les initiales.
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

function slugify(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

const { data, error } = await supabase
  .from('parlementaires')
  .select('id, prenom, nom')

if (error) { console.error(error); process.exit(1) }
console.log(`${data.length} parlementaires…`)

const updates = data.map(({ id, prenom, nom }) => ({
  id,
  photo_url: `https://www.nosdeputes.fr/depute/photo/${slugify(prenom)}-${slugify(nom)}/120`,
}))

// Updates en parallèle par batch de 20
const BATCH = 20
for (let i = 0; i < updates.length; i += BATCH) {
  const batch = updates.slice(i, i + BATCH)
  await Promise.all(batch.map(({ id, photo_url }) =>
    supabase.from('parlementaires').update({ photo_url }).eq('id', id)
  ))
  console.log(`  ✓ ${Math.min(i + BATCH, updates.length)}/${updates.length}`)
}

console.log('✅ photo_url mis à jour.')
