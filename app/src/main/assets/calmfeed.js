// calmfeed.js : injecté par l'appli au tout début de chaque page https://www.instagram.com
//
// Ce que ce script lit : l'adresse de la page, le texte des <article> du feed,
// ses propres réglages (localStorage, clé "calmgram.settings"), et, au tap sur 📞/🎥,
// le numéro d'appel de la conversation ouverte (donnée interne de la page Instagram).
// Ce qu'il ne fait jamais : lire un champ de formulaire, envoyer une requête,
// parler à l'appli Android (il n'existe aucun pont entre la page et l'appli).
(function () {
  'use strict';
  if (window.__calmfeed) return;
  window.__calmfeed = true;

  var root = document.documentElement;
  var FEED = '/?variant=following';
  var PANEL_HASH = '#calmgram';
  var nativePush = history.pushState.bind(history);
  var nativeReplace = history.replaceState.bind(history);

  // ---------------------------------------------------------------------------
  // 1. Réglages (tous activés par défaut = mode calme)
  // ---------------------------------------------------------------------------
  var SETTINGS_KEY = 'calmgram.settings';
  var OPTIONS = [
    ['following', 'Feed des abonnements', 'Ouvrir et revenir sur « Suivi(e) » au lieu de « Pour vous »',
     'Following feed', 'Open and return to “Following” instead of “For you”'],
    ['feedReels', 'Reels dans le feed', 'Masquer les Reels entre les posts',
     'Reels in the feed', 'Hide Reels between posts'],
    ['suggested', 'Posts suggérés', 'Masquer « Suggestions pour vous »',
     'Suggested posts', 'Hide “Suggested for you”'],
    ['ads', 'Publicités', 'Masquer les posts « Sponsorisée »',
     'Ads', 'Hide “Sponsored” posts'],
    ['reelsTab', 'Onglet Reels', 'Masquer le bouton Reels et bloquer le flux sans fin',
     'Reels tab', 'Hide the Reels button and block the endless feed'],
    ['exploreGrid', 'Grille Explorer', 'La loupe ouvre seulement la recherche',
     'Explore grid', 'The search icon only opens search'],
    ['reelSwipe', 'Swipe sur un Reel reçu', 'Un Reel ouvert reste seul, sans suivant',
     'Swipe on a received Reel', 'An open Reel stays alone, with no next one']
  ];

  // Deux copies des réglages, toutes deux dans le stockage du site, sur le téléphone :
  //  - localStorage : lu tout de suite au chargement (pas de clignotement), mais la WebView
  //    ne l'écrit sur le disque qu'après un délai. Vérifié le 2026-11-09 : un réglage changé
  //    juste avant de fermer l'appli était perdu.
  //  - IndexedDB : écrit sur le disque dès l'enregistrement (vérifié : survit à un arrêt
  //    immédiat de l'appli). Relu au démarrage ; s'il diffère, il fait foi.
  var DB_NAME = 'calmgram';
  var DB_STORE = 'kv';
  var settings = loadSettings();

  // Langue de l'interface : français si la page est en français, anglais sinon
  // (Facebook et Instagram indiquent la langue dans <html lang>).
  function tr(fr, en) {
    var lang = (root.getAttribute('lang') || navigator.language || '').toLowerCase();
    return lang.indexOf('fr') === 0 ? fr : en;
  }

  function normalize(saved) {
    var result = {};
    saved = saved && typeof saved === 'object' ? saved : {};
    OPTIONS.forEach(function (o) { result[o[0]] = typeof saved[o[0]] === 'boolean' ? saved[o[0]] : true; });
    return result;
  }

  function loadSettings() {
    try { return normalize(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (e) { return normalize({}); }
  }

  function withStore(mode, use) {
    try {
      var open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = function () { open.result.createObjectStore(DB_STORE); };
      open.onsuccess = function () {
        var db = open.result;
        try {
          var tx = db.transaction(DB_STORE, mode);
          tx.oncomplete = tx.onerror = tx.onabort = function () { db.close(); };
          use(tx.objectStore(DB_STORE));
        } catch (e) { db.close(); }
      };
    } catch (e) { /* IndexedDB indisponible : localStorage seul */ }
  }

  function saveSettings() {
    var json = JSON.stringify(settings);
    try { localStorage.setItem(SETTINGS_KEY, json); } catch (e) { /* stockage indisponible */ }
    withStore('readwrite', function (store) { store.put(json, SETTINGS_KEY); });
  }

  // Au démarrage : si IndexedDB a une autre version (localStorage perdu), on la reprend.
  function syncSettingsFromDisk() {
    withStore('readonly', function (store) {
      var get = store.get(SETTINGS_KEY);
      get.onsuccess = function () {
        if (typeof get.result !== 'string') {
          // Première fois avec IndexedDB : on y copie les réglages actuels.
          try { if (localStorage.getItem(SETTINGS_KEY)) saveSettings(); } catch (e) { /* idem */ }
          return;
        }
        var stored;
        try { stored = normalize(JSON.parse(get.result)); } catch (e) { return; }
        if (JSON.stringify(stored) === JSON.stringify(settings)) return;
        settings = stored;
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* idem */ }
        applySettings();
        refreshPanel();
        lastUrl = null; // réapplique les redirections avec les bons réglages
        update();
      };
    });
  }

  // Les règles CSS lisent cet attribut : un changement s'applique immédiatement.
  function applySettings() {
    var off = OPTIONS.map(function (o) { return o[0]; }).filter(function (k) { return !settings[k]; });
    root.setAttribute('data-calm-off', off.join(' '));
  }

  // ---------------------------------------------------------------------------
  // 2. Redirections (testées le 2026-11-06 sur Instagram web mobile)
  // ---------------------------------------------------------------------------
  function home() { return settings.following ? FEED : '/'; }

  function redirectTarget(path, search) {
    // Accueil "Pour vous" -> feed des abonnements
    if (settings.following && path === '/' && !/(^|[?&])variant=following(&|$)/.test(search)) return FEED;
    // Lecteur de Reels sans fin, et grilles "même son"
    if (settings.reelsTab && /^\/reels\/?$/.test(path)) return home();
    if (settings.reelsTab && /^\/reels\/audio(\/|$)/.test(path)) return home();
    // /reels/ID ouvre le flux swipable ; /reel/ID affiche le Reel seul.
    var reel = /^\/reels\/([A-Za-z0-9_-]+)\/?$/.exec(path);
    if (settings.reelSwipe && reel && reel[1] !== 'audio') return '/reel/' + reel[1] + '/';
    // Explorer -> page de recherche seule (pas de grille)
    if (settings.exploreGrid && /^\/explore\/?$/.test(path)) return '/explore/search/';
    return null;
  }

  function pageOf(path) {
    if (path === '/') return 'home';
    if (/^\/explore\/?$/.test(path)) return 'explore';
    return 'other';
  }

  // ---------------------------------------------------------------------------
  // 3. Style : tes filtres uBlock en CSS, chacun lié à son interrupteur.
  //    Actif avant le premier rendu, donc sans clignotement.
  // ---------------------------------------------------------------------------
  // display:none sur un post bloque le chargement de la suite du feed ;
  // 1px de haut le laisse continuer (vérifié : 52 posts chargés contre 26).
  var COLLAPSE = 'height:1px!important;min-height:0!important;overflow:hidden!important;' +
                 'opacity:0!important;margin:0!important;';
  var HOME = 'html[data-calm-page="home"]';

  var style = document.createElement('style');
  style.id = 'calmfeed';
  style.textContent = [
    // Instagram ne garde que ~8 posts dans la page et remplace les autres par un padding.
    // Avec des posts à 1px, l'ancrage de scroll du navigateur se battait avec ce padding :
    // la page reculait de ~1800px, plusieurs fois (vérifié le 2026-11-09, corrigé par cette ligne).
    HOME + ' * { overflow-anchor:none!important; }',
    HOME + ':not([data-calm-off~="feedReels"]) article:has(a[href*="/reel/"]),',
    HOME + ':not([data-calm-off~="suggested"]) article[data-calm-hide],',
    HOME + ':not([data-calm-off~="ads"]) article[data-calm-ad] {' + COLLAPSE + '}',
    'html:not([data-calm-off~="reelsTab"]) a[href="/reels/"] { display:none!important; }',
    // Secours si la page Explorer s'affiche quand même : grille masquée, recherche gardée
    'html:not([data-calm-off~="exploreGrid"]) main:has(input[type="search"]) a[href^="/p/"],',
    'html:not([data-calm-off~="exploreGrid"]) main:has(input[type="search"]) a[href*="/reel/"] { display:none!important; }',
    'html[data-calm-page="explore"]:not([data-calm-off~="exploreGrid"])' +
      ' div[role="progressbar"][data-visualcompletion="loading-state"] { display:none!important; }'
  ].join('\n');

  function ensureStyle() {
    // Accroché à <html> et pas à <head>, qu'Instagram peut réécrire.
    if (!style.isConnected) root.appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // 4. Posts suggérés et publicités : repérés par leur texte (CSS ne sait pas lire le texte)
  // ---------------------------------------------------------------------------
  var SUGGESTED = /Suggestions pour vous|Suggested for you/;
  // Publicité : un <span> qui contient exactement l'étiquette, sous le nom du compte
  // (vérifié le 2026-11-09 : « Sponsorisée »). Une légende qui contient le mot n'est pas visée.
  var AD_LABEL = /^(Sponsorisée?|Sponsored)$/;

  function isAd(article) {
    var spans = article.getElementsByTagName('span');
    for (var i = 0; i < spans.length; i++) {
      if (spans[i].childElementCount === 0 && AD_LABEL.test(spans[i].textContent.trim())) return true;
    }
    return false;
  }

  function scanFeed() {
    if (root.getAttribute('data-calm-page') !== 'home') return;
    var articles = document.querySelectorAll('article:not([data-calm-hide])');
    for (var i = 0; i < articles.length; i++) {
      if (SUGGESTED.test(articles[i].textContent)) articles[i].setAttribute('data-calm-hide', '');
    }
    var unchecked = document.querySelectorAll('article:not([data-calm-ad])');
    for (var j = 0; j < unchecked.length; j++) {
      if (isAd(unchecked[j])) unchecked[j].setAttribute('data-calm-ad', '');
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Ligne "Mode calme" dans Paramètres et confidentialité
  // ---------------------------------------------------------------------------
  var ROW_ID = 'calmgram-row';
  // L'adresse passe à /accounts/settings/ avant que la page s'affiche : sans ce délai,
  // la ligne de secours apparaissait un instant en haut de la page précédente (profil).
  var FALLBACK_DELAY = 1500;
  var settingsSince = 0;
  var ICON = '<rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" stroke-width="2"/>' +
             '<circle cx="12" cy="12" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/>';

  function ensureSettingsRow() {
    if (!/^\/accounts\/settings\/?$/.test(location.pathname)) { settingsSince = 0; return; }
    if (!settingsSince) settingsSince = Date.now();
    if (document.getElementById(ROW_ID)) return;

    var row;
    // Ligne "Changer l'apparence" : repérée par son lien, copiée pour avoir le style d'Instagram.
    var appearance = document.querySelector('a[href="/accounts/switch_appearance/"]');
    if (appearance && appearance.parentElement) {
      row = appearance.parentElement.cloneNode(true);
      var svg = row.querySelector('svg');
      if (svg) { svg.setAttribute('viewBox', '0 0 24 24'); svg.innerHTML = ICON; }
      setLabel(row, tr('Mode calme', 'Calm mode'));
      var link = row.querySelector('a');
      if (link) link.setAttribute('href', PANEL_HASH);
      appearance.parentElement.after(row);
    } else {
      // Secours si Instagram a changé sa page : ligne au même format, tout en haut.
      // Seulement si la ligne « Changer l'apparence » n'est toujours pas là après le délai.
      var waited = Date.now() - settingsSince;
      if (waited < FALLBACK_DELAY) { setTimeout(schedule, FALLBACK_DELAY - waited + 50); return; }
      var main = document.querySelector('main');
      if (!main) return;
      row = document.createElement('div');
      row.setAttribute('role', 'link');
      row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 16px;' +
                          'cursor:pointer;font-size:15px;color:inherit;';
      row.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24">' + ICON + '</svg><span>' + tr('Mode calme', 'Calm mode') + '</span>';
      main.insertBefore(row, main.firstChild);
    }
    row.id = ROW_ID;
    row.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      openPanel();
    }, true);
  }

  // Remplace le premier texte visible, efface les autres (ex. sous-titre de la ligne copiée).
  function setLabel(element, text) {
    var walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    var node;
    var first = true;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue.trim()) continue;
      node.nodeValue = first ? text : '';
      first = false;
    }
  }

  // ---------------------------------------------------------------------------
  // 6. Page des interrupteurs (dans un shadow DOM : le style d'Instagram ne la touche pas)
  // ---------------------------------------------------------------------------
  var panelHost = null;
  var panelSwitches = [];

  function refreshPanel() {
    panelSwitches.forEach(function (button) {
      button.setAttribute('aria-checked', String(settings[button.getAttribute('data-key')]));
    });
  }

  function openPanel() {
    if (panelHost && panelHost.isConnected) return;
    // Une entrée d'historique : le bouton retour d'Android ferme la page.
    nativePush(history.state, '', location.pathname + location.search + PANEL_HASH);

    var dark = root.classList.contains('__fb-dark-mode');
    var c = dark
      ? { bg: '#0c1014', fg: '#f5f5f5', sub: '#a8a8a8', line: '#262626', off: '#363636' }
      : { bg: '#ffffff', fg: '#0c1014', sub: '#737373', line: '#dbdbdb', off: '#dbdbdb' };

    panelHost = document.createElement('div');
    var shadow = panelHost.attachShadow({ mode: 'closed' });
    shadow.innerHTML =
      '<style>' +
      ':host{all:initial}' +
      '.page{position:fixed;inset:0;z-index:2147483647;overflow-y:auto;background:' + c.bg + ';color:' + c.fg + ';' +
        'font:15px/1.35 -apple-system,system-ui,Roboto,sans-serif}' +
      '.head{position:sticky;top:0;height:44px;display:flex;align-items:center;justify-content:center;' +
        'font-weight:600;font-size:16px;background:' + c.bg + ';border-bottom:1px solid ' + c.line + '}' +
      '.back{position:absolute;left:4px;top:0;width:44px;height:44px;border:0;padding:0;background:none;' +
        'color:inherit;display:flex;align-items:center;justify-content:center}' +
      '.back svg{width:24px;height:24px}' +
      '.sec{padding:16px 16px 4px;color:' + c.sub + ';font-size:13px;font-weight:600}' +
      '.row{display:flex;align-items:center;gap:12px;width:100%;padding:12px 16px;border:0;background:none;' +
        'color:inherit;font:inherit;text-align:left;-webkit-tap-highlight-color:transparent}' +
      '.t{flex:1;min-width:0}.t b{display:block;font-weight:400}' +
      '.t span{display:block;color:' + c.sub + ';font-size:13px}' +
      '.sw{width:44px;height:26px;border-radius:13px;background:' + c.off + ';position:relative;flex:none;' +
        'transition:background .15s}' +
      '.sw::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;' +
        'background:#fff;transition:transform .15s}' +
      '.row[aria-checked="true"] .sw{background:#5E7D6A}' +
      '.row[aria-checked="true"] .sw::after{transform:translateX(18px)}' +
      '.note{padding:16px;color:' + c.sub + ';font-size:12px}' +
      '</style>' +
      '<div class="page" role="dialog" aria-label="' + tr('Mode calme', 'Calm mode') + '">' +
        '<div class="head"><button class="back" aria-label="' + tr('Retour', 'Back') + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 5l-7 7 7 7"/></svg>' +
        '</button>' + tr('Mode calme', 'Calm mode') + '</div>' +
        '<div class="sec">' + tr('Masquer ou rediriger', 'Hide or redirect') + '</div>' +
        OPTIONS.map(function (o) {
          return '<button class="row" role="switch" data-key="' + o[0] + '" aria-checked="' + settings[o[0]] + '">' +
                 '<span class="t"><b>' + tr(o[1], o[3]) + '</b><span>' + tr(o[2], o[4]) + '</span></span><span class="sw"></span></button>';
        }).join('') +
        '<div class="note">' + tr('Réglages enregistrés sur cet appareil. S\'ils sont effacés, tout revient en mode calme.',
          'Settings are saved on this device. If they are cleared, everything goes back to calm mode.') + '</div>' +
      '</div>';

    shadow.querySelector('.back').addEventListener('click', function () {
      if (location.hash === PANEL_HASH) history.back(); else closePanel();
    });
    panelSwitches = Array.prototype.slice.call(shadow.querySelectorAll('.row'));
    panelSwitches.forEach(function (button) {
      button.addEventListener('click', function () {
        var key = button.getAttribute('data-key');
        settings[key] = !settings[key];
        button.setAttribute('aria-checked', String(settings[key]));
        saveSettings();
        applySettings();
      });
    });

    root.appendChild(panelHost);
  }

  function closePanel() {
    if (panelHost) panelHost.remove();
    panelHost = null;
    panelSwitches = [];
  }

  // ---------------------------------------------------------------------------
  // 7. Appels (testé le 2026-11-09)
  //    En version ordinateur, Instagram a des boutons d'appel qui ouvrent une fenêtre
  //    /call/?has_video=…&ig_thread_id=<thread_fbid>. En version mobile, pas de bouton.
  //    On ajoute 📞 et 🎥 dans l'en-tête de la conversation, qui ouvrent cette page
  //    dans l'appli. L'appli n'autorise le micro et la caméra que sur /call/.
  // ---------------------------------------------------------------------------
  var CALL_ID = 'calmgram-call';
  var PHONE_ICON = '<path d="M6.6 3.5h2.6l1.5 4-2 1.3a11 11 0 0 0 6.5 6.5l1.3-2 4 1.5v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z"/>';
  var VIDEO_ICON = '<rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="M15.5 10.5l6-3.5v10l-6-3.5z"/>';

  function callUrl(fbid, video) {
    return '/call/?has_video=' + (video ? 'true' : 'false') + '&ig_thread_id=' + fbid;
  }

  // Le numéro d'appel n'est pas dans l'adresse : on le cherche dans les données React de la page.
  //  - version ordinateur : objet { thread_key: <numéro de l'adresse>, thread_fbid } -> correspondance exacte ;
  //  - version mobile : les données de la page affichée { thread_igid, thread_fbid }, sans thread_key.
  //    Vérifié : elles suivent la conversation affichée quand on en change sans recharger.
  //    S'il y a plusieurs numéros possibles, on n'appelle personne.
  function findThreadFbid(threadKey) {
    var fiber = null;
    var elements = document.body ? document.body.querySelectorAll('*') : [];
    for (var i = 0; i < elements.length && !fiber; i++) {
      for (var k in elements[i]) {
        if (k.indexOf('__reactFiber') === 0) { fiber = elements[i][k]; break; }
      }
    }
    while (fiber && fiber.return) fiber = fiber.return;
    var stack = fiber ? [fiber] : [];
    var pageIds = {};
    for (var n = 0; stack.length && n < 100000; n++) {
      var f = stack.pop();
      var props = f.memoizedProps;
      if (props && typeof props === 'object') {
        for (var p in props) {
          var v = props[p];
          if (!v || typeof v !== 'object' || !v.thread_fbid) continue;
          if (v.thread_key === threadKey) return String(v.thread_fbid);
          if (v.thread_key === undefined && v.thread_igid) pageIds[String(v.thread_fbid)] = true;
        }
      }
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
    var ids = Object.keys(pageIds);
    return ids.length === 1 ? ids[0] : null;
  }

  function ensureCallButtons() {
    var match = /^\/direct\/t\/(\d+)\/?$/.exec(location.pathname);
    var existing = document.getElementById(CALL_ID);
    if (existing && (!match || existing.getAttribute('data-thread') !== match[1])) existing.remove();
    if (!match || document.getElementById(CALL_ID)) return;
    // Version ordinateur (écran large) : Instagram a déjà ses boutons.
    if (document.querySelector('svg[aria-label="Appel vocal"], svg[aria-label="Audio call"], svg[aria-label="Voice call"]')) return;
    var info = document.querySelector('svg[aria-label="Informations sur la conversation"], svg[aria-label="Conversation information"]');
    var infoButton = info && info.closest('[role="button"]');
    if (!infoButton || !infoButton.parentElement) return;

    var box = document.createElement('div');
    box.id = CALL_ID;
    box.setAttribute('data-thread', match[1]);
    box.style.cssText = 'display:flex;align-items:center;';
    [[false, tr('Appel vocal', 'Voice call'), PHONE_ICON], [true, tr('Appel vidéo', 'Video call'), VIDEO_ICON]].forEach(function (b) {
      var button = document.createElement('div');
      button.setAttribute('role', 'button');
      button.setAttribute('aria-label', b[1]);
      button.tabIndex = 0;
      button.style.cssText = 'width:40px;height:40px;display:flex;align-items:center;justify-content:center;cursor:pointer;';
      button.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                         'stroke-width="2" stroke-linejoin="round">' + b[2] + '</svg>';
      button.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var fbid = findThreadFbid(match[1]);
        if (fbid) location.assign(callUrl(fbid, b[0]));
        else alert(tr('Appel indisponible : Instagram a changé sa page.', 'Call unavailable: Instagram changed its page.'));
      });
      box.appendChild(button);
    });
    infoButton.parentElement.insertBefore(box, infoButton);
  }

  // La page d'appel est faite pour ordinateur : deux colonnes côte à côte sur 1024px
  // (aperçu caméra à gauche, « Prêt(e) à appeler ? / Démarrer l'appel » à droite, hors écran
  // sur un téléphone). On ramène à la largeur de l'écran ce qui dépasse, on empile les colonnes,
  // et on met la colonne de droite (le bouton) en premier. Vérifié le 2026-11-09 en 375px.
  function fitCallPage() {
    if (location.pathname.indexOf('/call/') !== 0 || !document.body) return;
    var vw = root.clientWidth;
    var divs = document.body.querySelectorAll('div');
    for (var i = 0; i < divs.length; i++) {
      var el = divs[i];
      if (el.getBoundingClientRect().width <= vw + 1) continue;
      var cs = getComputedStyle(el);
      el.style.setProperty('width', '100%', 'important');
      el.style.setProperty('min-width', '0', 'important');
      el.style.setProperty('max-width', '100%', 'important');
      if (cs.display === 'flex' && cs.flexDirection === 'row') {
        el.style.setProperty('flex-direction', 'column', 'important');
        el.style.setProperty('align-items', 'center', 'important');
        el.style.setProperty('justify-content', 'flex-start', 'important');
        el.style.setProperty('overflow-y', 'auto', 'important');
        el.style.setProperty('max-height', '100vh', 'important');
        if (el.children.length === 2) el.lastElementChild.style.setProperty('order', '-1', 'important');
      }
    }
  }

  // Fin d'appel : la page est prévue pour une fenêtre à part et appelle window.close(),
  // qui ne fait rien dans l'appli. On revient en arrière à la place, en sautant les
  // éventuelles entrées /call/ de l'historique (marqueur gardé le temps du retour).
  var LEAVE_CALL = 'calmgram.leaveCall';

  function isCallPath() { return location.pathname.indexOf('/call/') === 0; }

  function leaveCallPage() {
    try { sessionStorage.setItem(LEAVE_CALL, '1'); } catch (e) { /* stockage indisponible */ }
    history.back();
    // Pas de page avant l'appel : boîte de réception.
    setTimeout(function () { if (isCallPath()) location.replace('/direct/inbox/'); }, 1500);
  }

  function continueLeavingCall() {
    var leaving = false;
    try { leaving = sessionStorage.getItem(LEAVE_CALL) === '1'; } catch (e) { /* idem */ }
    if (!leaving) return;
    if (isCallPath()) history.back();
    else try { sessionStorage.removeItem(LEAVE_CALL); } catch (e) { /* idem */ }
  }

  var nativeClose = window.close;
  window.close = function () {
    if (isCallPath()) leaveCallPage();
    else nativeClose.call(window);
  };

  // Si Instagram ouvre lui-même la fenêtre d'appel (écran large), on l'ouvre dans l'appli.
  var nativeOpen = window.open;
  window.open = function (url) {
    try {
      var u = new URL(String(url), location.href);
      if (u.origin === location.origin && u.pathname.indexOf('/call/') === 0) {
        location.assign(u.pathname + u.search);
        return null;
      }
    } catch (e) { /* adresse invalide : comportement normal */ }
    return nativeOpen.apply(window, arguments);
  };

  // ---------------------------------------------------------------------------
  // 8. Suivre les changements de page (Instagram ne recharge pas la page)
  // ---------------------------------------------------------------------------
  var queued = false;

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { // avant le prochain affichage : pas de clignotement
      queued = false;
      scanFeed();
      ensureSettingsRow();
      ensureCallButtons();
      fitCallPage();
    });
  }

  var lastUrl = null;

  function update() {
    ensureStyle();
    var url = location.pathname + location.search;
    if (url === lastUrl) return;
    lastUrl = url;
    continueLeavingCall();
    var target = redirectTarget(location.pathname, location.search);
    if (target) {
      // replace : le bouton retour ne reboucle pas. Le #calmgram du raccourci est conservé.
      location.replace(target + (location.hash === PANEL_HASH ? PANEL_HASH : ''));
      return;
    }
    root.setAttribute('data-calm-page', pageOf(location.pathname));
    schedule();
  }

  // Clic sur Accueil ou Explorer : on change de page à la manière d'Instagram
  // (pushState + popstate), sans recharger, donc sans l'écran du logo.
  // Testé pour ces deux cas. Les autres gardent la redirection avec rechargement.
  window.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    var link = e.target.closest && e.target.closest('a[href]');
    if (!link) return;
    var url = new URL(link.href, location.href);
    if (url.origin !== location.origin) return;
    var target = redirectTarget(url.pathname, url.search);
    if (target !== FEED && target !== '/explore/search/') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    history.pushState(null, '', target);
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
  }, true);

  ['pushState', 'replaceState'].forEach(function (name) {
    var original = history[name];
    history[name] = function () {
      var result = original.apply(this, arguments);
      update();
      return result;
    };
  });
  window.addEventListener('popstate', function () {
    if (location.hash !== PANEL_HASH) closePanel();
    update();
  });
  new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
  setInterval(update, 500); // filet de sécurité

  applySettings();
  update();
  syncSettingsFromDisk();

  // Ouverture directe des réglages (raccourci Android "Mode calme")
  if (location.hash === PANEL_HASH && !redirectTarget(location.pathname, location.search)) {
    nativeReplace(history.state, '', location.pathname + location.search);
    openPanel();
  }
})();
