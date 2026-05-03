/**
 * Fetch chaque photo parlementaire depuis les sources officielles,
 * upload dans Supabase Storage, et met à jour photo_url en base.
 *
 * Députés  : assemblee-nationale.fr/dyn/static/tribun/17/photos/carre/{id_sans_PA}.jpg
 * Sénateurs: senat.fr/senimg/{nom}_{prenom}{matricule}_carre.jpg
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

function slugSenat(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function photoUrl(id, prenom, nom) {
  if (id.startsWith('SEN_')) {
    const mat = id.replace('SEN_', '').toLowerCase()
    return `https://www.senat.fr/senimg/${slugSenat(nom)}_${slugSenat(prenom)}${mat}_carre.jpg`
  }
  const num = id.replace('PA', '')
  return `https://www.assemblee-nationale.fr/dyn/static/tribun/17/photos/carre/${num}.jpg`
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
  const srcUrl = photoUrl(id, prenom, nom)

  try {
    const res = await fetch(srcUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*,*/*' },
      redirect: 'follow',
    })

    const ct = res.headers.get('content-type') ?? ''
    if (!res.ok || !ct.startsWith('image/')) {
      skip++
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
      continue
    }

    const { data: { publicUrl } } = supabase.storage.from('photos').getPublicUrl(path)
    updates.push({ id, photo_url: publicUrl })
    ok++
    if (ok % 50 === 0) console.log(`  ✓ ${ok} photos uploadées…`)
  } catch (e) {
    skip++
  }
}

console.log(`\n  Photos : ${ok} OK, ${skip} sans photo (fallback initiales)`)

// ── 4. Mettre à jour photo_url en base (UPDATE uniquement, pas INSERT) ──────
console.log('\nMise à jour photo_url en base…')
const BATCH = 50
for (let i = 0; i < updates.length; i += BATCH) {
  const batch = updates.slice(i, i + BATCH)
  await Promise.all(batch.map(({ id, photo_url }) =>
    supabase.from('parlementaires').update({ photo_url }).eq('id', id)
  ))
  if ((i + BATCH) % 200 === 0 || i + BATCH >= updates.length) {
    console.log(`  ✓ ${Math.min(i + BATCH, updates.length)}/${updates.length}`)
  }
}

console.log('\n✅ Photos uploadées et URLs mises à jour.')
