/* Comenzi Unirea Gospodarilor — logica aplicatiei.
   Ritmul zilei nu mai e dat de ceas, ci de depozit: cat timp o comanda e
   deschisa, magazinele adauga in ea. Cand depozitul apasa "Finalizează",
   comanda se inchide, se deschide una noua si cosurile magazinelor sunt goale.
   Datele trec printr-un singur strat (Store), ca sa putem schimba locul de
   stocare fara sa atingem interfata: acum "local" (telefonul) sau Supabase. */
(function () {
"use strict";

var CATALOG_BAZA = window.PRODUSE, CATEGORII_BAZA = window.CATEGORII;
var CFG = window.CONFIG || {};
var MAGAZINE = CFG.magazine || { kaufland: "Kaufland", bistrita: "Bistrița" };
var CHEI = Object.keys(MAGAZINE);
var UM_POSIBILE = ["Kg", "L", "Buc"];

var lei = function (n) { return n.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
var cant = function (n) { return (Math.round(n * 1000) / 1000).toLocaleString("ro-RO", { maximumFractionDigits: 3 }); };
var $ = function (id) { return document.getElementById(id); };

/* Magazinul cere TOTDEAUNA in bucati (bucata, caserola, galeata), nu in kg.
   Depozitul trece la livrare cantitatea reala, in unitatea de masura a produsului.
   Produsele de mai jos se cer doar din 5 in 5. */
var PAS_5 = { 13: true, 25: true };
function pasCerere(p) { return PAS_5[p.nr] ? 5 : 1; }
function rotunjestePas(p, v) {
  if (v == null) return null;
  var pas = pasCerere(p);
  var r = Math.round(v / pas) * pas;
  return r > 0 ? r : null;
}

var S = {
  rol: null, magazin: null,
  runda: null, deschisaLa: null,
  filtru: "", categorie: "toate", comenzi: {}, depTab: "centralizator",
  pas: "lista", frecvente: [],
  cfg: { dezactivate: [], sterse: [], extra: [] },
  tot: CATALOG_BAZA.slice(), catalog: CATALOG_BAZA.slice(), active: CATALOG_BAZA.slice(),
  categorii: CATEGORII_BAZA.slice(),
  timer: null, ceas: null, confirmaFinal: false,
  conectat: null, ultimaSinc: null,
  alertat: {}, confirmaSterg: null, istoric: [], istoricDeschis: null,
  istoricDate: {}, istoricEdit: null, confirmaStergIstoric: null,
  scrisLa: {}, pendinte: {}, semnatura: null, redesenAmanat: false, baza: {},
  trimis: {}
};

/* Ce nu a putut pleca spre server ramane aici si se retrimite singur.
   Pe o linie de magazin cade semnalul des; comanda nu are voie sa se piarda. */
var Coada = {
  cheie: "unirea_coada_v1",
  tot: function () {
    try { return JSON.parse(localStorage.getItem(this.cheie) || "{}"); }
    catch (e) { return {}; }
  },
  pune: function (doc) {
    var q = this.tot(); q[doc.id] = doc;
    try { localStorage.setItem(this.cheie, JSON.stringify(q)); } catch (e) {}
  },
  scoate: function (id) {
    var q = this.tot(); delete q[id];
    try { localStorage.setItem(this.cheie, JSON.stringify(q)); } catch (e) {}
  },
  marime: function () { return Object.keys(this.tot()).length; }
};

/* ------------------------------------------------------------------ Store */
var Store = {
  mod: "local",
  cheieComenzi: "unirea_comenzi_v1",
  cheieSetari: "unirea_setari_v1",
  init: function () {
    if (CFG.supabaseUrl && CFG.supabaseKey) this.mod = "supabase";
    return this.mod;
  },
  _citesteLocal: function (cheie) {
    try { return JSON.parse(localStorage.getItem(cheie) || "{}"); }
    catch (e) { return {}; }
  },
  _scrieLocal: function (cheie, tot) {
    try { localStorage.setItem(cheie, JSON.stringify(tot)); } catch (e) {}
  },
  _url: function (tabela, q) { return CFG.supabaseUrl.replace(/\/$/, "") + "/rest/v1/" + tabela + (q || ""); },
  _head: function (extra) {
    var h = { apikey: CFG.supabaseKey, Authorization: "Bearer " + CFG.supabaseKey, "Content-Type": "application/json" };
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  },
  _upsert: function (tabela, doc) {
    return fetch(this._url(tabela, ""), {
      method: "POST",
      headers: this._head({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify([doc])
    }).then(function (r) { if (!r.ok) throw new Error("salvare esuata"); });
  },

  citeste: function (sesiune) {
    if (this.mod === "supabase") {
      return fetch(this._url("comenzi", "?select=*&sesiune=eq." + encodeURIComponent(sesiune)), { headers: this._head() })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
    var tot = this._citesteLocal(this.cheieComenzi), out = [];
    Object.keys(tot).forEach(function (k) { if (tot[k].sesiune === sesiune) out.push(tot[k]); });
    return Promise.resolve(out);
  },
  salveaza: function (doc, faraCoada) {
    // pastram mereu si o copie locala, ca sa nu depindem de retea
    var tot = this._citesteLocal(this.cheieComenzi);
    tot[doc.id] = doc;
    this._scrieLocal(this.cheieComenzi, tot);
    if (this.mod !== "supabase") return Promise.resolve();
    return this._upsert("comenzi", doc).then(function () {
      if (!faraCoada) Coada.scoate(doc.id);
      stareRetea(true);
    }).catch(function (e) {
      if (!faraCoada) Coada.pune(doc);
      stareRetea(false);
      throw e;
    });
  },
  trimiteCoada: function () {
    if (this.mod !== "supabase") return Promise.resolve(0);
    var q = Coada.tot(), ids = Object.keys(q), self = this;
    if (!ids.length) return Promise.resolve(0);
    return Promise.all(ids.map(function (id) {
      return self._upsert("comenzi", q[id]).then(function () { Coada.scoate(id); return 1; })
        .catch(function () { return 0; });
    })).then(function (rez) {
      return rez.reduce(function (a, b) { return a + b; }, 0);
    });
  },
  sterge: function (id) {
    var tot = this._citesteLocal(this.cheieComenzi);
    delete tot[id];
    this._scrieLocal(this.cheieComenzi, tot);
    if (this.mod !== "supabase") return Promise.resolve();
    return fetch(this._url("comenzi", "?id=eq." + encodeURIComponent(id)), {
      method: "DELETE", headers: this._head()
    }).then(function (r) { if (!r.ok) throw new Error("stergere esuata"); });
  },
  recente: function (magazin) {
    if (this.mod === "supabase") {
      return fetch(this._url("comenzi", "?select=*&magazin=eq." + encodeURIComponent(magazin) + "&order=actualizat.desc&limit=12"), { headers: this._head() })
        .then(function (r) { return r.ok ? r.json() : []; })
        .catch(function () { return []; });
    }
    var tot = this._citesteLocal(this.cheieComenzi), out = [];
    Object.keys(tot).forEach(function (k) { if (tot[k].magazin === magazin) out.push(tot[k]); });
    out.sort(function (a, b) { return (b.actualizat || "").localeCompare(a.actualizat || ""); });
    return Promise.resolve(out);
  },

  citesteSetare: function (id) {
    if (this.mod === "supabase") {
      return fetch(this._url("setari", "?select=*&id=eq." + encodeURIComponent(id)), { headers: this._head() })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (rows) { return rows && rows[0] ? rows[0].valoare : null; })
        .catch(function () { return null; });
    }
    var tot = this._citesteLocal(this.cheieSetari);
    return Promise.resolve(tot[id] != null ? tot[id] : null);
  },
  scrieSetare: function (id, valoare) {
    if (this.mod === "supabase") {
      return this._upsert("setari", { id: id, valoare: valoare, actualizat: new Date().toISOString() });
    }
    var tot = this._citesteLocal(this.cheieSetari);
    tot[id] = valoare;
    this._scrieLocal(this.cheieSetari, tot);
    return Promise.resolve();
  }
};

/* ------------------------------------------------------------------ ajutor */
function azi() { return new Date().toISOString().slice(0, 10); }
function sesiuneKey() { return "r" + (S.runda || 1); }
function docId(mag) { return sesiuneKey() + "_" + mag; }
function oraRo(iso) {
  try {
    return new Date(iso).toLocaleString("ro-RO",
      { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch (e) { return ""; }
}
function comandaMea() { return S.comenzi[S.magazin] || null; }
function liniiDin(c) { return (c && c.linii) || {}; }
function alteleDin(c) { return (c && c.altele) || []; }
function notaDin(c) { return (c && c.nota) || ""; }
function produsDupaNr(nr) {
  for (var i = 0; i < S.tot.length; i++) if (S.tot[i].nr === Number(nr)) return S.tot[i];
  return null;
}
function valoare(linii, camp) {
  return S.tot.reduce(function (t, p) {
    var l = linii[p.nr]; var q = l && l[camp];
    return t + (q && p.pret != null ? q * p.pret : 0);
  }, 0);
}
function nrPozitii(linii, camp) {
  return S.tot.filter(function (p) { var l = linii[p.nr]; return l && l[camp] > 0; }).length;
}
function pozitiiComanda(c) { return nrPozitii(liniiDin(c), "s") + alteleDin(c).length; }
function totalBucati(linii) {
  return S.tot.reduce(function (t, p) { var l = linii[p.nr]; return t + ((l && l.s) || 0); }, 0);
}
function bucatiComanda(c) {
  return totalBucati(liniiDin(c)) + alteleDin(c).reduce(function (t, it) { return t + (it.s || 1); }, 0);
}
function esteFinalizata(mag) {
  var c = S.comenzi[mag];
  return !!(c && c.status === "finalizata");
}
function toateFinalizate() {
  return CHEI.every(function (m) { return esteFinalizata(m) || !S.comenzi[m]; }) &&
    CHEI.some(function (m) { return esteFinalizata(m); });
}
function schimbaStatus(mag, status) {
  var c = S.comenzi[mag];
  if (!c) return;
  c.status = status; c._local = true;
  if (status === "finalizata") c.modificat = null;
  S.comenzi[mag] = c;
  scrie(mag);
}

function cerute() {
  return S.tot.filter(function (p) {
    return CHEI.some(function (m) {
      var l = liniiDin(S.comenzi[m])[p.nr];
      if (l && (l.s > 0 || l.l > 0)) return true;
      // produsul scos intre timp ramane pe lista, taiat, ca sa se vada
      var b = S.baza[m];
      return !!(b && b.l[p.nr]);
    });
  });
}

/* ------------------------------------------------------------------ catalog */
function recalculeazaCatalog() {
  var dez = S.cfg.dezactivate || [];
  var sterse = S.cfg.sterse || [];
  var extra = S.cfg.extra || [];
  // S.tot = tot ce a existat vreodata (ca sa putem citi comenzi vechi),
  // S.catalog = ce e in lista acum, S.active = ce vad magazinele azi.
  S.tot = CATALOG_BAZA.concat(extra);
  S.tot.sort(function (a, b) { return a.nume.localeCompare(b.nume, "ro"); });
  S.catalog = S.tot.filter(function (p) { return sterse.indexOf(p.nr) < 0; });
  S.active = S.catalog.filter(function (p) { return dez.indexOf(p.nr) < 0; });
  var cat = CATEGORII_BAZA.slice();
  S.catalog.forEach(function (p) { if (cat.indexOf(p.categorie) < 0) cat.push(p.categorie); });
  S.categorii = cat;
}
function salveazaCatalog() {
  recalculeazaCatalog();
  return Store.scrieSetare("produse", S.cfg);
}

/* ------------------------------------------------------------- sincronizare */
function incarca() {
  return Store.trimiteCoada().then(function (trimise) {
    if (trimise) toast(trimise + (trimise === 1 ? " modificare trimisă" : " modificări trimise"));
    return Store.citesteSetare("runda");
  }).then(function (r) {
    var rundaNoua = (r && r.n) || 1;
    var schimbata = S.runda !== null && S.runda !== rundaNoua;
    S.runda = rundaNoua;
    S.deschisaLa = (r && r.deschisaLa) || null;
    if (schimbata) {
      S.comenzi = {}; S.pas = "lista"; S.confirmaFinal = false;
      if (S.rol === "magazin") toast("Comanda a fost preluată de depozit. Poți începe următoarea.");
    }
    return Store.citeste(sesiuneKey());
  }).then(function (randuri) {
    if (randuri === null) { stareRetea(false); deseneaza(); return; }
    stareRetea(true);
    var noi = {};
    randuri.forEach(function (v) { if (v && v.magazin) noi[v.magazin] = v; });
    // Ce am scris pe telefonul asta si inca nu s-a intors de la server ramane
    // asa cum e: altfel se sterge de sub degete cat timp cineva completeaza.
    CHEI.forEach(function (m) {
      var local = S.comenzi[m];
      if (!local || !local._local) return;
      var rem = noi[m];
      var alNostruAjuns = rem && S.scrisLa[m] && rem.actualizat >= S.scrisLa[m];
      if (S.pendinte[m] || !alNostruAjuns) noi[m] = local;
    });
    // magazinul lucreaza pe ciorna lui pana o trimite
    if (S.rol === "magazin") {
      var ciorna = citesteDraft(S.magazin);
      if (ciorna) { ciorna._local = true; noi[S.magazin] = ciorna; }
      if (S.trimis[S.magazin] == null) S.trimis[S.magazin] = citesteTrimis(S.magazin);
    }
    S.comenzi = noi;
    retineBaza();
    var semn = JSON.stringify(noi) + "|" + S.runda + "|" + S.rol + "|" + S.magazin + "|" + S.pas;
    if (semn === S.semnatura) { scrieStare(); return; }   // nimic nou, nu redesenam
    S.semnatura = semn;
    deseneazaDacaSePoate();
  });
}
function porneste() {
  if (S.ceas) { clearInterval(S.ceas); S.ceas = null; }
  incarcaBaza();
  Store.citesteSetare("produse").then(function (cfg) {
    if (cfg) S.cfg = { dezactivate: cfg.dezactivate || [], sterse: cfg.sterse || [], extra: cfg.extra || [] };
    recalculeazaCatalog();
    return Store.citesteSetare("istoric");
  }).then(function (ist) {
    S.istoric = ist || [];
    return incarca();
  });
  if (Store.mod === "supabase") {
    S.ceas = setInterval(function () { if (!document.hidden) incarca(); }, 8000);
  }
}
/* Comanda magazinului sta pe telefon pana cand vanzatoarea apasa "Trimite".
   Asa depozitul nu vede cantitatile pe jumatate scrise. */
function cheieDraft(mag) { return "unirea_draft_" + sesiuneKey() + "_" + mag; }
function cheieTrimis(mag) { return "unirea_trimis_" + sesiuneKey() + "_" + mag; }
function continut(c) {
  var l = {};
  var linii = liniiDin(c);
  Object.keys(linii).forEach(function (nr) { if (linii[nr].s > 0) l[nr] = linii[nr].s; });
  return JSON.stringify({ l: l, a: alteleDin(c), n: notaDin(c) });
}
function salveazaDraft(mag) {
  try { localStorage.setItem(cheieDraft(mag), JSON.stringify(S.comenzi[mag])); } catch (e) {}
}
function stergeDraft(mag) {
  try { localStorage.removeItem(cheieDraft(mag)); } catch (e) {}
}
function citesteDraft(mag) {
  try { return JSON.parse(localStorage.getItem(cheieDraft(mag)) || "null"); }
  catch (e) { return null; }
}
function citesteTrimis(mag) {
  try { return localStorage.getItem(cheieTrimis(mag)); } catch (e) { return null; }
}
function noteazaTrimis(mag, semn) {
  S.trimis[mag] = semn;
  try { localStorage.setItem(cheieTrimis(mag), semn); } catch (e) {}
}
function areNetrimise(c) {
  if (!c) return false;
  var acum = continut(c);
  if (acum === continut(null)) return false;          // nimic in cos
  return acum !== (S.trimis[S.magazin] || null);
}

function scrie(mag) {
  if (S.rol === "magazin") {        // ramane pe telefon pana la trimitere
    salveazaDraft(mag);
    scrieStare();
    return;
  }
  clearTimeout(S.timer);
  S.timer = setTimeout(function () {
    var c = S.comenzi[mag];
    if (!c) return;
    var acum = new Date().toISOString();
    // daca magazinul mai adauga ceva dupa ce depozitul a finalizat, lasam un semn
    var modificat = c.modificat || null;
    if (S.rol === "magazin" && c.status === "finalizata") modificat = acum;
    var doc = {
      id: docId(mag), sesiune: sesiuneKey(), data: azi(), runda: S.runda, magazin: mag,
      status: c.status || "draft", linii: c.linii || {}, altele: c.altele || [],
      actualizat: acum
    };
    if (modificat) doc.modificat = modificat;
    if (c.nota) doc.nota = c.nota;
    S.pendinte[mag] = true;
    Store.salveaza(doc).then(function () {
      S.pendinte[mag] = false;
      S.scrisLa[mag] = doc.actualizat;
      scrieStare();
    }).catch(function () { S.pendinte[mag] = false; scrieStare(); });
    scrieStare();
  }, 450);
}
function seteazaLinie(mag, nr, camp, val) {
  var c = S.comenzi[mag] || { status: "draft", linii: {} };
  var linii = {}; Object.keys(c.linii || {}).forEach(function (k) { linii[k] = c.linii[k]; });
  var l = {}; Object.keys(linii[nr] || {}).forEach(function (k) { l[k] = linii[nr][k]; });
  if (val === null || val === "" || isNaN(val) || val < 0) delete l[camp]; else l[camp] = val;
  if (Object.keys(l).length) linii[nr] = l; else delete linii[nr];
  S.comenzi[mag] = { status: c.status || "draft", linii: linii, altele: c.altele || [],
    nota: c.nota || "", modificat: c.modificat || null,
    magazin: mag, sesiune: sesiuneKey(), _local: true };
  scrie(mag);
}

/* Depozitul tine minte cum arata comanda cand a vazut-o prima data, ca sa
   stie ce s-a schimbat intre timp. Se pastreaza si peste o reincarcare. */
function cheieBaza() { return "unirea_baza_" + sesiuneKey(); }
function incarcaBaza() {
  try { S.baza = JSON.parse(localStorage.getItem(cheieBaza()) || "{}"); }
  catch (e) { S.baza = {}; }
}
function salveazaBaza() {
  try { localStorage.setItem(cheieBaza(), JSON.stringify(S.baza)); } catch (e) {}
}
function instantaneu(c) {
  var o = {};
  var linii = liniiDin(c);
  Object.keys(linii).forEach(function (nr) { if (linii[nr].s > 0) o[nr] = linii[nr].s; });
  return { l: o, a: alteleDin(c).length };
}
function retineBaza() {
  if (S.rol !== "depozit") return;
  var nou = false;
  CHEI.forEach(function (m) {
    if (S.comenzi[m] && !S.baza[m]) { S.baza[m] = instantaneu(S.comenzi[m]); nou = true; }
  });
  if (nou) salveazaBaza();
}
function confirmaBaza() {
  CHEI.forEach(function (m) { if (S.comenzi[m]) S.baza[m] = instantaneu(S.comenzi[m]); });
  salveazaBaza();
}
/* Ce s-a schimbat la un magazin fata de ce stia depozitul. */
function diferente(mag) {
  var b = S.baza[mag], c = S.comenzi[mag];
  var d = { adaugate: [], crescute: [], scazute: [], scoase: [], alte: 0 };
  if (!b || !c) return d;
  var acum = instantaneu(c);
  Object.keys(acum.l).forEach(function (nr) {
    var vechi = b.l[nr];
    if (vechi == null) d.adaugate.push(Number(nr));
    else if (acum.l[nr] > vechi) d.crescute.push(Number(nr));
    else if (acum.l[nr] < vechi) d.scazute.push(Number(nr));
  });
  Object.keys(b.l).forEach(function (nr) {
    if (acum.l[nr] == null) d.scoase.push(Number(nr));
  });
  d.alte = acum.a - b.a;
  return d;
}
function areDiferente(d) {
  return d.adaugate.length || d.crescute.length || d.scazute.length || d.scoase.length || d.alte;
}
function schimbatLa(mag, nr) {
  var d = diferente(mag);
  if (d.adaugate.indexOf(nr) >= 0) return "nou";
  if (d.crescute.indexOf(nr) >= 0 || d.scazute.indexOf(nr) >= 0) return "schimbat";
  if (d.scoase.indexOf(nr) >= 0) return "scos";
  return "";
}

/* La trimitere luam versiunea de pe server, ca sa nu stergem cantitatile
   completate de depozit la livrat, si punem peste ea ce a cerut magazinul. */
function trimiteComanda(mag) {
  var c = S.comenzi[mag];
  if (!c) return Promise.resolve();
  return Store.citeste(sesiuneKey()).then(function (randuri) {
    var rem = null;
    (randuri || []).forEach(function (r) { if (r && r.magazin === mag) rem = r; });
    var linii = {};
    var ale = liniiDin(c);
    Object.keys(ale).forEach(function (nr) { if (ale[nr].s > 0) linii[nr] = { s: ale[nr].s }; });
    var remL = liniiDin(rem);
    Object.keys(remL).forEach(function (nr) {
      if (remL[nr].l != null) {
        linii[nr] = linii[nr] || {};
        linii[nr].l = remL[nr].l;
      }
    });
    var acum = new Date().toISOString();
    var finalizata = !!(rem && rem.status === "finalizata");
    var doc = {
      id: docId(mag), sesiune: sesiuneKey(), data: azi(), runda: S.runda, magazin: mag,
      status: finalizata ? "finalizata" : "trimisa",
      linii: linii, altele: alteleDin(c), actualizat: acum
    };
    if (finalizata) doc.modificat = acum;          // depozitul trebuie anuntat
    if (notaDin(c)) doc.nota = notaDin(c);
    var semn = continut(c);
    S.pendinte[mag] = true;
    return Store.salveaza(doc).then(function () {
      S.pendinte[mag] = false;
      S.scrisLa[mag] = acum;
      noteazaTrimis(mag, semn);
      stergeDraft(mag);
      doc._local = false;
      S.comenzi[mag] = doc;
      scrieStare();
    }).catch(function (e) {
      S.pendinte[mag] = false;
      noteazaTrimis(mag, semn);     // a intrat in coada, pleaca singura
      scrieStare();
      throw e;
    });
  });
}

/* ------------------------------------------------------------------ desenat */
function tastezaCineva() {
  var a = document.activeElement;
  return !!(a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT"));
}
/* Reimprospatarea automata asteapta pana cand omul termina de scris. */
function deseneazaDacaSePoate() {
  if (tastezaCineva()) { S.redesenAmanat = true; return; }
  S.redesenAmanat = false;
  deseneaza();
}
document.addEventListener("focusout", function () {
  setTimeout(function () {
    if (S.redesenAmanat && !tastezaCineva()) { S.redesenAmanat = false; deseneaza(); }
  }, 150);
});

function deseneaza() {
  $("gate").hidden = !!S.rol;
  $("antet").hidden = !S.rol;
  $("magazinView").hidden = S.rol !== "magazin";
  $("depozitView").hidden = S.rol !== "depozit";
  $("actiuni").hidden = !S.rol;
  scrieInfoRunda();
  scrieStare();
  if (S.rol === "magazin") deseneazaMagazin();
  else if (S.rol === "depozit") deseneazaDepozit();
  else deseneazaGate();
}

function stareRetea(ok) {
  S.conectat = ok;
  if (ok) S.ultimaSinc = new Date().toISOString();
  scrieStare();
}
function scrieStare() {
  var el = $("stareSync");
  if (!el) return;
  var nes = Coada.marime();
  if (S.rol === "magazin" && !nes && areNetrimise(S.comenzi[S.magazin])) {
    el.className = "stare rau";
    el.textContent = "netrimisă";
    return;
  }
  if (Store.mod !== "supabase") {
    el.className = "stare local";
    el.textContent = "salvat pe telefon";
    return;
  }
  if (nes) {
    el.className = "stare rau";
    el.textContent = nes + (nes === 1 ? " modificare netrimisă" : " modificări netrimise");
  } else if (S.conectat === false) {
    el.className = "stare rau";
    el.textContent = "fără conexiune";
  } else {
    el.className = "stare bun";
    el.textContent = "sincronizat" + (S.ultimaSinc ? " " + doarOra(S.ultimaSinc) : "");
  }
}
function doarOra(iso) {
  try { return new Date(iso).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" }); }
  catch (e) { return ""; }
}

function scrieInfoRunda() {
  if (!S.runda) return;
  $("infoRunda").innerHTML = S.deschisaLa
    ? "Comandă deschisă <b>" + oraRo(S.deschisaLa) + "</b>"
    : "<b>Comandă deschisă</b>";
}

function deseneazaGate() {
  var n = $("notaMod");
  if (Store.mod === "supabase") {
    n.textContent = "Comenzile se sincronizează între telefoane. Magazinul scrie, depozitul vede imediat.";
  } else {
    n.textContent = "Mod local: comenzile rămân pe telefonul pe care au fost scrise. Pentru sincronizare între magazine și depozit se completează datele Supabase în config.js.";
  }
  var box = $("rolImplicit");
  box.innerHTML = "";
  var optiuni = CHEI.map(function (k) { return [k, MAGAZINE[k]]; });
  optiuni.push(["depozit", "Depozit"]);
  optiuni.push(["", "Întreabă-mă"]);
  var curent = rolImplicit();
  optiuni.forEach(function (pair) {
    var b = document.createElement("button");
    b.className = "chip"; b.type = "button"; b.textContent = pair[1];
    b.setAttribute("aria-pressed", String(curent === pair[0]));
    b.onclick = function () {
      setRolImplicit(pair[0]);
      deseneazaGate();
      toast(pair[0] ? "Aplicația se deschide de acum pe " + pair[1] : "Aplicația va întreba de fiecare dată");
    };
    box.appendChild(b);
  });
}

function rolImplicit() {
  try { return localStorage.getItem("unirea_rol_implicit") || ""; } catch (e) { return ""; }
}
function setRolImplicit(v) {
  try {
    if (v) localStorage.setItem("unirea_rol_implicit", v);
    else localStorage.removeItem("unirea_rol_implicit");
  } catch (e) {}
}

/* ------------------------------------------------------------------ magazin */
function deseneazaMagazin() {
  $("titlu").textContent = MAGAZINE[S.magazin];
  var c = comandaMea(), linii = liniiDin(c);
  var stare = (c && c.status) || "draft";
  var netrimise = areNetrimise(c);
  var pill = $("statusPill");
  pill.hidden = false;
  if (netrimise) {
    pill.textContent = stare === "draft" ? "Netrimisă" : "Modificată";
    pill.className = "pill asteapta";
  } else {
    pill.textContent = stare === "finalizata" ? "Preluată" : (stare === "trimisa" ? "Trimisă" : "În lucru");
    pill.className = "pill" + (stare === "draft" ? " asteapta" : " trimisa");
  }
  $("progresBar").style.width = Math.min(100, (pozitiiComanda(c) / 12) * 100) + "%";

  if (S.pas === "cos") { deseneazaCos(); return; }
  $("bara").hidden = false;
  $("categorii").hidden = false;

  var cat = $("categorii");
  cat.innerHTML = "";
  ["toate"].concat(S.categorii).forEach(function (k) {
    var b = document.createElement("button");
    b.className = "chip"; b.type = "button";
    var nr = S.active.filter(function (p) {
      return (k === "toate" || p.categorie === k) && (linii[p.nr] || {}).s > 0;
    }).length;
    b.textContent = (k === "toate" ? "Toate" : k);
    if (nr) { var sp = document.createElement("span"); sp.className = "cnt"; sp.textContent = nr; b.appendChild(sp); }
    b.setAttribute("aria-pressed", String(k === S.categorie));
    b.onclick = function () { S.categorie = k; deseneazaMagazin(); };
    cat.appendChild(b);
  });

  var q = S.filtru.trim().toLowerCase();
  var fara = function (t) { return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); };
  var vizibile = S.active.filter(function (p) {
    return (S.categorie === "toate" || p.categorie === S.categorie) &&
      (!q || fara(p.nume).indexOf(fara(q)) >= 0);
  });

  var lista = $("lista");
  lista.innerHTML = "";

  // produsele cerute cel mai des de acest magazin stau primele
  if (S.categorie === "toate" && !q && S.frecvente.length) {
    var frec = S.frecvente.map(produsDupaNr).filter(function (p) {
      return p && S.active.indexOf(p) >= 0;
    }).slice(0, 10);
    if (frec.length) {
      var sf = document.createElement("section"); sf.className = "grup";
      var hf = document.createElement("h2"); hf.textContent = "Comandate des"; sf.appendChild(hf);
      frec.forEach(function (p) { sf.appendChild(randProdus(p, linii[p.nr] || {}, "f")); });
      lista.appendChild(sf);
    }
  }

  S.categorii.forEach(function (catg) {
    var items = vizibile.filter(function (p) { return p.categorie === catg; });
    var nota = (window.NOTA_CATEGORIE || {})[catg];
    var aratNota = nota && !q && (S.categorie === "toate" || S.categorie === catg);
    if (!items.length && !aratNota) return;
    var sec = document.createElement("section"); sec.className = "grup";
    var h = document.createElement("h2"); h.textContent = catg; sec.appendChild(h);
    items.forEach(function (p) { sec.appendChild(randProdus(p, linii[p.nr] || {}, "c")); });
    if (!items.length && aratNota) {
      var pn = document.createElement("p"); pn.className = "gol"; pn.textContent = nota;
      sec.appendChild(pn);
    }
    if (catg === "Diverse") sec.appendChild(blocAltele(c));
    lista.appendChild(sec);
  });

  if (!vizibile.length && q) {
    var g = document.createElement("p"); g.className = "gol";
    g.textContent = "Niciun produs nu se potrivește căutării.";
    lista.appendChild(g);
  }
  actualizeazaSumar();
}

function randProdus(p, l, prefix) {
  var rand = document.createElement("div");
  rand.className = "rand" + (l.s > 0 ? " plin" : "");
  var info = document.createElement("div"); info.className = "info";
  var nume = document.createElement("div"); nume.className = "nume"; nume.textContent = p.nume;
  var sub = document.createElement("div"); sub.className = "sub";
  var scrieSub = function (v) {
    var t = [];
    if (PAS_5[p.nr]) t.push("din 5 în 5");
    if (v > 0) t.push(cant(v) + (v === 1 ? " bucată" : " bucăți"));
    sub.textContent = t.join("   •   ");
    sub.hidden = !t.length;
  };
  scrieSub(l.s);
  info.appendChild(nume); info.appendChild(sub);

  var st = document.createElement("div"); st.className = "stepper";
  var minus = document.createElement("button"); minus.type = "button"; minus.textContent = "−";
  minus.setAttribute("aria-label", "Scade " + p.nume);
  var inp = document.createElement("input");
  inp.type = "number"; inp.inputMode = "numeric"; inp.min = "0"; inp.step = String(pasCerere(p));
  inp.id = "q" + (prefix || "c") + "_" + p.nr; inp.placeholder = "0";
  inp.value = (l.s != null ? l.s : "");
  inp.setAttribute("aria-label", p.nume);
  var plus = document.createElement("button"); plus.type = "button"; plus.textContent = "+";
  plus.setAttribute("aria-label", "Adaugă " + p.nume);

  var aplica = function (v) {
    if (v !== null && v <= 0) v = null;
    inp.value = v === null ? "" : v;
    seteazaLinie(S.magazin, p.nr, "s", v);
    rand.classList.toggle("plin", v > 0);
    scrieSub(v);
    sincronizeazaGeamanul(p, v, inp.id);
    actualizeazaSumar();
  };
  var pas = function (semn) {
    var d = pasCerere(p);
    var cur = Math.round((parseFloat(inp.value) || 0) / d) * d;
    aplica(cur + semn * d);
  };
  minus.onclick = function () { pas(-1); };
  plus.onclick = function () { pas(1); };
  inp.oninput = function (e) {
    var v = e.target.value === "" ? null : parseFloat(e.target.value);
    seteazaLinie(S.magazin, p.nr, "s", v);
    rand.classList.toggle("plin", v > 0);
    scrieSub(v);
    sincronizeazaGeamanul(p, v, inp.id);
    actualizeazaSumar();
  };
  // dupa ce termina de tastat, aducem cantitatea la pasul produsului
  inp.onchange = function (e) {
    var v = e.target.value === "" ? null : parseFloat(e.target.value);
    var r = rotunjestePas(p, v);
    if (r !== v) { aplica(r); if (v != null) toast(p.nume + " se cere din 5 în 5 — am pus " + cant(r || 0)); }
  };
  inp.onfocus = function () { inp.select(); };

  st.appendChild(minus); st.appendChild(inp); st.appendChild(plus);
  var um = document.createElement("span"); um.className = "um"; um.textContent = "buc";
  rand.appendChild(info); rand.appendChild(st); rand.appendChild(um);
  return rand;
}

/* acelasi produs poate aparea si la "Comandate des" si in categoria lui:
   tinem cele doua campuri pe aceeasi valoare, fara sa redesenam toata lista */
function sincronizeazaGeamanul(p, v, idCurent) {
  ["f", "c", "k"].forEach(function (pref) {
    var id = "q" + pref + "_" + p.nr;
    if (id === idCurent) return;
    var el = document.getElementById(id);
    if (!el) return;
    el.value = (v == null ? "" : v);
    var r = el.closest(".rand");
    if (r) r.classList.toggle("plin", v > 0);
  });
}

/* Cererile scrise de mana, pentru ce nu e in lista (pixuri, mop, galeata...). */
function salveazaAltele(arr) {
  var c = S.comenzi[S.magazin] || { status: "draft", linii: {} };
  c.altele = arr; c._local = true;
  S.comenzi[S.magazin] = c;
  scrie(S.magazin);
}
function salveazaNota(text) {
  var c = S.comenzi[S.magazin] || { status: "draft", linii: {} };
  c.nota = text; c._local = true;
  S.comenzi[S.magazin] = c;
  scrie(S.magazin);
}
function blocNota(c) {
  var box = document.createElement("div"); box.className = "nota-bloc";
  var tit = document.createElement("label"); tit.className = "altele-tit";
  tit.setAttribute("for", "notaText");
  tit.textContent = "Mesaj pentru depozit";
  var ta = document.createElement("textarea");
  ta.id = "notaText"; ta.rows = 3;
  ta.placeholder = "ex. brânza de ieri a venit prea sărată; trimiteți mai devreme, avem inventar";
  ta.value = notaDin(c);
  ta.oninput = function () { salveazaNota(ta.value); };
  box.appendChild(tit); box.appendChild(ta);
  return box;
}
function blocAltele(c) {
  var arr = alteleDin(c);
  var box = document.createElement("div"); box.className = "altele";
  var tit = document.createElement("div"); tit.className = "altele-tit";
  tit.textContent = "Altele — scrie ce mai ai nevoie";
  box.appendChild(tit);

  arr.forEach(function (it, i) {
    var rand = document.createElement("div"); rand.className = "rand plin";
    var info = document.createElement("div"); info.className = "info";
    var nume = document.createElement("div"); nume.className = "nume"; nume.textContent = it.t;
    info.appendChild(nume);
    var st = document.createElement("div"); st.className = "stepper";
    var minus = document.createElement("button"); minus.type = "button"; minus.textContent = "−";
    var inp = document.createElement("input");
    inp.type = "number"; inp.inputMode = "numeric"; inp.min = "1"; inp.value = it.s || 1;
    inp.setAttribute("aria-label", it.t);
    var plus = document.createElement("button"); plus.type = "button"; plus.textContent = "+";
    var pune = function (v) {
      if (v < 1) v = 1;
      inp.value = v; arr[i].s = v; salveazaAltele(arr); actualizeazaSumar();
    };
    minus.onclick = function () { pune((parseFloat(inp.value) || 1) - 1); };
    plus.onclick = function () { pune((parseFloat(inp.value) || 0) + 1); };
    inp.onchange = function () { pune(parseFloat(inp.value) || 1); };
    st.appendChild(minus); st.appendChild(inp); st.appendChild(plus);
    var sterge = document.createElement("button");
    sterge.className = "sterge"; sterge.type = "button"; sterge.textContent = "✕";
    sterge.setAttribute("aria-label", "Șterge " + it.t);
    sterge.onclick = function () { arr.splice(i, 1); salveazaAltele(arr); deseneazaMagazin(); };
    rand.appendChild(info); rand.appendChild(st); rand.appendChild(sterge);
    box.appendChild(rand);
  });

  var adaug = document.createElement("div"); adaug.className = "adauga";
  var text = document.createElement("input");
  text.type = "text"; text.placeholder = "ex. etichete"; text.id = "altText";
  text.setAttribute("aria-label", "Produs nou");
  var buton = document.createElement("button");
  buton.className = "btn mic"; buton.type = "button"; buton.textContent = "Adaugă";
  var adauga = function () {
    var t = text.value.trim();
    if (!t) return;
    arr.push({ t: t, s: 1 });
    salveazaAltele(arr);
    deseneazaMagazin();
    toast("Am adăugat „" + t + "”");
  };
  buton.onclick = adauga;
  text.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); adauga(); } };
  adaug.appendChild(text); adaug.appendChild(buton);
  box.appendChild(adaug);
  return box;
}

/* ------------------------------------------------------------------ cosul */
function deseneazaCos() {
  $("bara").hidden = true;
  $("categorii").hidden = true;
  var c = comandaMea(), linii = liniiDin(c), arr = alteleDin(c);
  var lista = $("lista");
  lista.innerHTML = "";

  var n = pozitiiComanda(c);
  var cap = document.createElement("div"); cap.className = "cos-cap";
  var h = document.createElement("h2"); h.textContent = "Verifică comanda";
  var p = document.createElement("p");
  p.textContent = n + (n === 1 ? " produs" : " produse") +
    " în comanda curentă. Mai poți schimba cantitățile aici.";
  cap.appendChild(h); cap.appendChild(p);
  lista.appendChild(cap);

  var ceva = false;
  S.categorii.forEach(function (catg) {
    var items = S.tot.filter(function (pr) {
      return pr.categorie === catg && (linii[pr.nr] || {}).s > 0;
    });
    if (!items.length) return;
    ceva = true;
    var sec = document.createElement("section"); sec.className = "grup";
    var hc = document.createElement("h2"); hc.textContent = catg; sec.appendChild(hc);
    items.forEach(function (pr) { sec.appendChild(randProdus(pr, linii[pr.nr] || {}, "k")); });
    lista.appendChild(sec);
  });

  if (arr.length) {
    ceva = true;
    var sa = document.createElement("section"); sa.className = "grup";
    var ha = document.createElement("h2"); ha.textContent = "Altele"; sa.appendChild(ha);
    arr.forEach(function (it) {
      var rand = document.createElement("div"); rand.className = "rand";
      var info = document.createElement("div"); info.className = "info";
      var nume = document.createElement("div"); nume.className = "nume"; nume.textContent = it.t;
      info.appendChild(nume);
      var val = document.createElement("span"); val.className = "cos-cant";
      val.textContent = cant(it.s || 1) + " buc";
      rand.appendChild(info); rand.appendChild(val);
      sa.appendChild(rand);
    });
    lista.appendChild(sa);
  }

  if (!ceva) {
    var g = document.createElement("p"); g.className = "gol";
    g.textContent = "Coșul este gol. Întoarce-te la listă și pune cantitățile.";
    lista.appendChild(g);
  }
  lista.appendChild(blocNota(c));
  actualizeazaSumar();
}

function actualizeazaSumar() {
  if (S.rol !== "magazin") return;
  var c = comandaMea();
  var n = pozitiiComanda(c);
  var trimisa = !!(c && c.status && c.status !== "draft");
  var netrimise = areNetrimise(c);
  var stareText = netrimise
    ? (trimisa ? "modificări netrimise" : "încă nu a plecat la depozit")
    : (trimisa ? "trimisă la depozit" : "în comanda curentă");
  $("sumar").innerHTML = "<b>" + n + (n === 1 ? " produs" : " produse") + "</b>" +
    (S.pas === "cos" ? "verifică și trimite" : stareText);
  $("progresBar").style.width = Math.min(100, (n / 12) * 100) + "%";
  var princ = $("btnPrincipal"), sec = $("btnSecundar");
  princ.className = "btn primary";
  sec.className = "btn";
  sec.disabled = false;
  if (S.pas === "cos") {
    princ.textContent = trimisa ? "Retrimite comanda" : "Trimite comanda";
    princ.disabled = n === 0 || (trimisa && !netrimise);
    sec.hidden = false; sec.textContent = "Înapoi la listă";
  } else {
    princ.textContent = "Vezi coșul" + (n ? " · " + n : "");
    princ.disabled = n === 0;
    sec.hidden = !trimisa; sec.textContent = "Golește";
  }
}

/* ------------------------------------------------------------------ depozit */
function deseneazaDepozit() {
  $("titlu").textContent = "Depozit";
  var gata = CHEI.filter(function (m) { return esteFinalizata(m); }).length;
  $("statusPill").hidden = true;
  $("progresBar").style.width = (gata / CHEI.length) * 100 + "%";

  var carduri = $("statusMagazine"); carduri.innerHTML = "";
  carduri.hidden = (S.depTab === "catalog" || S.depTab === "istoric");
  CHEI.forEach(function (id) {
    var c = S.comenzi[id];
    var d = document.createElement("div");
    d.className = "card" + (c && c.status !== "draft" ? " gata" : "") +
      (esteFinalizata(id) ? " incheiat" : "");
    var e = document.createElement("div"); e.className = "et"; e.textContent = MAGAZINE[id];
    var v = document.createElement("div"); v.className = "val";
    v.textContent = pozitiiComanda(c);
    var sm = document.createElement("small"); sm.textContent = " produse"; v.appendChild(sm);
    var st = document.createElement("div"); st.className = "st";
    var etStare = !c ? "nimic încă" :
      (c.status === "finalizata" ? "finalizată" : (c.status === "trimisa" ? "trimisă" : "în lucru"));
    st.textContent = cant(bucatiComanda(c)) + " buc  •  " + etStare;
    d.appendChild(e); d.appendChild(v); d.appendChild(st);
    carduri.appendChild(d);
  });

  var tabs = $("depTabs"); tabs.innerHTML = "";
  var file = [["centralizator", "Centralizator"]]
    .concat(CHEI.map(function (k) { return [k, MAGAZINE[k]]; }))
    .concat([["catalog", "Produse"], ["istoric", "Istoric"]]);
  file.forEach(function (pair) {
    var b = document.createElement("button"); b.className = "chip"; b.type = "button"; b.textContent = pair[1];
    b.setAttribute("aria-pressed", String(S.depTab === pair[0]));
    b.onclick = function () {
      S.depTab = pair[0]; S.confirmaFinal = false; S.confirmaSterg = null;
      deseneazaDepozit();
    };
    tabs.appendChild(b);
  });

  avertizeazaModificari();

  var zona = $("depozitContinut"); zona.innerHTML = "";
  if (S.depTab === "istoric") {
    zona.appendChild(ecranIstoric());
    princBtnIstoric();
    return;
  }
  if (S.depTab === "catalog") {
    zona.appendChild(ecranCatalog());
  } else {
    var magsAici = (S.depTab === "centralizator" ? CHEI : [S.depTab]);
    magsAici.forEach(function (m) {
      var nt = notaDin(S.comenzi[m]);
      if (nt) zona.appendChild(randNota(nt, MAGAZINE[m]));
    });
    zona.appendChild(S.depTab === "centralizator" ? tabelCentralizator() : tabelMagazin(S.depTab));
    var sp = tabelAltele(magsAici);
    if (sp) zona.appendChild(sp);
  }

  var princ = $("btnPrincipal"), sec = $("btnSecundar");
  princ.className = "btn primary";
  if (S.depTab === "catalog") {
    princ.textContent = "Înapoi la comandă";
    princ.disabled = false;
    sec.hidden = true;
    $("sumar").innerHTML = "<b>" + S.active.length + " produse active</b>din " + S.catalog.length + " în listă";
    return;
  }
  if (S.depTab === "centralizator") {
    princ.textContent = S.confirmaFinal ? "Sigur? Apasă din nou" : "Livrează comanda";
    princ.className = "btn primary" + (S.confirmaFinal ? " confirma" : "");
    princ.disabled = !toateFinalizate();
    sec.hidden = true;
  } else {
    var fin = esteFinalizata(S.depTab);
    princ.textContent = fin ? ("Reeditează " + MAGAZINE[S.depTab]) : ("Finalizează " + MAGAZINE[S.depTab]);
    princ.className = "btn" + (fin ? "" : " primary");
    princ.disabled = !S.comenzi[S.depTab];
    sec.hidden = true;
  }
  sumarDepozit();
}

/* Magazinele pot schimba comanda in timp ce depozitul pregateste marfa.
   Nu stergem nimic din ce s-a completat; doar spunem ce s-a schimbat. */
function descrieDiferente(mag, d) {
  var parti = [];
  var nume = function (nr) { var p = produsDupaNr(nr); return p ? p.nume : "un produs"; };
  if (d.adaugate.length) parti.push("a adăugat " + d.adaugate.map(nume).join(", "));
  if (d.crescute.length) parti.push("a mărit " + d.crescute.map(nume).join(", "));
  if (d.scazute.length) parti.push("a redus " + d.scazute.map(nume).join(", "));
  if (d.scoase.length) parti.push("a scos " + d.scoase.map(nume).join(", "));
  if (d.alte > 0) parti.push("a scris " + d.alte + (d.alte === 1 ? " cerere nouă" : " cereri noi"));
  return MAGAZINE[mag] + " " + parti.join(", ") + ".";
}

function avertizeazaModificari() {
  var ban = $("avertisment");
  ban.innerHTML = "";
  var mesaje = [];
  CHEI.forEach(function (m) {
    if (!S.comenzi[m]) return;
    var d = diferente(m);
    if (areDiferente(d)) mesaje.push({ m: m, text: descrieDiferente(m, d) });
    else if (esteFinalizata(m) && S.comenzi[m].modificat) {
      mesaje.push({ m: m, text: MAGAZINE[m] + " a modificat comanda după finalizare (" +
        oraRo(S.comenzi[m].modificat) + ")." });
    }
  });
  if (!mesaje.length) { ban.hidden = true; return; }
  ban.hidden = false;
  var txt = document.createElement("span");
  txt.textContent = mesaje.map(function (x) { return x.text; }).join(" ");
  var b = document.createElement("button");
  b.type = "button"; b.textContent = "Am văzut";
  b.onclick = function () { confirmaBaza(); S.semnatura = null; deseneazaDepozit(); };
  ban.appendChild(txt); ban.appendChild(b);
  mesaje.forEach(function (x) {
    if (S.alertat[x.m] !== x.text) {
      S.alertat[x.m] = x.text;
      toast(x.text);
    }
  });
}

function princBtnIstoric() {
  var princ = $("btnPrincipal"), sec = $("btnSecundar");
  princ.textContent = "Înapoi la comandă";
  princ.className = "btn primary"; princ.disabled = false;
  sec.hidden = true;
  $("sumar").innerHTML = "<b>Istoric</b>comenzile livrate";
}

function sumarDepozit() {
  var tP = CHEI.reduce(function (t, m) { return t + pozitiiComanda(S.comenzi[m]); }, 0);
  var tL = CHEI.reduce(function (t, m) { return t + valoare(liniiDin(S.comenzi[m]), "l"); }, 0);
  $("sumar").innerHTML = "<b>" + tP + " produse cerute</b>livrat " + lei(tL) + " lei";
}

function finalizeazaRunda() {
  var urmatoare = (S.runda || 1) + 1;
  var acum = new Date().toISOString();
  var intrare = { r: S.runda, t: acum, m: {} };
  CHEI.forEach(function (m) {
    var c = S.comenzi[m];
    if (!c) return;
    intrare.m[m] = { p: pozitiiComanda(c), v: Math.round(valoare(liniiDin(c), "l") * 100) / 100 };
  });
  var istoric = [intrare].concat(S.istoric || []).slice(0, 60);
  Store.scrieSetare("istoric", istoric).then(function () {
    S.istoric = istoric;
    return Store.scrieSetare("runda", { n: urmatoare, deschisaLa: acum });
  }).then(function () {
    S.confirmaFinal = false;
    S.comenzi = {};
    S.alertat = {};
    S.istoricDate = {};
    S.baza = {}; S.semnatura = null;
    return incarca();
  }).then(function () {
    toast("Comandă livrată");
  }).catch(function () { toast("Nu am putut finaliza. Încearcă din nou."); });
}

/* ------------------------------------------------------------------ istoric */
function ecranIstoric() {
  var zona = document.createElement("div");
  if (!S.istoric || !S.istoric.length) {
    zona.appendChild(goliciune("Nicio comandă livrată încă. Aici vor apărea, cu data și ora livrării."));
    return zona;
  }
  S.istoric.forEach(function (it) {
    var card = document.createElement("div"); card.className = "istoric-rand";
    var deschis = S.istoricDeschis === it.r;

    var cap = document.createElement("button");
    cap.type = "button"; cap.className = "istoric-cap";
    var stanga = document.createElement("span"); stanga.className = "info";
    var data = document.createElement("span"); data.className = "istoric-data";
    data.textContent = oraRo(it.t);
    var sub = document.createElement("span"); sub.className = "sub";
    sub.textContent = CHEI.map(function (m) {
      var d = (it.m || {})[m];
      return MAGAZINE[m] + ": " + (d ? d.p + " produse" : "–");
    }).join("   •   ");
    stanga.appendChild(data); stanga.appendChild(sub);
    var sag = document.createElement("span"); sag.className = "sag";
    sag.textContent = deschis ? "▴" : "▾";
    cap.appendChild(stanga); cap.appendChild(sag);
    cap.onclick = function () {
      S.istoricDeschis = deschis ? null : it.r;
      S.istoricEdit = null; S.confirmaStergIstoric = null;
      deseneazaDepozit();
    };
    card.appendChild(cap);

    if (deschis) {
      var loc = document.createElement("div"); loc.className = "istoric-detaliu";
      card.appendChild(loc);
      var gata = S.istoricDate[it.r];
      if (gata) deseneazaDetaliuIstoric(loc, it, gata);
      else {
        loc.textContent = "Se încarcă...";
        Store.citeste("r" + it.r).then(function (randuri) {
          var map = {};
          (randuri || []).forEach(function (c) { if (c && c.magazin) map[c.magazin] = c; });
          S.istoricDate[it.r] = map;
          if (S.istoricDeschis === it.r) { loc.innerHTML = ""; deseneazaDetaliuIstoric(loc, it, map); }
        });
      }
    }
    zona.appendChild(card);
  });
  return zona;
}

function deseneazaDetaliuIstoric(loc, it, map) {
  loc.innerHTML = "";
  var areCeva = CHEI.some(function (m) { return map[m]; });
  if (!areCeva) {
    var g = document.createElement("p"); g.className = "gol";
    g.textContent = "Comenzile nu mai sunt în baza de date.";
    loc.appendChild(g);
  }
  var editez = S.istoricEdit === it.r;

  CHEI.forEach(function (m) {
    var c = map[m];
    if (!c) return;
    var h = document.createElement("div"); h.className = "altele-tit";
    h.textContent = MAGAZINE[m];
    loc.appendChild(h);
    if (notaDin(c)) loc.appendChild(randNota(notaDin(c), MAGAZINE[m]));
    loc.appendChild(tabelIstoric(c, editez));
  });

  var bare = document.createElement("div"); bare.className = "istoric-butoane";

  var edit = document.createElement("button");
  edit.className = "btn mic"; edit.type = "button";
  edit.textContent = editez ? "Gata, salvează" : "Editează";
  edit.onclick = function () {
    if (!editez) { S.istoricEdit = it.r; deseneazaDepozit(); return; }
    var treaba = CHEI.filter(function (m) { return map[m] && map[m]._modificat; })
      .map(function (m) {
        var c = map[m]; delete c._modificat;
        return Store.salveaza(c);
      });
    Promise.all(treaba).then(function () {
      S.istoricEdit = null;
      deseneazaDepozit();
      toast(treaba.length ? "Modificările au fost salvate" : "Nu era nimic de salvat");
    }).catch(function () { toast("Nu am putut salva. Verific conexiunea."); });
  };
  bare.appendChild(edit);

  var intreaba = S.confirmaStergIstoric === it.r;
  var sterge = document.createElement("button");
  sterge.className = "btn mic" + (intreaba ? " confirma" : "");
  sterge.type = "button";
  sterge.textContent = intreaba ? "Sigur ștergi comanda?" : "Șterge";
  sterge.onclick = function () {
    if (!intreaba) { S.confirmaStergIstoric = it.r; deseneazaDepozit(); return; }
    var treaba = CHEI.filter(function (m) { return map[m]; })
      .map(function (m) { return Store.sterge(map[m].id); });
    Promise.all(treaba).then(function () {
      var istoric = S.istoric.filter(function (x) { return x.r !== it.r; });
      return Store.scrieSetare("istoric", istoric).then(function () {
        S.istoric = istoric;
        delete S.istoricDate[it.r];
        S.istoricDeschis = null; S.confirmaStergIstoric = null; S.istoricEdit = null;
        deseneazaDepozit();
        toast("Comanda a fost ștearsă din istoric");
      });
    }).catch(function () { toast("Nu am putut șterge. Verific conexiunea."); });
  };
  bare.appendChild(sterge);

  loc.appendChild(bare);
}

function tabelIstoric(c, editabil) {
  var linii = liniiDin(c);
  var box = document.createElement("div"); box.className = "tabela";
  var tab = document.createElement("table");
  tab.innerHTML = '<thead><tr><th>Produs</th><th class="num">Cerut buc</th>' +
    '<th class="num">Livrat</th><th>U/M</th></tr></thead>';
  var tb = document.createElement("tbody");
  S.tot.forEach(function (p) {
    var l = linii[p.nr] || {};
    if (!(l.s > 0 || l.l > 0)) return;
    var tr = document.createElement("tr");
    tr.innerHTML = "<td>" + p.nume + '</td><td class="num">' + cant(l.s || 0) + "</td>";
    var tdL = document.createElement("td"); tdL.className = "num";
    if (editabil) {
      var inp = document.createElement("input");
      inp.className = "liv"; inp.type = "number"; inp.inputMode = "decimal";
      inp.min = "0"; inp.step = p.um === "Buc" ? "1" : "0.1";
      inp.value = (l.l != null ? l.l : "");
      inp.setAttribute("aria-label", "Livrat " + p.nume);
      inp.oninput = function (e) {
        var v = e.target.value === "" ? null : parseFloat(e.target.value);
        if (v == null || isNaN(v)) delete linii[p.nr].l; else linii[p.nr].l = v;
        c._modificat = true;
      };
      tdL.appendChild(inp);
    } else {
      tdL.textContent = (l.l != null ? cant(l.l) : "–");
    }
    var tdU = document.createElement("td"); tdU.textContent = p.um;
    tr.appendChild(tdL); tr.appendChild(tdU);
    tb.appendChild(tr);
  });
  alteleDin(c).forEach(function (it) {
    var tr = document.createElement("tr");
    tr.innerHTML = "<td>" + it.t + '</td><td class="num">' + cant(it.s || 1) + "</td>" +
      '<td class="num">–</td><td>Buc</td>';
    tb.appendChild(tr);
  });
  tab.appendChild(tb); box.appendChild(tab);
  return box;
}

/* ------------------------------------------------------- catalogul de produse */
function ecranCatalog() {
  var zona = document.createElement("div");
  var intro = document.createElement("p"); intro.className = "nota";
  intro.textContent = "Comutatorul stins scoate produsul din lista magazinelor. Un produs stins poate fi apoi șters definitiv cu ✕. Produsele adăugate aici apar imediat la ambele magazine.";
  zona.appendChild(intro);

  S.categorii.forEach(function (catg) {
    var items = S.catalog.filter(function (p) { return p.categorie === catg; });
    if (!items.length) return;
    var sec = document.createElement("section"); sec.className = "grup";
    var h = document.createElement("h2"); h.textContent = catg; sec.appendChild(h);
    items.forEach(function (p) {
      var activ = (S.cfg.dezactivate || []).indexOf(p.nr) < 0;
      var rand = document.createElement("div"); rand.className = "catalog-rand" + (activ ? "" : " stins");
      var info = document.createElement("div"); info.className = "info";
      var nume = document.createElement("div"); nume.className = "nume"; nume.textContent = p.nume;
      var sub = document.createElement("div"); sub.className = "sub";
      sub.textContent = p.um + (p.pret != null ? "  •  " + lei(p.pret) + " lei" : "  •  fără preț");
      info.appendChild(nume); info.appendChild(sub);
      var com = document.createElement("button");
      com.className = "comuta"; com.type = "button";
      com.setAttribute("aria-pressed", String(activ));
      com.setAttribute("aria-label", (activ ? "Scoate din listă: " : "Pune înapoi în listă: ") + p.nume);
      com.onclick = function () {
        var dez = (S.cfg.dezactivate || []).slice();
        var i = dez.indexOf(p.nr);
        if (i >= 0) dez.splice(i, 1); else dez.push(p.nr);
        S.cfg.dezactivate = dez;
        salveazaCatalog().then(function () { deseneazaDepozit(); });
      };
      rand.appendChild(info); rand.appendChild(com);
      // stergerea definitiva e posibila doar dupa ce produsul a fost stins
      if (!activ) {
        var intreaba = S.confirmaSterg === p.nr;
        var sterge = document.createElement("button");
        sterge.type = "button";
        sterge.className = intreaba ? "btn mic confirma" : "sterge";
        sterge.textContent = intreaba ? "Sigur ștergi?" : "✕";
        sterge.setAttribute("aria-label", "Șterge din listă: " + p.nume);
        sterge.onclick = function () {
          if (!intreaba) { S.confirmaSterg = p.nr; deseneazaDepozit(); return; }
          S.cfg.sterse = (S.cfg.sterse || []).concat([p.nr]);
          S.cfg.extra = (S.cfg.extra || []).filter(function (e) { return e.nr !== p.nr; });
          S.confirmaSterg = null;
          salveazaCatalog().then(function () { deseneazaDepozit(); });
          toast("Am șters „" + p.nume + "” din listă");
        };
        rand.appendChild(sterge);
      }
      sec.appendChild(rand);
    });
    zona.appendChild(sec);
  });

  zona.appendChild(formularProdusNou());
  return zona;
}

function formularProdusNou() {
  var f = document.createElement("div"); f.className = "form-produs";
  var tit = document.createElement("div"); tit.className = "altele-tit lat";
  tit.textContent = "Adaugă produs";
  var nume = document.createElement("input");
  nume.type = "text"; nume.placeholder = "Denumire"; nume.className = "lat";
  nume.setAttribute("aria-label", "Denumire produs");
  var categ = document.createElement("input");
  categ.type = "text"; categ.placeholder = "Secțiune (ex. Cămară)";
  categ.setAttribute("aria-label", "Secțiune");
  categ.setAttribute("list", "listaCategorii");
  var dl = document.createElement("datalist"); dl.id = "listaCategorii";
  S.categorii.forEach(function (c) { var o = document.createElement("option"); o.value = c; dl.appendChild(o); });
  var um = document.createElement("select");
  um.setAttribute("aria-label", "Unitate de măsură");
  UM_POSIBILE.forEach(function (u) { var o = document.createElement("option"); o.value = u; o.textContent = u; um.appendChild(o); });
  var pret = document.createElement("input");
  pret.type = "number"; pret.step = "0.01"; pret.min = "0"; pret.placeholder = "Preț (opțional)";
  pret.setAttribute("aria-label", "Preț");
  var buton = document.createElement("button");
  buton.className = "btn primary lat"; buton.type = "button"; buton.textContent = "Adaugă în catalog";
  buton.onclick = function () {
    var n = nume.value.trim();
    if (!n) { toast("Scrie denumirea produsului"); return; }
    var maxNr = S.tot.reduce(function (m, p) { return Math.max(m, p.nr); }, 0);
    var p = {
      nr: Math.max(maxNr + 1, 100),
      nume: n,
      um: um.value || "Buc",
      pret: pret.value === "" ? null : parseFloat(pret.value),
      categorie: categ.value.trim() || "Diverse"
    };
    S.cfg.extra = (S.cfg.extra || []).concat([p]);
    salveazaCatalog().then(function () {
      nume.value = ""; pret.value = "";
      deseneazaDepozit();
      toast("Am adăugat „" + p.nume + "” la " + p.categorie);
    });
  };
  f.appendChild(tit); f.appendChild(nume); f.appendChild(categ); f.appendChild(um);
  f.appendChild(pret); f.appendChild(dl); f.appendChild(buton);
  return f;
}

/* ------------------------------------------------------------------ tabele */
function tabelCentralizator() {
  var produse = cerute();
  if (!produse.length) return goliciune("Niciun magazin nu a cerut încă ceva pentru comanda curentă.");
  produse = produse.slice().sort(function (a, b) {
    return S.categorii.indexOf(a.categorie) - S.categorii.indexOf(b.categorie);
  });
  var box = document.createElement("div"); box.className = "tabela";
  var h = "<table><thead><tr><th>Produs</th>";
  CHEI.forEach(function (m) { h += '<th class="num">' + MAGAZINE[m] + "</th>"; });
  h += '<th class="num">Total buc</th><th class="num">Livrat</th><th>U/M</th></tr></thead><tbody>';
  var tot = 0, catCurenta = null;
  produse.forEach(function (p) {
    if (p.categorie !== catCurenta) {
      catCurenta = p.categorie;
      h += '<tr class="cat"><td colspan="' + (4 + CHEI.length) + '">' + catCurenta + "</td></tr>";
    }
    var q = CHEI.map(function (m) { return (liniiDin(S.comenzi[m])[p.nr] || {}).s || 0; });
    var marci = CHEI.map(function (m) { return schimbatLa(m, p.nr); });
    var t = q.reduce(function (a, b) { return a + b; }, 0);
    var liv = CHEI.reduce(function (a, m) {
      var l = liniiDin(S.comenzi[m])[p.nr] || {};
      return a + (l.l != null ? l.l : 0);
    }, 0);
    var areLiv = CHEI.some(function (m) { return (liniiDin(S.comenzi[m])[p.nr] || {}).l != null; });
    tot += liv * (p.pret || 0);
    var randMarcat = marci.filter(Boolean).length ? " marcat" : "";
    h += '<tr class="' + randMarcat.slice(1) + '"><td>' + p.nume + "</td>";
    q.forEach(function (v, i) {
      h += '<td class="num ' + marci[i] + '">' + (v ? cant(v) : "–") + "</td>";
    });
    h += '<td class="num"><b>' + cant(t) + "</b></td>";
    h += '<td class="num' + (areLiv ? " dif" : "") + '">' + (areLiv ? cant(liv) : "–") + "</td>";
    h += "<td>" + p.um + "</td></tr>";
  });
  h += '<tr class="total"><td>Produse cerute</td>';
  var totP = 0;
  CHEI.forEach(function (m) {
    var b = pozitiiComanda(S.comenzi[m]); totP += b;
    h += '<td class="num">' + b + "</td>";
  });
  h += '<td class="num">' + totP + '</td><td class="num">' + lei(tot) + " lei</td><td></td></tr></tbody></table>";
  box.innerHTML = h;
  return box;
}

function randNota(text, cine) {
  var d = document.createElement("div"); d.className = "nota-mesaj";
  var et = document.createElement("span"); et.className = "altele-tit";
  et.textContent = "Mesaj de la " + cine;
  var p = document.createElement("p"); p.textContent = text;
  d.appendChild(et); d.appendChild(p);
  return d;
}

function tabelMagazin(mag) {
  var linii = liniiDin(S.comenzi[mag]);
  var blocat = esteFinalizata(mag);
  var b = S.baza[mag];
  var produse = S.tot.filter(function (p) {
    var l = linii[p.nr] || {};
    return l.s > 0 || l.l > 0 || !!(b && b.l[p.nr]);
  });
  if (!produse.length) return goliciune(MAGAZINE[mag] + " nu a trimis încă nimic pentru comanda curentă.");
  produse = produse.slice().sort(function (a, b2) {
    return S.categorii.indexOf(a.categorie) - S.categorii.indexOf(b2.categorie);
  });
  var box = document.createElement("div"); box.className = "tabela" + (blocat ? " blocat" : "");
  if (blocat) {
    var nt = document.createElement("p"); nt.className = "tabela-tit";
    nt.textContent = "Finalizată — apasă „Reeditează" + "” ca să mai schimbi ceva";
    box.appendChild(nt);
  }
  var tab = document.createElement("table");
  tab.innerHTML = '<thead><tr><th>Produs</th><th class="num">Cerut buc</th><th class="num">Livrat</th>' +
    '<th>U/M</th><th class="num">Valoare</th></tr></thead>';
  var tb = document.createElement("tbody");
  var catCurenta = null;
  produse.forEach(function (p) {
    if (p.categorie !== catCurenta) {
      catCurenta = p.categorie;
      var trc = document.createElement("tr"); trc.className = "cat";
      var tdc = document.createElement("td"); tdc.colSpan = 5; tdc.textContent = catCurenta;
      trc.appendChild(tdc); tb.appendChild(trc);
    }
    var l = linii[p.nr] || {}, s = l.s || 0, liv = (l.l != null ? l.l : null);
    var marca = schimbatLa(mag, p.nr);
    var tr = document.createElement("tr");
    if (marca) tr.className = "marcat";
    tr.innerHTML = "<td>" + p.nume + '</td><td class="num ' + marca + '">' + cant(s) + "</td>";
    var tdL = document.createElement("td"); tdL.className = "num";
    var tdU = document.createElement("td"); tdU.textContent = p.um;
    var tdV = document.createElement("td"); tdV.className = "num";
    var comparabil = p.um === "Buc";
    var inp = document.createElement("input");
    inp.className = "liv";
    inp.type = "number"; inp.inputMode = "decimal"; inp.min = "0"; inp.step = p.um === "Buc" ? "1" : "0.1";
    inp.id = "l" + p.nr; inp.placeholder = comparabil ? cant(s) : p.um.toLowerCase();
    inp.value = (liv != null ? liv : "");
    inp.setAttribute("aria-label", "Livrat " + p.nume + " în " + p.um);
    inp.disabled = blocat;
    var pune = function (v) {
      tdV.textContent = (v == null || p.pret == null) ? "–" : lei(v * p.pret);
      inp.classList.toggle("modificat", comparabil && v != null && v !== s);
    };
    inp.oninput = function (e) {
      var v = e.target.value === "" ? null : parseFloat(e.target.value);
      seteazaLinie(mag, p.nr, "l", v);
      pune(v); sumarDepozit();
    };
    inp.onfocus = function () { inp.select(); };
    tdL.appendChild(inp);
    pune(liv);
    tr.appendChild(tdL); tr.appendChild(tdU); tr.appendChild(tdV);
    tb.appendChild(tr);
  });
  tab.appendChild(tb); box.appendChild(tab);
  return box;
}

/* Ce au scris magazinele de mana, la "Altele". */
function tabelAltele(mags) {
  var randuri = [];
  mags.forEach(function (m) {
    alteleDin(S.comenzi[m]).forEach(function (it) { randuri.push({ m: m, t: it.t, s: it.s || 1 }); });
  });
  if (!randuri.length) return null;
  var box = document.createElement("div"); box.className = "tabela";
  var tit = document.createElement("p"); tit.className = "tabela-tit"; tit.textContent = "Cereri scrise de magazin";
  box.appendChild(tit);
  var tab = document.createElement("table");
  tab.innerHTML = '<thead><tr><th>Produs</th><th>Magazin</th><th class="num">Buc</th></tr></thead>';
  var tb = document.createElement("tbody");
  randuri.forEach(function (r) {
    var tr = document.createElement("tr");
    var td1 = document.createElement("td"); td1.textContent = r.t;
    var td2 = document.createElement("td"); td2.textContent = MAGAZINE[r.m];
    var td3 = document.createElement("td"); td3.className = "num"; td3.textContent = cant(r.s);
    tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
    tb.appendChild(tr);
  });
  tab.appendChild(tb); box.appendChild(tab);
  return box;
}

function goliciune(text) {
  var d = document.createElement("div");
  d.className = "tabela";
  var p = document.createElement("p"); p.className = "gol"; p.textContent = text;
  d.appendChild(p);
  return d;
}

/* ------------------------------------------------------------------ actiuni */
function toast(t) {
  var el = document.createElement("div"); el.className = "toast"; el.textContent = t;
  document.body.appendChild(el);
  setTimeout(function () { el.remove(); }, 2600);
}

$("btnPrincipal").onclick = function () {
  if (S.rol === "depozit") {
    if (S.depTab === "catalog" || S.depTab === "istoric") {
      S.depTab = "centralizator"; deseneazaDepozit(); return;
    }
    if (S.depTab === "centralizator") {
      if (!S.confirmaFinal) { S.confirmaFinal = true; deseneazaDepozit(); return; }
      finalizeazaRunda();
      return;
    }
    var mag = S.depTab;
    if (esteFinalizata(mag)) {               // reeditare
      schimbaStatus(mag, "trimisa");
      deseneazaDepozit();
      toast(MAGAZINE[mag] + " e din nou deschisă la editare");
      return;
    }
    schimbaStatus(mag, "finalizata");
    S.depTab = "centralizator";
    S.confirmaFinal = false;
    window.scrollTo(0, 0);
    deseneazaDepozit();
    toast(MAGAZINE[mag] + " finalizată");
    return;
  }
  var c = comandaMea(); if (!c) return;
  if (S.pas !== "cos") {            // intai se verifica cosul, abia apoi pleaca
    S.pas = "cos";
    window.scrollTo(0, 0);
    deseneazaMagazin();
    return;
  }
  var mag = S.magazin;
  var eraTrimisa = !!(c.status && c.status !== "draft");
  c.status = "trimisa";
  salveazaDraft(mag);
  trimiteComanda(mag).then(function () {
    deseneazaMagazin();
    toast(eraTrimisa ? "Comandă retrimisă către depozit" : "Comandă trimisă către depozit");
  }).catch(function () {
    deseneazaMagazin();
    toast("Fără conexiune — comanda pleacă singură când revine semnalul");
  });
  S.pas = "lista";
  window.scrollTo(0, 0);
  deseneazaMagazin();
};
$("btnSecundar").onclick = function () {
  if (S.rol === "depozit") {
    return;
  }
  if (S.rol !== "magazin") return;
  if (S.pas === "cos") { S.pas = "lista"; window.scrollTo(0, 0); deseneazaMagazin(); return; }
  S.comenzi[S.magazin] = { status: "draft", linii: {}, altele: [], _local: true };
  scrie(S.magazin); deseneazaMagazin();
  toast("Comanda a fost golită");
};
$("cauta").oninput = function (e) { S.filtru = e.target.value; deseneazaMagazin(); };
$("btnIesire").onclick = function () { location.hash = ""; };

function citesteHash() {
  var h = (location.hash || "").replace("#", "");
  S.pas = "lista"; S.confirmaFinal = false; S.semnatura = null;
  if (h === "depozit") { S.rol = "depozit"; S.magazin = null; }
  else if (MAGAZINE[h]) { S.rol = "magazin"; S.magazin = h; S.depTab = "centralizator"; incarcaFrecvente(); }
  else { S.rol = null; S.magazin = null; }
}

/* Produsele cerute cel mai des de acest magazin, citite din comenzile trecute. */
function incarcaFrecvente() {
  var mag = S.magazin;
  Store.recente(mag).then(function (randuri) {
    var scor = {};
    randuri.forEach(function (v) {
      if (!v || !v.linii || v.sesiune === sesiuneKey()) return;
      Object.keys(v.linii).forEach(function (k) {
        if (v.linii[k] && v.linii[k].s > 0) scor[k] = (scor[k] || 0) + 1;
      });
    });
    var nrs = Object.keys(scor).sort(function (a, b) { return scor[b] - scor[a]; });
    S.frecvente = nrs.map(Number);
    if (S.rol === "magazin" && S.magazin === mag && S.pas === "lista") deseneazaMagazin();
  });
}

window.addEventListener("hashchange", function () {
  citesteHash();
  S.semnatura = null;   // ecranul trebuie redesenat, chiar daca datele sunt aceleasi
  deseneaza();
  porneste();
});
window.addEventListener("online", function () { incarca(); });
window.addEventListener("offline", function () { stareRetea(false); });

/* ------------------------------------------------------------------ pornire */
Store.init();
if (!location.hash && rolImplicit()) location.hash = rolImplicit();
citesteHash();
deseneaza();
porneste();

if ("serviceWorker" in navigator) {
  // Cand apare o versiune noua, pagina se reincarca singura o data,
  // ca sa nu ramana nimeni pe cod vechi fara sa stie.
  var reincarcat = false;
  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (reincarcat) return;
    reincarcat = true;
    location.reload();
  });
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" })
      .then(function (reg) { reg.update(); })
      .catch(function () {});
  });
}
})();
