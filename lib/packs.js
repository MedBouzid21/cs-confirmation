// Contenu des packs (affiché à l'agent et envoyé à Adex dans la désignation).
// Pour modifier un pack : change la liste ici, puis redéploie.
const PACKS = [
  {
    match: (t, v) => /complet/i.test(t) && /int[ée]rieur/i.test(v || ''),
    contents: ['Nettoyant Intérieur 400 ml', 'Rénovateur Tableau de bord 250 ml', 'Nettoyant Vitres 250 ml', 'Microfibre', 'Parfum 100 ml offert'],
  },
  {
    match: (t) => /complet/i.test(t),
    contents: ['Shampoing 400 ml', 'Nettoyant Jantes 400 ml', 'Nettoyant Vitres 250 ml', 'Rénovateur Tableau de bord 250 ml', 'Nettoyant Intérieur 400 ml', 'Brillance 250 ml', 'Rénovateur Pneus 250 ml', 'Microfibre', 'Parfum 100 ml offert'],
  },
  {
    match: (t) => /lavage/i.test(t),
    contents: ['Shampoing 400 ml', 'Brillance 250 ml', 'Rénovateur Pneus 250 ml', 'Microfibre', 'Parfum 100 ml offert'],
  },
  {
    match: (t) => /pack.*int[ée]rieur|int[ée]rieur.*pack/i.test(t),
    contents: ['Nettoyant Intérieur 400 ml', 'Rénovateur Tableau de bord 250 ml', 'Nettoyant Vitres 250 ml', 'Microfibre', 'Parfum 100 ml offert'],
  },
  {
    match: (t) => /jantes/i.test(t) && /pneus/i.test(t),
    contents: ['Nettoyant Jantes 400 ml', 'Rénovateur Pneus 250 ml'],
  },
];

function packContents(title, variant) {
  if (!/pack/i.test(title)) return null;
  const p = PACKS.find((x) => x.match(title, variant));
  return p ? p.contents : null;
}

module.exports = { packContents };
