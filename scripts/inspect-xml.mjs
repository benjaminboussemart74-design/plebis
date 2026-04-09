import 'dotenv/config'
import { createReadStream, existsSync } from 'fs'
import { execFileSync } from 'child_process'
import unzipper from 'unzipper'
import { XMLParser } from 'fast-xml-parser'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (name) => ['point','paragraphe','alinea','texte'].includes(name),
})

const TMP = process.env.TEMP || '/tmp'
const zipPath = TMP.replace(/\//g,'\\') + '\\syseron.xml.zip'
const CR_URL = 'https://data.assemblee-nationale.fr/static/openData/repository/17/vp/syceronbrut/syseron.xml.zip'

if (!existsSync(zipPath)) {
  console.log('Téléchargement…')
  execFileSync('curl.exe', ['-L', '-A', 'Mozilla/5.0', '--retry', '3', '-o', zipPath, CR_URL], { stdio: 'inherit' })
}

let count = 0
const stream = createReadStream(zipPath).pipe(unzipper.Parse({ forceStream: true }))
for await (const entry of stream) {
  if (entry.path.endsWith('.xml') && count < 1) {
    const buf = await entry.buffer()
    const root = parser.parse(buf.toString('utf8'))
    const cr = root.compteRendu || Object.values(root)[0]

    console.log('=== METADONNEES ===')
    console.log(JSON.stringify(cr.metadonnees, null, 2))

    const points = cr.contenu?.point
    if (points) {
      const p0 = Array.isArray(points) ? points[0] : points
      console.log('\n=== POINT[0] keys ===', Object.keys(p0))
      console.log('attrs:', JSON.stringify(Object.entries(p0).filter(([k]) => k.startsWith('@_'))))
      if (p0.titre !== undefined) console.log('titre:', JSON.stringify(p0.titre))
      if (p0.objet !== undefined) console.log('objet:', JSON.stringify(p0.objet))

      if (p0.point) {
        const sub = Array.isArray(p0.point) ? p0.point : [p0.point]
        for (const s of sub.slice(0, 3)) {
          console.log('\n--- sous-point keys:', Object.keys(s))
          console.log('attrs:', JSON.stringify(Object.entries(s).filter(([k]) => k.startsWith('@_'))))
          if (s.titre !== undefined) console.log('titre:', JSON.stringify(s.titre))
          if (s.objet !== undefined) console.log('objet:', JSON.stringify(s.objet))
          if (s.point) {
            const sub2 = Array.isArray(s.point) ? s.point[0] : s.point
            console.log('  sub2 keys:', Object.keys(sub2))
            if (sub2.titre !== undefined) console.log('  sub2 titre:', JSON.stringify(sub2.titre))
            if (sub2.objet !== undefined) console.log('  sub2 objet:', JSON.stringify(sub2.objet))
          }
        }
      }
    }
    count++
  } else {
    entry.autodrain()
  }
  if (count >= 1) break
}
