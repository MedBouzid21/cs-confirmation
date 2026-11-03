const express = require('express');
const crypto = require('crypto');
const path = require('path');

const MOCK = process.env.MOCK === '1';
const shopify = MOCK ? require('./lib/mock').shopify : require('./lib/shopify');
const adex = MOCK ? require('./lib/mock').adex : require('./lib/adex');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const AGENT_PASSWORD = process.env.AGENT_PASSWORD || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const STORE_NAME = process.env.STORE_NAME || 'Clean Squad';

const app = express();
app.use(express.json({ limit: '200kb' }));
app.disable('x-powered-by');

// ---------- Session (cookie signé, sans dépendance) ----------
function sign(v) { return v + '.' + crypto.createHmac('sha256', SECRET).update(v).digest('base64url'); }
function unsign(s) {
  if (!s) return null;
  const i = s.lastIndexOf('.'); if (i < 0) return null;
  const v = s.slice(0, i);
  const a = Buffer.from(sign(v)); const b = Buffer.from(s);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? v : null;
}
function getCookie(req, name) {
  const m = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
function session(req) {
  const v = unsign(getCookie(req, 'cs_sess'));
  if (!v) return null;
  const [role, agent, exp] = v.split('|');
  if (Number(exp) < Date.now()) return null;
  return { role, agent };
}
function auth(req, res, next) {
  const s = session(req);
  if (!s) return res.status(401).json({ error: 'Session expirée, reconnecte-toi.' });
  req.user = s; next();
}
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

app.post('/api/login', (req, res) => {
  const { password = '', name = '' } = req.body || {};
  let role = null;
  if (ADMIN_PASSWORD && safeEq(String(password), ADMIN_PASSWORD)) role = 'admin';
  else if (AGENT_PASSWORD && safeEq(String(password), AGENT_PASSWORD)) role = 'agent';
  if (!role) return res.status(401).json({ error: 'Mot de passe incorrect' });
  const agent = String(name).trim().slice(0, 30).replace(/[|]/g, '') || (role === 'admin' ? 'Admin' : 'Agent');
  const exp = Date.now() + 30 * 86400000;
  res.setHeader('Set-Cookie', `cs_sess=${encodeURIComponent(sign(`${role}|${agent}|${exp}`))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  res.json({ ok: true, role, agent });
});
app.post('/api/logout', (req, res) => { res.setHeader('Set-Cookie', 'cs_sess=; Path=/; Max-Age=0'); res.json({ ok: true }); });
app.get('/api/me', (req, res) => {
  const s = session(req);
  res.json({ user: s, store: STORE_NAME, mock: MOCK, adex: adex.configured(), shopify: shopify.configured(), statuses: shopify.STATUSES });
});

// ---------- Helpers ----------
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(400).json({ error: e.message || 'Erreur' }); });
function tel8(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('00216')) d = d.slice(5); else if (d.startsWith('216') && d.length === 11) d = d.slice(3);
  return d.slice(-8);
}
// Agent : 1 DT par commande confirmée, 2 DT si le panier contient le Pack Complet
const isPackComplet = (i) => /complet/i.test(i.title) && !/int[ée]rieur/i.test(i.variant || '');
const commission = (o) => (o.items.some(isPackComplet) ? 2 : 1);

// Synchronisation des statuts Adex -> Shopify (au plus toutes les 2 minutes)
let lastSync = 0;
let syncing = null;
async function syncAdex(orders) {
  if (!adex.configured() || Date.now() - lastSync < 120000) return;
  if (syncing) return syncing;
  syncing = (async () => {
    const watch = orders.filter((o) => o.adexCode && ['confirmee', 'en_livraison'].includes(o.status));
    if (!watch.length) return;
    const colis = await adex.listColis(watch.map((o) => o.adexCode));
    for (const c of colis) {
      const o = watch.find((x) => x.adexCode === (c.code || c.code_barres));
      if (!o) continue;
      const st = adex.ETAT_TO_STATUS[Number(c.code_etat)];
      const etat = c.etat || '';
      if (st && st !== o.status) {
        await shopify.setStatus(o, st, { by: 'Adex', note: etat, extra: { adex_etat: etat } });
        o.status = st; o.statusLabel = shopify.STATUSES[st]; o.adexEtat = etat;
      } else if (etat && etat !== o.adexEtat) {
        await shopify.setMeta(o.id, { adex_etat: etat });
        o.adexEtat = etat;
      }
    }
  })().catch((e) => console.error('Sync Adex :', e.message)).finally(() => { lastSync = Date.now(); syncing = null; });
  return syncing;
}

// ---------- API ----------
app.get('/api/orders', auth, wrap(async (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 120);
  let orders = await shopify.listOrders({ days });
  if (req.query.sync !== '0') { await syncAdex(orders); }
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const confirmedToday = orders.filter((o) => o.confirmedAt && o.confirmedAt.slice(0, 10) === today);
  const confirmedMonth = orders.filter((o) => o.confirmedAt && o.confirmedAt.slice(0, 7) === month && o.status !== 'annulee');
  const delivered = orders.filter((o) => o.status === 'livree').length;
  const returned = orders.filter((o) => o.status === 'retour').length;
  res.json({
    orders,
    stats: {
      confirmedToday: confirmedToday.length,
      commissionToday: confirmedToday.reduce((s, o) => s + commission(o), 0),
      commissionMonth: confirmedMonth.reduce((s, o) => s + commission(o), 0),
      deliveryRate: delivered + returned ? Math.round((delivered / (delivered + returned)) * 100) : null,
    },
  });
}));

app.get('/api/villes', auth, wrap(async (req, res) => res.json(await adex.listVilles())));

// Changer le statut (tentative, annulation, statut manuel)
app.post('/api/orders/:id/status', auth, wrap(async (req, res) => {
  const id = 'gid://shopify/Order/' + req.params.id;
  const order = await shopify.getOrder(id);
  const { status, note = '' } = req.body || {};
  if (!shopify.STATUSES[status]) throw new Error('Statut inconnu');
  if (status === 'confirmee' && !order.adexCode && adex.configured() && !req.body.force) {
    throw new Error('Utilise le bouton « Confirmer » pour créer le colis Adex.');
  }
  // Annulation : on supprime le colis Adex s'il est encore « En attente »
  if (status === 'annulee' && order.adexCode) {
    try { await adex.deleteColis(order.adexCode); } catch (e) {
      if (!req.body.force) throw new Error(e.message + ' — le colis est peut-être déjà enlevé. Annule-le chez Adex.');
    }
  }
  await shopify.setStatus(order, status, { by: req.user.agent, note });
  res.json({ ok: true });
}));

// Confirmer + créer le colis Adex
app.post('/api/orders/:id/confirm', auth, wrap(async (req, res) => {
  const id = 'gid://shopify/Order/' + req.params.id;
  const order = await shopify.getOrder(id);
  if (order.adexCode) throw new Error('Cette commande a déjà un colis Adex (' + order.adexCode + ').');
  const b = req.body || {};
  const tel1 = tel8(b.tel1);
  if (!/^\d{8}$/.test(tel1)) throw new Error('Le téléphone doit contenir 8 chiffres.');
  for (const [k, label] of [['client', 'Nom'], ['adresse', 'Adresse'], ['gouvernorat', 'Gouvernorat'], ['ville', 'Délégation'], ['designation', 'Désignation']]) {
    if (!String(b[k] || '').trim()) throw new Error(label + ' obligatoire.');
  }
  const prix = Number(b.prix);
  if (!Number.isFinite(prix) || prix < 0) throw new Error('Prix invalide.');
  let colis = null;
  if (adex.configured() && b.send !== false) {
    colis = await adex.createColis({
      reference: order.name.replace('#', ''), client: b.client.trim(), adresse: b.adresse.trim(),
      ville: b.ville, gouvernorat: b.gouvernorat, nb_pieces: b.nb_pieces || 1, prix,
      tel1, tel2: tel8(b.tel2) || '', designation: String(b.designation).slice(0, 250),
      commentaire: String(b.commentaire || '').slice(0, 250), fragile: !!b.fragile, autorisation_ouv: !!b.autorisation_ouv,
    });
  }
  const code = colis ? String(colis.num_suivi_cmd || colis.code || '') : '';
  await shopify.setStatus(order, 'confirmee', {
    by: req.user.agent, note: b.note || '',
    extra: code ? { adex_code: code, adex_etat: colis.etat_cmd || 'En Attente' } : {},
  });
  res.json({ ok: true, code, warning: colis && colis.avertissement ? colis.avertissement.message : null });
}));

app.get('/api/orders/:id/adex-historique', auth, wrap(async (req, res) => {
  const order = await shopify.getOrder('gid://shopify/Order/' + req.params.id);
  if (!order.adexCode) throw new Error('Pas de colis Adex');
  res.json(await adex.historique(order.adexCode));
}));

app.get('/api/adex/bl/:code', auth, wrap(async (req, res) => {
  const pdf = await adex.printColis(req.params.code);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="BL-${req.params.code}.pdf"`);
  res.send(pdf);
}));

app.post('/api/adex/enlevement', auth, wrap(async (req, res) => res.json(await adex.demanderEnlevement())));

app.get('/healthz', (req, res) => res.send('ok'));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`Confirmation ${STORE_NAME} sur le port ${PORT}${MOCK ? ' (MODE DÉMO)' : ''}`);
  if (!AGENT_PASSWORD) console.warn('⚠ AGENT_PASSWORD non défini : personne ne peut se connecter.');
});
