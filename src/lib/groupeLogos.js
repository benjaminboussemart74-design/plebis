import logoLFI  from '../assets/Logos/Groupe_La_France_insoumise_Logo.png'
import logoSOC  from '../assets/Logos/Groupe-SER.png'
import logoEcoS from '../assets/Logos/GroupeÉcologiste.jpg'
import logoLIOT from '../assets/Logos/LIOT_Group.png'
import logoEPR  from '../assets/Logos/Groupe_Renaissance.png'
import logoHOR  from '../assets/Logos/Horizons_Group.png'
import logoLR   from '../assets/Logos/Groupe_Les_Républicains_An.png'
import logoRN   from '../assets/Logos/Groupe_Rassemblement_national.png'
import logoUDR  from '../assets/Logos/UDR_group_logo.png'
import logoDR   from '../assets/Logos/La_Droite_Républicaine_logo_2024.png'
import logoDem  from '../assets/Logos/groupe modem assemblée.png'
// Sénat
import logoCRC  from '../assets/Logos/CRCE-K logo sénat.webp'
import logoGEST from '../assets/Logos/Groupe écologistes logo sénat.webp'
import logoRDPI from '../assets/Logos/Sénat logo RDPI.webp'
import logoRDSE from '../assets/Logos/RDSE logo sénat.webp'
import logoRTLI from '../assets/Logos/Les indépendant logo sénat.webp'
import logoUC   from '../assets/Logos/Sénat logo union centriste.webp'
import logoLRSen from '../assets/Logos/Sénat logo les républicains.webp'
import logoNI   from '../assets/Logos/Réunion admin logo sénat.webp'
const LOGOS = {
  // Assemblée nationale
  'LFI-NFP': logoLFI,
  'SOC':     logoSOC,
  'EcoS':    logoEcoS,
  'LIOT':    logoLIOT,
  'EPR':     logoEPR,
  'HOR':     logoHOR,
  'LR':      logoLR,
  'RN':      logoRN,
  'UDR':     logoUDR,
  'DR':      logoDR,
  'Dem':     logoDem,
  // Sénat
  'CRC':     logoCRC,
  'GEST':    logoGEST,
  'LREM':    logoRDPI,
  'RDSE':    logoRDSE,
  'RTLI':    logoRTLI,
  'UC':      logoUC,
  'UMP':     logoLRSen,  // Sénat LR (sigle legacy — sera 'LR' après migration BDD)
  'NI':      logoNI,
}

/**
 * Retourne l'URL du logo pour un sigle de groupe, ou null si inconnu.
 * Essai exact puis préfixe (ex: 'LFI-NFP-XX' → logoLFI).
 */
export function getGroupeLogo(sigle) {
  if (!sigle) return null
  if (LOGOS[sigle]) return LOGOS[sigle]
  for (const key of Object.keys(LOGOS)) {
    if (sigle.startsWith(key)) return LOGOS[key]
  }
  return null
}
