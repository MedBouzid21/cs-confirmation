// Accès Shopify Admin GraphQL. Les statuts de confirmation sont stockés
// directement dans Shopify (tags + métachamps de la commande) : l'app n'a
// pas de base de données, rien n'est perdu si le serveur redémarre.

const SHOP = (process.env.SHOPIFY_SHOP || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-10';
const STATUS_PREFIX = 'cs-statut:';

const STATUSES = {
  nouveau: 'Nouveau',
  tentative1: 'Tentative 1',
  tentative2: 'Tentative 2',
  confirmee: 'Confirmée',
  en_livraison: 'En livraison',
  livree: 'Livrée',
  retour: 'En retour',
  annulee: 'Annulée',
};

let cachedToken = null; // { token, exp }

async function getToken() {
  if (process.env.SHOPIFY_ADMIN_TOKEN) return process.env.SHOPIFY_ADMIN_TOKEN;
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  // App créée dans le Dev Dashboard : jeton via client credentials (valable ~24 h)
  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.SHOPIFY_CLIENT_ID || '',
      client_secret: process.env.SHOPIFY_CLIENT_SECRET || '',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error('Connexion Shopify impossible : vérifie SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET (' + res.status + ')');
  }
  cachedToken = { token: data.access_token, exp: Date.now() + (data.expires_in || 86399) * 1000 };
  return cachedToken.token;
}

async function gql(query, variables = {}) {
  const token = await getToken();
  const res = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.errors) {
    const msg = data.errors ? JSON.stringify(data.errors).slice(0, 300) : res.status;
    throw new Error('Erreur Shopify : ' + msg);
  }
  return data.data;
}

const ORDER_FIELDS = `
  id name createdAt cancelledAt tags note phone email
  displayFinancialStatus displayFulfillmentStatus
  totalPriceSet { shopMoney { amount currencyCode } }
  shippingAddress { name firstName lastName address1 address2 city province zip phone }
  billingAddress { phone }
  lineItems(first: 30) { nodes { title variantTitle quantity customAttributes { key value } } }
  adex: metafield(namespace: "cs", key: "adex_code") { value }
  adexEtat: metafield(namespace: "cs", key: "adex_etat") { value }
  history: metafield(namespace: "cs", key: "history") { value }
  confirmedAt: metafield(namespace: "cs", key: "confirmed_at") { value }
`;

function parseOrder(o) {
  const tag = (o.tags || []).find((t) => t.startsWith(STATUS_PREFIX));
  let status = tag ? tag.slice(STATUS_PREFIX.length) : 'nouveau';
  if (!STATUSES[status]) status = 'nouveau';
  if (o.cancelledAt && status === 'nouveau') status = 'annulee';
  const a = o.shippingAddress || {};
  const phone =
    a.phone || o.phone || 
    (o.billingAddress && o.billingAddress.phone) || '';
  let history = [];
  try { history = o.history ? JSON.parse(o.history.value) : []; } catch (e) { history = []; }
  return {
    id: o.id,
    name: o.name,
    createdAt: o.createdAt,
    status,
    statusLabel: STATUSES[status],
    total: Number(o.totalPriceSet.shopMoney.amount),
    currency: o.totalPriceSet.shopMoney.currencyCode,
    customer: a.name || [a.firstName, a.lastName].filter(Boolean).join(' ') || 'Client',
    phone,
    address: [a.address1, a.address2].filter(Boolean).join(', '),
    city: a.city || '',
    province: a.province || '',
    zip: a.zip || '',
    note: o.note || '',
    items: (o.lineItems.nodes || []).map((li) => ({
      title: li.title,
      variant: li.variantTitle && li.variantTitle !== 'Default Title' ? li.variantTitle : '',
      qty: li.quantity,
      props: (li.customAttributes || []).filter((p) => !p.key.startsWith('_')),
    })),
    adexCode: o.adex ? o.adex.value : '',
    adexEtat: o.adexEtat ? o.adexEtat.value : '',
    confirmedAt: o.confirmedAt ? o.confirmedAt.value : '',
    history,
    tags: o.tags || [],
  };
}

async function listOrders({ days = 30, max = 250 } = {}) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const out = [];
  let after = null;
  while (out.length < max) {
    const d = await gql(
      `query($q:String!,$after:String){ orders(first:50, after:$after, sortKey:CREATED_AT, reverse:true, query:$q){
        nodes { ${ORDER_FIELDS} } pageInfo { hasNextPage endCursor } } }`,
      { q: `created_at:>=${since}`, after }
    );
    // Avant la date de lancement, on ignore les anciennes commandes jamais traitées dans l'app
    const launch = process.env.LAUNCH_DATE || '';
    out.push(...d.orders.nodes.map(parseOrder).filter((o) => !launch || o.createdAt >= launch || o.tags.some((t) => t.startsWith(STATUS_PREFIX))));
    if (!d.orders.pageInfo.hasNextPage) break;
    after = d.orders.pageInfo.endCursor;
  }
  return out;
}

async function getOrder(id) {
  const d = await gql(`query($id:ID!){ order(id:$id){ ${ORDER_FIELDS} } }`, { id });
  if (!d.order) throw new Error('Commande introuvable');
  return parseOrder(d.order);
}

// Change le statut : un seul tag "cs-statut:*" à la fois + historique.
async function setStatus(order, status, { by = 'agent', note = '', extra = {} } = {}) {
  if (!STATUSES[status]) throw new Error('Statut inconnu');
  const oldTags = order.tags.filter((t) => t.startsWith(STATUS_PREFIX));
  if (oldTags.length) {
    const r = await gql(
      `mutation($id:ID!,$tags:[String!]!){ tagsRemove(id:$id, tags:$tags){ userErrors{ message } } }`,
      { id: order.id, tags: oldTags }
    );
    const e = r.tagsRemove.userErrors; if (e.length) throw new Error(e[0].message);
  }
  const r2 = await gql(
    `mutation($id:ID!,$tags:[String!]!){ tagsAdd(id:$id, tags:$tags){ userErrors{ message } } }`,
    { id: order.id, tags: [STATUS_PREFIX + status] }
  );
  if (r2.tagsAdd.userErrors.length) throw new Error(r2.tagsAdd.userErrors[0].message);

  const history = (order.history || []).concat([{ at: new Date().toISOString(), status, by, note }]).slice(-40);
  const fields = { history: JSON.stringify(history), ...extra };
  if (status === 'confirmee' && !order.confirmedAt) fields.confirmed_at = new Date().toISOString();
  await setMeta(order.id, fields);
}

async function setMeta(ownerId, fields) {
  const metafields = Object.entries(fields).map(([key, value]) => ({
    ownerId, namespace: 'cs', key,
    type: key === 'history' ? 'json' : 'single_line_text_field',
    value: String(value),
  }));
  if (!metafields.length) return;
  const r = await gql(
    `mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){ userErrors{ field message } } }`,
    { m: metafields }
  );
  if (r.metafieldsSet.userErrors.length) throw new Error(r.metafieldsSet.userErrors[0].message);
}

module.exports = { STATUSES, listOrders, getOrder, setStatus, setMeta, configured: () => !!SHOP };
