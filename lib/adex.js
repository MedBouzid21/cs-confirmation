// Client API REST Adex (https://my.adex.tn/api-documentation)
const BASE = 'https://my.adex.tn/api/rest/StColis';
const USER = process.env.ADEX_USER || '';
const PASS = process.env.ADEX_TOKEN || '';

// code_etat Adex -> statut de l'app
const ETAT_TO_STATUS = { 0: 'confirmee', 1: 'en_livraison', 2: 'en_livraison', 3: 'en_livraison', 4: 'retour', 5: 'livree', 6: 'retour' };

async function call(endpoint, body = {}) {
  const res = await fetch(`${BASE}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ Utilisateur: USER, Pass: PASS, ...body }),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('Réponse Adex illisible (' + res.status + ')'); }
  if (data.result_type === 'erreur') {
    const c = data.result_content;
    const msg = typeof c === 'string' ? c : (c && (c.message || JSON.stringify(c))) || '';
    throw new Error('Adex : ' + (data.result_code || '') + (msg ? ' — ' + msg : ''));
  }
  return data.result_content;
}

let villesCache = null;
async function listVilles() {
  if (villesCache && villesCache.exp > Date.now()) return villesCache.data;
  const raw = await call('listVilles');
  // Normalise en [{ gouvernorat, villes:[nom] }] quelle que soit la forme exacte
  const map = new Map();
  (Array.isArray(raw) ? raw : raw.gouvernorats || raw.list || []).forEach((g) => {
    const gName = g.gouvernorat && typeof g.gouvernorat === 'string' ? g.gouvernorat : g.nom;
    if (!gName) return;
    if (!map.has(gName)) map.set(gName, new Set());
    const set = map.get(gName);
    if (Array.isArray(g.villes) && g.villes.length) g.villes.forEach((v) => set.add(v.nom || v));
    else if (g.nom && g.nom !== gName) set.add(g.nom);
  });
  const data = [...map.entries()]
    .map(([gouvernorat, s]) => ({ gouvernorat, villes: [...s].sort((a, b) => a.localeCompare(b, 'fr')) }))
    .sort((a, b) => a.gouvernorat.localeCompare(b.gouvernorat, 'fr'));
  villesCache = { data, exp: Date.now() + 12 * 3600 * 1000 };
  return data;
}

function createColis(p) {
  return call('AjouterVColis', {
    reference: p.reference,
    client: p.client,
    adresse: p.adresse,
    ville: p.ville,
    gouvernorat: p.gouvernorat,
    nb_pieces: Number(p.nb_pieces) || 1,
    prix: Number(p.prix),
    tel1: p.tel1,
    tel2: p.tel2 || '',
    designation: p.designation,
    commentaire: p.commentaire || '',
    type: process.env.ADEX_TYPE || 'FIX',
    fragile: p.fragile ? 1 : 0,
    autorisation_ouv: p.autorisation_ouv ? 1 : 0,
  });
}

async function listColis(codes) {
  const out = [];
  for (let i = 0; i < codes.length; i += 50) {
    const r = await call('ListColis', { codeBar: codes.slice(i, i + 50).join(';') });
    out.push(...((r && r.colis) || []));
  }
  return out;
}

const deleteColis = (code) => call('supprimerColis', { codeBar: code });
const historique = (code) => call('historiqueColis', { codeBar: code });
const demanderEnlevement = () => call('demanderEnlevement');

async function printColis(code) {
  const url = `${BASE}/printColis/${encodeURIComponent(code)}?Utilisateur=${encodeURIComponent(USER)}&Pass=${encodeURIComponent(PASS)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Bon de livraison indisponible (' + res.status + ')');
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { ETAT_TO_STATUS, listVilles, createColis, listColis, deleteColis, historique, demanderEnlevement, printColis, configured: () => !!(USER && PASS) };
