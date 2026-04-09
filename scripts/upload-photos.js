/**
 * Fetch chaque photo député depuis nosdeputes.fr (côté serveur, pas de CORS),
 * upload dans Supabase Storage, et met à jour photo_url en base.
 *
 * Pré-requis : bucket "photos" public dans Supabase Storage.
 * Usage : node scripts/upload-photos.js
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

// ── 1. Créer le bucket s'il n'existe pas ────────────────────────────────────
const { error: bucketErr } = await supabase.storage.createBucket('photos', {
  public: true,
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
})
if (bucketErr && !bucketErr.message.includes('already exists')) {
  console.error('Bucket error:', bucketErr)
  process.exit(1)
}
console.log('Bucket "photos" prêt.')

// ── 2. Récupérer tous les parlementaires ────────────────────────────────────
const { data: parlementaires, error } = await supabase
  .from('parlementaires')
  .select('id, prenom, nom')

if (error) { console.error(error); process.exit(1) }
console.log(`${parlementaires.length} parlementaires à traiter…\n`)

// ── 3. Fetch + upload ────────────────────────────────────────────────────────
let ok = 0, skip = 0
const updates = []

for (const { id, prenom, nom } of parlementaires) {
  const slug = `${slugify(prenom)}-${slugify(nom)}`
  const srcUrl = `https://www.nosdeputes.fr/depute/photo/${slug}/120`

  try {
    const res = await fetch(srcUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'follow',
    })

    const ct = res.headers.get('content-type') ?? ''
    if (!res.ok || !ct.startsWith('image/')) {
      skip++
      updates.push({ id, photo_url: null })
      continue
    }

    const blob = await res.arrayBuffer()
    const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg'
    const path = `${id}.${ext}`

    const { error: upErr } = await supabase.storage
      .from('photos')
      .upload(path, blob, { contentType: ct, upsert: true })

    if (upErr) {
      console.warn(`  ⚠ upload ${id}:`, upErr.message)
      skip++
      updates.push({ id, photo_url: null })
      continue
    }

    const { data: { publicUrl } } = supabase.storage.from('photos').getPublicUrl(path)
    updates.push({ id, photo_url: publicUrl })
    ok++
    if (ok % 50 === 0) console.log(`  ✓ ${ok} photos uploadées…`)
  } catch (e) {
    skip++
    updates.push({ id, photo_url: null })
  }
}

console.log(`\n  Photos : ${ok} OK, ${skip} sans photo (fallback initiales)`)

// ── 4. Mettre à jour photo_url en base ──────────────────────────────────────
console.log('\nMise à jour photo_url en base…')
const BATCH = 200
for (let i = 0; i < updates.length; i += BATCH) {
  const batch = updates.slice(i, i + BATCH)
  const { error: uErr } = await supabase
    .from('parlementaires')
    .upsert(batch, { onConflict: 'id' })
  if (uErr) console.error(`Batch ${i}:`, uErr)
  else console.log(`  ✓ ${Math.min(i + BATCH, updates.length)}/${updates.length}`)
}

console.log('\n✅ Photos uploadées et URLs mises à jour.')
