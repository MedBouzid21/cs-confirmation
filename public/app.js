(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var state = { orders: [], tab: 'todo', q: '', statuses: {}, me: null, adex: false, villes: null, loading: false };

  var TABS = [
    { id: 'todo', label: 'À confirmer', match: ['nouveau', 'tentative1', 'tentative2'] },
    { id: 'confirmee', label: 'Confirmées', match: ['confirmee'] },
    { id: 'en_livraison', label: 'En livraison', match: ['en_livraison'] },
    { id: 'livree', label: 'Livrées', match: ['livree'] },
    { id: 'retour', label: 'Retours', match: ['retour'] },
    { id: 'annulee', label: 'Annulées', match: ['annulee'] },
    { id: 'all', label: 'Toutes', match: null },
  ];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, ''); }
  function dt(n) { return (Math.round(n * 1000) / 1000).toString().replace('.', ',') + ' DT'; }
  function tel8(p) { var d = String(p || '').replace(/\D/g, ''); if (d.indexOf('00216') === 0) d = d.slice(5); else if (d.indexOf('216') === 0 && d.length === 11) d = d.slice(3); return d.slice(-8); }
  function ago(iso) {
    var m = Math.round((Date.now() - new Date(iso)) / 60000);
    if (m < 1) return "à l'instant"; if (m < 60) return 'il y a ' + m + ' min';
    var h = Math.round(m / 60); if (h < 24) return 'il y a ' + h + ' h';
    var d = new Date(iso); return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  function numId(gid) { return String(gid).split('/').pop(); }

  async function api(url, opts) {
    opts = opts || {};
    var res = await fetch(url, { method: opts.method || 'GET', headers: opts.body ? { 'Content-Type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' });
    var data = await res.json().catch(function () { return {}; });
    if (res.status === 401 && url !== '/api/login') { showLogin(); throw new Error(data.error || 'Session expirée'); }
    if (!res.ok) throw new Error(data.error || 'Erreur ' + res.status);
    return data;
  }

  var toastT;
  function toast(msg, err) {
    var t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, err ? 5000 : 2600);
  }

  // ---------- Connexion ----------
  function showLogin() { $('#app').hidden = true; $('#login').hidden = false; closeSheet(); }
  $('#loginForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var f = e.target, btn = f.querySelector('button');
    btn.disabled = true; $('#loginErr').textContent = '';
    try {
      await api('/api/login', { method: 'POST', body: { name: f.name.value, password: f.password.value } });
      try { localStorage.setItem('cs_name', f.name.value); } catch (er) {}
      await boot();
    } catch (err) { $('#loginErr').textContent = err.message; }
    btn.disabled = false;
  });
  try { $('#loginForm').name.value = localStorage.getItem('cs_name') || ''; } catch (e) {}

  $('#menuBtn').addEventListener('click', function (e) {
    e.stopPropagation(); var m = $('#menu'); m.hidden = !m.hidden; this.setAttribute('aria-expanded', String(!m.hidden));
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('#menu')) $('#menu').hidden = true; });
  $('#logoutBtn').addEventListener('click', async function () { await api('/api/logout', { method: 'POST' }); showLogin(); });
  $('#pickupBtn').addEventListener('click', async function () {
    $('#menu').hidden = true;
    if (!confirm("Valider le manifeste et demander l'enlèvement de tous les colis « En attente » chez Adex ?")) return;
    try {
      var r = await api('/api/adex/enlevement', { method: 'POST' });
      var url = r && (r.url || r.url_manifeste || r.pdf);
      toast('Enlèvement demandé ✔');
      if (url) window.open(url, '_blank');
    } catch (err) { toast(err.message, true); }
  });
  $('#refreshBtn').addEventListener('click', function () { load(true); });

  // ---------- Données ----------
  async function boot() {
    var me = await api('/api/me');
    state.statuses = me.statuses; state.adex = me.adex;
    if (!me.user) return showLogin();
    state.me = me.user;
    $('#login').hidden = true; $('#app').hidden = false;
    $('#who').textContent = 'Connecté : ' + me.user.agent + (me.user.role === 'admin' ? ' (admin)' : '');
    var banner = [];
    if (me.mock) banner.push('Mode démo : commandes fictives, rien n’est envoyé à Shopify ni à Adex.');
    else if (!me.adex) banner.push('Adex non configuré : les confirmations ne créeront pas de colis.');
    $('#banner').textContent = banner.join(' '); $('#banner').hidden = !banner.length;
    await load();
  }

  async function load(manual) {
    if (state.loading) return;
    state.loading = true; $('#refreshBtn').classList.add('spin');
    try {
      var d = await api('/api/orders');
      state.orders = d.orders;
      $('#stToday').textContent = d.stats.confirmedToday;
      $('#stEarnToday').textContent = d.stats.commissionToday + ' DT';
      $('#stEarnMonth').textContent = d.stats.commissionMonth + ' DT';
      $('#stRate').textContent = d.stats.deliveryRate == null ? '—' : d.stats.deliveryRate + ' %';
      render();
      if (manual) toast('Commandes à jour');
    } catch (err) { toast(err.message, true); }
    state.loading = false; $('#refreshBtn').classList.remove('spin');
  }
  setInterval(function () { if (!document.hidden && !$('#app').hidden && $('#sheet').hidden) load(); }, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && !$('#app').hidden) load(); });

  // ---------- Affichage ----------
  function inTab(o, tab) { var t = TABS.find(function (x) { return x.id === tab; }); return !t.match || t.match.indexOf(o.status) > -1; }

  function render() {
    $('#tabs').innerHTML = TABS.map(function (t) {
      var n = state.orders.filter(function (o) { return inTab(o, t.id); }).length;
      return '<button class="tab" data-tab="' + t.id + '" aria-pressed="' + (state.tab === t.id) + '">' + t.label + (t.id !== 'all' ? ' <i>' + n + '</i>' : '') + '</button>';
    }).join('');
    var q = norm(state.q);
    var qd = state.q.replace(/\D/g, '');
    var list = state.orders.filter(function (o) {
      if (!inTab(o, state.tab)) return false;
      if (!q) return true;
      return norm(o.name + o.customer + o.city + o.province + o.address + o.adexCode).indexOf(q) > -1 || (qd.length >= 3 && o.phone.replace(/\D/g, '').indexOf(qd) > -1);
    });
    // À confirmer : la plus ancienne d'abord ; sinon la plus récente d'abord
    list.sort(function (a, b) { return state.tab === 'todo' ? new Date(a.createdAt) - new Date(b.createdAt) : new Date(b.createdAt) - new Date(a.createdAt); });
    $('#list').innerHTML = list.map(card).join('');
    $('#empty').hidden = list.length > 0;
  }

  function itemsHtml(o) {
    return o.items.map(function (i) {
      return '<p>' + i.qty + ' × ' + esc(i.title) + (i.variant ? ' — ' + esc(i.variant) : '') + '</p>' +
        (i.contents ? '<ul class="pack">' + i.contents.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>' : '') +
        i.props.map(function (p) { return '<small>' + esc(p.key) + ' : ' + esc(p.value) + '</small>'; }).join('');
    }).join('');
  }

  function card(o) {
    var id = numId(o.id), t8 = tel8(o.phone);
    var todo = ['nouveau', 'tentative1', 'tentative2'].indexOf(o.status) > -1;
    var actions = '';
    if (todo) {
      var next = o.status === 'nouveau' ? 'tentative1' : o.status === 'tentative1' ? 'tentative2' : null;
      actions = '<div class="card__actions">' +
        '<button class="btn btn--red wide" data-act="confirm" data-id="' + id + '">✔ Confirmer</button>' +
        (next ? '<button class="btn btn--line" data-act="status" data-st="' + next + '" data-id="' + id + '">Pas de réponse</button>' : '<button class="btn btn--line" data-act="status" data-st="annulee" data-note="Injoignable" data-id="' + id + '">Injoignable</button>') +
        '<button class="btn btn--ghost" data-act="status" data-st="annulee" data-id="' + id + '">✕ Annuler</button></div>';
    }
    return '<article class="card">' +
      '<div class="card__top" data-act="detail" data-id="' + id + '"><div><div class="card__name">' + esc(o.name) + '</div><div class="card__time">' + ago(o.createdAt) + '</div></div>' +
      '<div style="text-align:right"><span class="badge b-' + o.status + '">' + esc(o.statusLabel) + '</span><div class="card__total">' + dt(o.total) + '</div></div></div>' +
      '<div class="card__body" data-act="detail" data-id="' + id + '">' +
      '<p class="card__client">' + esc(o.customer) + '</p>' +
      '<p class="card__line">📍 ' + esc([o.address, o.city, o.province].filter(Boolean).join(', ') || 'Adresse manquante') + '</p>' +
      '<div class="card__items">' + itemsHtml(o) + '</div>' +
      (o.note ? '<p class="card__note">📝 ' + esc(o.note) + '</p>' : '') +
      (o.adexCode ? '<div class="adex">Adex <b>' + esc(o.adexCode) + '</b>' + (o.adexEtat ? ' · ' + esc(o.adexEtat) : '') + '</div>' : '') +
      '</div>' +
      (t8 ? '<div class="card__contact"><a class="btn btn--dark" href="tel:+216' + t8 + '">📞 ' + t8.replace(/(\d{2})(\d{3})(\d{3})/, '$1 $2 $3') + '</a>' +
        '<a class="btn btn--green" href="https://wa.me/216' + t8 + '" target="_blank" rel="noopener">WhatsApp</a></div>' : '<p class="card__line" style="padding:0 14px 10px;color:var(--red)">Pas de numéro</p>') +
      actions + '</article>';
  }

  $('#tabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]'); if (!b) return;
    state.tab = b.dataset.tab; render(); window.scrollTo({ top: 0 });
  });
  $('#search').addEventListener('input', function () { state.q = this.value; render(); });

  $('#list').addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]'); if (!el) return;
    var o = state.orders.find(function (x) { return numId(x.id) === el.dataset.id; }); if (!o) return;
    if (el.dataset.act === 'confirm') openConfirm(o);
    else if (el.dataset.act === 'detail') openDetail(o);
    else if (el.dataset.act === 'status') changeStatus(o, el.dataset.st, el.dataset.note || '', el);
  });

  async function changeStatus(o, st, note, btn, force) {
    if (st === 'annulee' && !force && !confirm('Annuler la commande ' + o.name + ' ?')) return;
    if (btn) btn.disabled = true;
    try {
      await api('/api/orders/' + numId(o.id) + '/status', { method: 'POST', body: { status: st, note: note, force: !!force } });
      o.status = st; o.statusLabel = state.statuses[st];
      toast(o.name + ' → ' + state.statuses[st]);
      closeSheet(); render(); load();
    } catch (err) {
      toast(err.message, true);
      if (st === 'annulee' && o.adexCode && confirm(err.message + '\n\nMarquer quand même comme annulée ?')) return changeStatus(o, st, note, btn, true);
    }
    if (btn) btn.disabled = false;
  }

  // ---------- Feuilles ----------
  function openSheet(title, html) {
    $('#sheetTitle').textContent = title; $('#sheetBody').innerHTML = html; $('#sheet').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeSheet() { $('#sheet').hidden = true; document.body.style.overflow = ''; }
  $('#sheet').addEventListener('click', function (e) { if (e.target.closest('[data-close]')) closeSheet(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });

  function openDetail(o) {
    var id = numId(o.id);
    var hist = (o.history || []).slice().reverse().map(function (h) {
      return '<li><b>' + esc(state.statuses[h.status] || h.status) + '</b> — ' + esc(h.by) + (h.note ? ' · ' + esc(h.note) : '') + '<br><small>' + new Date(h.at).toLocaleString('fr-FR') + '</small></li>';
    }).join('') || '<li><small>Aucun changement pour l’instant.</small></li>';
    var stButtons = Object.keys(state.statuses).map(function (k) {
      return '<button class="btn ' + (k === o.status ? 'btn--dark' : 'btn--ghost') + '" data-st="' + k + '"' + (k === o.status ? ' disabled' : '') + '>' + esc(state.statuses[k]) + '</button>';
    }).join('');
    openSheet('Commande ' + o.name,
      '<dl class="kv"><dt>Client</dt><dd>' + esc(o.customer) + '</dd><dt>Téléphone</dt><dd>' + esc(o.phone || '—') + '</dd>' +
      '<dt>Adresse</dt><dd>' + esc([o.address, o.city, o.province, o.zip].filter(Boolean).join(', ') || '—') + '</dd>' +
      '<dt>Total</dt><dd>' + dt(o.total) + '</dd><dt>Statut</dt><dd><span class="badge b-' + o.status + '">' + esc(o.statusLabel) + '</span></dd>' +
      (o.adexCode ? '<dt>Colis Adex</dt><dd>' + esc(o.adexCode) + (o.adexEtat ? ' · ' + esc(o.adexEtat) : '') + '</dd>' : '') + '</dl>' +
      '<div class="card__items" style="margin-top:12px">' + itemsHtml(o) + '</div>' +
      (o.note ? '<p class="card__note">📝 ' + esc(o.note) + '</p>' : '') +
      (o.adexCode ? '<div class="row" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px"><a class="btn btn--line" href="/api/adex/bl/' + encodeURIComponent(o.adexCode) + '" target="_blank">🖨 Bon de livraison</a><button class="btn btn--ghost" id="trackBtn">📦 Suivi Adex</button></div><div id="track"></div>' : '') +
      (['nouveau', 'tentative1', 'tentative2'].indexOf(o.status) > -1 ? '<button class="btn btn--red btn--block" style="margin-top:12px" id="goConfirm">✔ Confirmer cette commande</button>' : '') +
      '<p class="sec">Changer le statut manuellement</p><div class="status-grid" id="stGrid">' + stButtons + '</div>' +
      '<p class="sec">Historique</p><ul class="hist">' + hist + '</ul>');
    var gc = $('#goConfirm'); if (gc) gc.onclick = function () { openConfirm(o); };
    $('#stGrid').onclick = function (e) {
      var b = e.target.closest('[data-st]'); if (!b) return;
      var st = b.dataset.st;
      if (st === 'confirmee' && !o.adexCode && state.adex) { openConfirm(o); return; }
      changeStatus(o, st, 'Manuel', b, st === 'confirmee');
    };
    var tb = $('#trackBtn');
    if (tb) tb.onclick = async function () {
      tb.disabled = true;
      try {
        var h = await api('/api/orders/' + id + '/adex-historique');
        var rows = (h.historique || []).slice().reverse().map(function (x) {
          return '<li><b>' + esc(x.action || x.type) + '</b>' + (x.motif ? ' · ' + esc(x.motif) : '') + (x.livreur && x.livreur.nom ? '<br>Livreur : ' + esc(x.livreur.nom) + (x.livreur.tel ? ' · <a href="tel:' + esc(x.livreur.tel) + '">' + esc(x.livreur.tel) + '</a>' : '') : '') + '<br><small>' + esc(x.date_formatee || x.date) + '</small></li>';
        }).join('');
        $('#track').innerHTML = '<p class="sec">Suivi Adex — ' + esc(h.etat_actuel || '') + '</p><ul class="hist">' + (rows || '<li>Aucun mouvement</li>') + '</ul>';
      } catch (err) { toast(err.message, true); }
      tb.disabled = false;
    };
  }

  async function getVilles() {
    if (state.villes) return state.villes;
    state.villes = await api('/api/villes'); return state.villes;
  }

  function designation(o) {
    return o.items.map(function (i) {
      var parf = i.props.find(function (p) { return /parfum/i.test(p.key); });
      return i.qty + 'x ' + i.title + (i.variant ? ' ' + i.variant : '') + (i.contents ? ' [' + i.contents.join(', ') + ']' : '') + (parf ? ' (parfum : ' + parf.value + ')' : '');
    }).join(' + ');
  }

  // Noms de gouvernorats en arabe (adresse saisie en arabe par le client)
  var AR = { 'تونس': 'Tunis', 'أريانة': 'Ariana', 'اريانة': 'Ariana', 'بن عروس': 'Ben Arous', 'منوبة': 'Manouba', 'نابل': 'Nabeul', 'زغوان': 'Zaghouan', 'بنزرت': 'Bizerte', 'باجة': 'Béja', 'جندوبة': 'Jendouba', 'الكاف': 'Le Kef', 'سليانة': 'Siliana', 'سوسة': 'Sousse', 'المنستير': 'Monastir', 'المهدية': 'Mahdia', 'صفاقس': 'Sfax', 'القيروان': 'Kairouan', 'القصرين': 'Kasserine', 'سيدي بوزيد': 'Sidi Bouzid', 'قابس': 'Gabès', 'مدنين': 'Médenine', 'تطاوين': 'Tataouine', 'قفصة': 'Gafsa', 'توزر': 'Tozeur', 'قبلي': 'Kébili' };
  function arFr(s) { s = String(s || '').trim(); return AR[s] || AR[s.replace(/^ال/, '')] || s; }

  async function openConfirm(o) {
    openSheet('Confirmer ' + o.name, '<p>Chargement…</p>');
    var villes = [];
    if (state.adex) { try { villes = await getVilles(); } catch (err) { toast(err.message, true); } }
    var pn = norm(arFr(o.province)), cn = norm(arFr(o.city));
    var gov = villes.find(function (g) { return norm(g.gouvernorat) === pn; }) ||
      villes.find(function (g) { return pn && (norm(g.gouvernorat).indexOf(pn) > -1 || pn.indexOf(norm(g.gouvernorat)) > -1); }) ||
      villes.find(function (g) { return g.villes.some(function (v) { return norm(v) === cn; }); }) ||
      villes.find(function (g) { return norm(g.gouvernorat) === cn; });
    var pieces = o.items.reduce(function (s, i) { return s + i.qty; }, 0);
    var govOpts = '<option value="">— Choisir —</option>' + villes.map(function (g) { return '<option' + (gov && gov.gouvernorat === g.gouvernorat ? ' selected' : '') + '>' + esc(g.gouvernorat) + '</option>'; }).join('');
    openSheet('Confirmer ' + o.name,
      '<form class="form" id="cf">' +
      '<div class="card__items" style="margin:0">' + itemsHtml(o) + '</div>' +
      '<label>Nom du client<input name="client" value="' + esc(o.customer) + '" required></label>' +
      '<div class="row"><label>Téléphone<input name="tel1" inputmode="numeric" maxlength="12" value="' + esc(tel8(o.phone)) + '" required></label>' +
      '<label>Téléphone 2<input name="tel2" inputmode="numeric" maxlength="12" placeholder="Optionnel"></label></div>' +
      '<label>Adresse<textarea name="adresse" required>' + esc([o.address, o.city].filter(Boolean).join(', ')) + '</textarea></label>' +
      (state.adex ? '<div class="row"><label>Gouvernorat<select name="gouvernorat" required>' + govOpts + '</select></label>' +
        '<label>Délégation<select name="ville" required></select></label></div>' +
        '<p class="hint" style="margin:-6px 0 0">Shopify : ' + esc([o.city, o.province].filter(Boolean).join(' / ') || '—') + '</p>' : '') +
      '<div class="row"><label>Montant à encaisser (DT)<input name="prix" inputmode="decimal" value="' + o.total + '" required></label>' +
      '<label>Nombre de pièces<input name="nb_pieces" type="number" min="1" max="50" value="1"></label></div>' +
      '<label>Désignation<textarea name="designation" required>' + esc(designation(o)) + '</textarea></label>' +
      '<label>Commentaire pour le livreur<input name="commentaire" placeholder="Ex. appeler avant, disponible après 17h" value="' + esc(o.note) + '"></label>' +
      '<label class="check"><input type="checkbox" name="autorisation_ouv" checked> Le client peut ouvrir le colis</label>' +
      '<label class="check"><input type="checkbox" name="fragile"> Fragile</label>' +
      '<button class="btn btn--red btn--block" type="submit">' + (state.adex ? '✔ Confirmer et envoyer à Adex' : '✔ Confirmer') + '</button>' +
      '</form>');
    var f = $('#cf');
    function fillVilles() {
      if (!f.gouvernorat) return;
      var g = villes.find(function (x) { return x.gouvernorat === f.gouvernorat.value; });
      var list = g ? g.villes : [];
      var guess = list.find(function (v) { return norm(v) === cn; }) || list.find(function (v) { return cn && (norm(v).indexOf(cn) > -1 || cn.indexOf(norm(v)) > -1); });
      f.ville.innerHTML = '<option value="">— Choisir —</option>' + list.map(function (v) { return '<option' + (v === guess ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
    }
    if (f.gouvernorat) { f.gouvernorat.onchange = fillVilles; fillVilles(); }
    f.onsubmit = async function (e) {
      e.preventDefault();
      var btn = f.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Envoi…';
      var body = {
        client: f.client.value, tel1: f.tel1.value, tel2: f.tel2.value, adresse: f.adresse.value,
        gouvernorat: f.gouvernorat ? f.gouvernorat.value : '-', ville: f.ville ? f.ville.value : '-',
        prix: String(f.prix.value).replace(',', '.'), nb_pieces: f.nb_pieces.value, designation: f.designation.value,
        commentaire: f.commentaire.value, autorisation_ouv: f.autorisation_ouv.checked, fragile: f.fragile.checked,
      };
      try {
        var r = await api('/api/orders/' + numId(o.id) + '/confirm', { method: 'POST', body: body });
        toast('✔ ' + o.name + ' confirmée' + (r.code ? ' · colis ' + r.code : ''));
        if (r.warning) setTimeout(function () { toast('Adex : ' + r.warning, true); }, 2700);
        o.status = 'confirmee'; o.statusLabel = state.statuses.confirmee; o.adexCode = r.code || '';
        closeSheet(); render(); load();
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false; btn.textContent = state.adex ? '✔ Confirmer et envoyer à Adex' : '✔ Confirmer';
      }
    };
  }

  if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js').catch(function () {}); }
  boot().catch(function () { showLogin(); });
})();
