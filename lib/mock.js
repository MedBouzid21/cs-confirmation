// Mode démo (MOCK=1) : fausses commandes et faux Adex, pour tester l'app sans clés.
const { STATUSES } = { STATUSES: {
  nouveau: 'Nouveau', tentative1: 'Tentative 1', tentative2: 'Tentative 2', confirmee: 'Confirmée',
  en_livraison: 'En livraison', livree: 'Livrée', retour: 'En retour', annulee: 'Annulée' } };

const names = ['Ahmed Ben Ali', 'Sami Trabelsi', 'Yassine Gharbi', 'Mohamed Jlassi', 'Amine Bouzid', 'Karim Hammami', 'Nour Mansour', 'Wael Chaabane', 'Hamza Ayari', 'Fares Mejri'];
const cities = [['Sfax', 'Sfax Ville'], ['Tunis', 'La Marsa'], ['Sousse', 'Sousse Ville'], ['Nabeul', 'Hammamet'], ['Ariana', 'Ariana Ville'], ['Monastir', 'Monastir']];
const products = [['Pack Lavage Express', 89], ['Pack Intérieur', 89], ['Pack Nettoyage Complet Voiture 8 en 1', 129], ['Pack Jantes & Pneus', 45], ['Nettoyant Vitres', 19]];

const orders = [];
const statuses = ['nouveau', 'nouveau', 'nouveau', 'tentative1', 'nouveau', 'tentative2', 'confirmee', 'en_livraison', 'livree', 'retour', 'annulee', 'nouveau'];
for (let i = 0; i < 12; i++) {
  const [title, price] = products[i % products.length];
  const [prov, city] = cities[i % cities.length];
  const st = statuses[i];
  orders.push({
    id: 'gid://shopify/Order/' + (1000 + i), name: '#' + (1100 + i),
    createdAt: new Date(Date.now() - i * 3.5 * 3600000).toISOString(),
    status: st, statusLabel: STATUSES[st], total: price + (price < 79 ? 7 : 0), currency: 'TND',
    customer: names[i % names.length], phone: '+216 2' + String(1000000 + i * 7311).slice(0, 7),
    address: (12 + i) + ' rue de la République', city, province: prov, zip: '', note: i === 2 ? 'Appeler après 17h' : '',
    items: [{ title, variant: '', qty: 1, contents: require('./packs').packContents(title, ''), props: title.startsWith('Pack') && price > 50 ? [{ key: 'Parfum offert', value: 'Red Rush (Framboise)' }] : [] }],
    adexCode: ['confirmee', 'en_livraison', 'livree', 'retour'].includes(st) ? 'ADX' + (900000 + i) : '',
    adexEtat: '', confirmedAt: ['confirmee', 'en_livraison', 'livree', 'retour'].includes(st) ? new Date().toISOString() : '',
    history: [], tags: [],
  });
}

const shopify = {
  STATUSES,
  configured: () => true,
  async listOrders() { return orders.map((o) => ({ ...o })); },
  async getOrder(id) { const o = orders.find((x) => x.id === id); if (!o) throw new Error('Commande introuvable'); return { ...o }; },
  async setStatus(order, status, { by = 'agent', note = '', extra = {} } = {}) {
    const o = orders.find((x) => x.id === order.id);
    o.status = status; o.statusLabel = STATUSES[status];
    o.history = (o.history || []).concat([{ at: new Date().toISOString(), status, by, note }]);
    if (status === 'confirmee' && !o.confirmedAt) o.confirmedAt = new Date().toISOString();
    if (extra.adex_code !== undefined) o.adexCode = extra.adex_code;
    if (extra.adex_etat !== undefined) o.adexEtat = extra.adex_etat;
  },
  async setMeta(id, fields) {
    const o = orders.find((x) => x.id === id);
    if (fields.adex_code !== undefined) o.adexCode = fields.adex_code;
    if (fields.adex_etat !== undefined) o.adexEtat = fields.adex_etat;
  },
};

let seq = 1;
const adex = {
  ETAT_TO_STATUS: { 0: 'confirmee', 1: 'en_livraison', 2: 'en_livraison', 3: 'en_livraison', 4: 'retour', 5: 'livree', 6: 'retour' },
  configured: () => true,
  async listVilles() {
    return [
      { gouvernorat: 'Ariana', villes: ['Ariana Ville', 'La Soukra', 'Raoued'] },
      { gouvernorat: 'Monastir', villes: ['Monastir', 'Ksar Hellal', 'Moknine'] },
      { gouvernorat: 'Nabeul', villes: ['Hammamet', 'Nabeul', 'Kelibia'] },
      { gouvernorat: 'Sfax', villes: ['Sfax Ville', 'Sakiet Ezzit', 'Sfax Sud'] },
      { gouvernorat: 'Sousse', villes: ['Sousse Ville', 'Hammam Sousse', 'Msaken'] },
      { gouvernorat: 'Tunis', villes: ['La Marsa', 'Le Bardo', 'Tunis Ville'] },
    ];
  },
  async createColis(p) {
    if (!/^\d{8}$/.test(p.tel1)) throw new Error('Adex : tel_incorrect — le téléphone doit avoir 8 chiffres');
    return { num_suivi_cmd: 'ADX' + (100000 + seq++), etat_cmd: 'En Attente', code_etat_cmd: 0, url_bl: '' };
  },
  async listColis(codes) { return codes.map((c, i) => ({ code: c, etat: ['En Attente', 'En Cours de Livraison', 'Livré', 'Retour Expéditeur'][i % 4], code_etat: [0, 3, 5, 6][i % 4] })); },
  async deleteColis() { return { ok: true }; },
  async historique(code) { return { code_barres: code, historique: [{ date_formatee: 'Aujourd\'hui 10:12', action: 'Colis créé', agent: 'Clean Squad' }] }; },
  async demanderEnlevement() { return { url: '' }; },
  async printColis() { throw new Error('Pas de PDF en mode démo'); },
};

module.exports = { shopify, adex };
