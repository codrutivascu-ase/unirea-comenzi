/* Comenzi Unirea Gospodarilor — logica aplicatiei.
   Datele trec printr-un singur strat (Store), ca sa putem schimba locul de
   stocare fara sa atingem interfata: acum "local" (telefonul) sau Supabase. */
(function () {
"use strict";

var PRODUSE = window.PRODUSE, CATEGORII = window.CATEGORII;
var CFG = window.CONFIG || {};
var MAGAZINE = CFG.magazine || { kaufland: "Kaufland", bistrita: "Bistrița" };
var CHEI = Object.keys(MAGAZINE);

var lei = function (n) { return n.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
var cant = function (n) { return (Math.round(n * 1000) / 1000).toLocaleString("ro-RO", { maximumFractionDigits: 3 }); };
var $ = function (id) { return document.getElementById(id); };

var S = {
  rol: null, magazin: null, data: null, tura: "t2",
  filtru: "", categorie: "toate", comenzi: {}, depTab: "centralizator",
  timer: null, opriste: null
};

/* ------------------------------------------------------------------ Store */
var Store = {
  mod: "local",
  cheieLocal: "unirea_comenzi_v1",
  init: function () {
    if (CFG.supabaseUrl && CFG.supabaseKey) this.mod = "supabase";
    return this.mod;
  },
  _local: function () {
    try { return JSON.parse(localStorage.getItem(this.cheieLocal) || "{}"); }
    catch (e) { return {}; }
  },
  _scrieLocal: function (tot) {
    try { localStorage.setItem(this.cheieLocal, JSON.stringify(tot)); } catch (e) {}
  },
  _url: function (q) { return CFG.supabaseUrl.replace(/\/$/, "") + "/rest/v1/comenzi" + q; },
  _head: function (extra) {
    var h = { apikey: CFG.supabaseKey, Authorization: "Bearer " + CFG.supabaseKey, "Content-Type": "application/json" };
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  },
  citeste: function (sesiune) {
    var self = this;
    if (this.mod === "supabase") {
      return fetch(this._url("?select=*&sesiune=eq." + encodeURIComponent(sesiune)), { headers: this._head() })
        .then(function (r) { return r.ok ? r.json() : []; })
        .catch(function () { return null; });
    }
    var tot = this._local(), out = [];
    Object.keys(tot).forEach(function (k) { if (tot[k].sesiune === sesiune) out.push(tot[k]); });
    return Promise.resolve(out);
  },
  salveaza: function (doc) {
    if (this.mod === "supabase") {
      return fetch(this._url(""), {
        method: "POST",
        headers: this._head({ Prefer: "resolution=merge-duplicates,return=minimal" }),
        body: JSON.stringify([doc])
      }).then(function (r) { if (!r.ok) throw new Error("salvare esuata"); });
    }
    var tot = this._local();
    tot[doc.id] = doc;
    this._scrieLocal(tot);
    return Promise.resolve();
  },
  recente: function (magazin) {
    if (this.mod === "supabase") {
      return fetch(this._url("?select=*&magazin=eq." + encodeURIComponent(magazin) + "&order=actualizat.desc&limit=8"), { headers: this._head() })
        .then(function (r) { return r.ok ? r.json() : []; })
        .catch(function () { return []; });
    }
    var tot = this._local(), out = [];
    Object.keys(tot).forEach(function (k) { if (tot[k].magazin === magazin) out.push(tot[k]); });
    out.sort(function (a, b) { return (b.actualizat || "").localeCompare(a.actualizat || ""); });
    return Promise.resolve(out);
  }
};

/* ------------------------------------------------------------------ ajutor */
function maine() { var d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); }
function sesiuneKey() { return S.data + "_" + S.tura; }
function docId(mag) { return sesiuneKey() + "_" + mag; }
function dataRo(iso) {
  try { return new Date(iso + "T12:00:00").toLocaleDateString("ro-RO", { day: "numeric", month: "long" }); }
  catch (e) { return iso; }
}
function comandaMea() { return S.comenzi[S.magazin] || null; }
function liniiDin(c) { return (c && c.linii) || {}; }
function valoare(linii, camp) {
  return PRODUSE.reduce(function (t, p) { var l = linii[p.nr]; var q = l && l[camp]; return t + (q ? q * p.pret : 0); }, 0);
}
function nrPozitii(linii, camp) {
  return PRODUSE.filter(function (p) { var l = linii[p.nr]; return l && l[camp] > 0; }).length;
}
function cerute() {
  // produsele pe care cel putin un magazin le-a cerut in sesiunea curenta
  return PRODUSE.filter(function (p) {
    return CHEI.some(function (m) {
      var l = liniiDin(S.comenzi[m])[p.nr];
      return l && (l.s > 0 || l.l > 0);
    });
  });
}

/* ------------------------------------------------------------- sincronizare */
function incarca() {
  var ses = sesiuneKey();
  return Store.citeste(ses).then(function (randuri) {
    if (randuri === null) { toast("Nu am putut citi comenzile. Verific conexiunea."); return; }
    var noi = {};
    randuri.forEach(function (v) { if (v && v.magazin) noi[v.magazin] = v; });
    // nu pierde ce tocmai a tastat cineva pe acest telefon
    if (S.rol === "magazin" && S.comenzi[S.magazin] && S.comenzi[S.magazin]._local) {
      noi[S.magazin] = S.comenzi[S.magazin];
    }
    S.comenzi = noi;
    deseneaza();
  });
}
function porneste() {
  if (S.opriste) { clearInterval(S.opriste); S.opriste = null; }
  incarca();
  if (Store.mod === "supabase") {
    S.opriste = setInterval(function () { if (!document.hidden) incarca(); }, 8000);
  }
}
function scrie(mag) {
  clearTimeout(S.timer);
  S.timer = setTimeout(function () {
    var c = S.comenzi[mag];
    if (!c) return;
    var doc = {
      id: docId(mag), sesiune: sesiuneKey(), data: S.data, tura: S.tura, magazin: mag,
      status: c.status || "draft", linii: c.linii || {}, actualizat: new Date().toISOString()
    };
    Store.salveaza(doc).catch(function () { toast("Nu s-a putut salva. Încerc din nou la următoarea modificare."); });
  }, 450);
}
function seteazaLinie(mag, nr, camp, val) {
  var c = S.comenzi[mag] || { status: "draft", linii: {} };
  var linii = {}; Object.keys(c.linii || {}).forEach(function (k) { linii[k] = c.linii[k]; });
  var l = {}; Object.keys(linii[nr] || {}).forEach(function (k) { l[k] = linii[nr][k]; });
  if (val === null || val === "" || isNaN(val) || val < 0) delete l[camp]; else l[camp] = val;
  if (Object.keys(l).length) linii[nr] = l; else delete linii[nr];
  S.comenzi[mag] = { status: c.status || "draft", linii: linii, magazin: mag, sesiune: sesiuneKey(), data: S.data, tura: S.tura, _local: true };
  scrie(mag);
}

/* ------------------------------------------------------------------ desenat */
function deseneaza() {
  $("gate").hidden = !!S.rol;
  $("antet").hidden = !S.rol;
  $("magazinView").hidden = S.rol !== "magazin";
  $("depozitView").hidden = S.rol !== "depozit";
  $("actiuni").hidden = !S.rol;
  if (S.rol === "magazin") deseneazaMagazin();
  else if (S.rol === "depozit") deseneazaDepozit();
  else deseneazaGate();
}

function deseneazaGate() {
  var n = $("notaMod");
  if (Store.mod === "supabase") {
    n.textContent = "Comenzile se sincronizează între telefoane. Magazinul scrie, depozitul vede imediat.";
  } else {
    n.textContent = "Mod local: comenzile rămân pe telefonul pe care au fost scrise. Pentru sincronizare între magazine și depozit se completează datele Supabase în config.js.";
  }
}

function deseneazaMagazin() {
  $("titlu").textContent = MAGAZINE[S.magazin];
  var c = comandaMea(), linii = liniiDin(c);
  var trimisa = !!(c && c.status === "trimisa");
  var pill = $("statusPill");
  pill.textContent = trimisa ? "Trimisă" : "În lucru";
  pill.className = "pill" + (trimisa ? " trimisa" : " asteapta");

  var n = nrPozitii(linii, "s");
  $("progresBar").style.width = Math.min(100, (n / 12) * 100) + "%";

  var cat = $("categorii");
  cat.innerHTML = "";
  ["toate"].concat(CATEGORII).forEach(function (k) {
    var b = document.createElement("button");
    b.className = "chip"; b.type = "button";
    var nr = PRODUSE.filter(function (p) {
      return (k === "toate" || p.categorie === k) && (linii[p.nr] || {}).s > 0;
    }).length;
    b.textContent = (k === "toate" ? "Toate" : k);
    if (nr) { var s = document.createElement("span"); s.className = "cnt"; s.textContent = nr; b.appendChild(s); }
    b.setAttribute("aria-pressed", String(k === S.categorie));
    b.onclick = function () { S.categorie = k; deseneazaMagazin(); };
    cat.appendChild(b);
  });

  var q = S.filtru.trim().toLowerCase();
  var fara = function (t) { return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); };
  var vizibile = PRODUSE.filter(function (p) {
    return (S.categorie === "toate" || p.categorie === S.categorie) &&
      (!q || fara(p.nume).indexOf(fara(q)) >= 0);
  });

  var lista = $("lista");
  lista.innerHTML = "";
  CATEGORII.forEach(function (catg) {
    var items = vizibile.filter(function (p) { return p.categorie === catg; });
    if (!items.length) return;
    var sec = document.createElement("section"); sec.className = "grup";
    var h = document.createElement("h2"); h.textContent = catg; sec.appendChild(h);
    items.forEach(function (p) { sec.appendChild(randProdus(p, linii[p.nr] || {})); });
    lista.appendChild(sec);
  });
  if (!vizibile.length) {
    var g = document.createElement("p"); g.className = "gol";
    g.textContent = "Niciun produs nu se potrivește căutării.";
    lista.appendChild(g);
  }
  actualizeazaSumar();
}

function randProdus(p, l) {
  var rand = document.createElement("div");
  rand.className = "rand" + (l.s > 0 ? " plin" : "");
  var info = document.createElement("div"); info.className = "info";
  var nume = document.createElement("div"); nume.className = "nume"; nume.textContent = p.nume;
  var sub = document.createElement("div"); sub.className = "sub";
  var scrieSub = function (v) {
    sub.textContent = lei(p.pret) + " lei/" + p.um + (v > 0 ? "   •   " + lei(v * p.pret) + " lei" : "");
  };
  scrieSub(l.s);
  info.appendChild(nume); info.appendChild(sub);

  var st = document.createElement("div"); st.className = "stepper";
  var minus = document.createElement("button"); minus.type = "button"; minus.textContent = "−";
  minus.setAttribute("aria-label", "Scade " + p.nume);
  var inp = document.createElement("input");
  inp.type = "number"; inp.inputMode = "decimal"; inp.min = "0"; inp.step = p.um === "Buc" ? "1" : "0.5";
  inp.id = "q" + p.nr; inp.placeholder = "0"; inp.value = (l.s != null ? l.s : "");
  inp.setAttribute("aria-label", p.nume);
  var plus = document.createElement("button"); plus.type = "button"; plus.textContent = "+";
  plus.setAttribute("aria-label", "Adaugă " + p.nume);

  var aplica = function (v) {
    if (v !== null && v <= 0) v = null;
    inp.value = v === null ? "" : v;
    seteazaLinie(S.magazin, p.nr, "s", v);
    rand.classList.toggle("plin", v > 0);
    st.classList.toggle("activ", v > 0);
    scrieSub(v);
    actualizeazaSumar();
  };
  var pas = function (semn) {
    var cur = parseFloat(inp.value) || 0;
    var d = p.um === "Buc" ? 1 : (cur < 2 ? 0.5 : 1);
    aplica(Math.round((cur + semn * d) * 100) / 100);
  };
  minus.onclick = function () { pas(-1); };
  plus.onclick = function () { pas(1); };
  inp.oninput = function (e) {
    var v = e.target.value === "" ? null : parseFloat(e.target.value);
    seteazaLinie(S.magazin, p.nr, "s", v);
    rand.classList.toggle("plin", v > 0);
    scrieSub(v);
    actualizeazaSumar();
  };
  inp.onfocus = function () { inp.select(); };

  st.appendChild(minus); st.appendChild(inp); st.appendChild(plus);
  var um = document.createElement("span"); um.className = "um"; um.textContent = p.um;
  rand.appendChild(info); rand.appendChild(st); rand.appendChild(um);
  return rand;
}

function actualizeazaSumar() {
  if (S.rol !== "magazin") return;
  var c = comandaMea(), linii = liniiDin(c);
  var n = nrPozitii(linii, "s"), v = valoare(linii, "s");
  $("sumar").innerHTML = "<b>" + n + " poziții</b>" + lei(v) + " lei";
  $("progresBar").style.width = Math.min(100, (n / 12) * 100) + "%";
  var princ = $("btnPrincipal"), sec = $("btnSecundar");
  var trimisa = !!(c && c.status === "trimisa");
  princ.textContent = trimisa ? "Retrimite" : "Trimite comanda";
  princ.disabled = n === 0;
  sec.hidden = !trimisa; sec.textContent = "Golește";
}

/* ------------------------------------------------------------------ depozit */
function deseneazaDepozit() {
  $("titlu").textContent = "Depozit";
  var trimise = CHEI.filter(function (m) { return S.comenzi[m] && S.comenzi[m].status === "trimisa"; }).length;
  var pill = $("statusPill");
  pill.textContent = trimise + "/" + CHEI.length + " trimise";
  pill.className = "pill" + (trimise === CHEI.length ? " trimisa" : " asteapta");
  $("progresBar").style.width = (trimise / CHEI.length) * 100 + "%";

  var carduri = $("statusMagazine"); carduri.innerHTML = "";
  CHEI.forEach(function (id) {
    var c = S.comenzi[id], linii = liniiDin(c);
    var d = document.createElement("div");
    d.className = "card" + (c && c.status === "trimisa" ? " gata" : "");
    var e = document.createElement("div"); e.className = "et"; e.textContent = MAGAZINE[id];
    var v = document.createElement("div"); v.className = "val";
    v.textContent = nrPozitii(linii, "s");
    var sm = document.createElement("small"); sm.textContent = " poziții"; v.appendChild(sm);
    var st = document.createElement("div"); st.className = "st";
    st.textContent = lei(valoare(linii, "s")) + " lei  •  " + (c ? (c.status === "trimisa" ? "trimisă" : "în lucru") : "nimic încă");
    d.appendChild(e); d.appendChild(v); d.appendChild(st);
    carduri.appendChild(d);
  });

  var tabs = $("depTabs"); tabs.innerHTML = "";
  [["centralizator", "Centralizator"]].concat(CHEI.map(function (k) { return [k, MAGAZINE[k]]; })).forEach(function (pair) {
    var b = document.createElement("button"); b.className = "chip"; b.type = "button"; b.textContent = pair[1];
    b.setAttribute("aria-pressed", String(S.depTab === pair[0]));
    b.onclick = function () { S.depTab = pair[0]; deseneazaDepozit(); };
    tabs.appendChild(b);
  });

  var zona = $("depozitContinut"); zona.innerHTML = "";
  zona.appendChild(S.depTab === "centralizator" ? tabelCentralizator() : tabelMagazin(S.depTab));

  $("btnPrincipal").textContent = S.depTab === "centralizator" ? "Copiază centralizatorul" : "Copiază pentru SmartBill";
  $("btnPrincipal").disabled = cerute().length === 0;
  $("btnSecundar").hidden = true;
  sumarDepozit();
}

function sumarDepozit() {
  var tS = CHEI.reduce(function (t, m) { return t + valoare(liniiDin(S.comenzi[m]), "s"); }, 0);
  var tL = CHEI.reduce(function (t, m) { return t + valoare(liniiDin(S.comenzi[m]), "l"); }, 0);
  $("sumar").innerHTML = "<b>" + lei(tS) + " lei</b>livrat " + lei(tL) + " lei";
}

function tabelCentralizator() {
  var produse = cerute();
  if (!produse.length) return goliciune("Niciun magazin nu a cerut încă ceva pentru această livrare.");
  var box = document.createElement("div"); box.className = "tabela";
  var h = "<table><thead><tr><th>Produs</th><th>U/M</th>";
  CHEI.forEach(function (m) { h += '<th class="num">' + MAGAZINE[m] + "</th>"; });
  h += '<th class="num">Total</th><th class="num">Livrat</th></tr></thead><tbody>';
  var tot = 0, catCurenta = null;
  produse.forEach(function (p) {
    if (p.categorie !== catCurenta) {
      catCurenta = p.categorie;
      h += '<tr class="cat"><td colspan="' + (4 + CHEI.length) + '">' + catCurenta + "</td></tr>";
    }
    var q = CHEI.map(function (m) { return (liniiDin(S.comenzi[m])[p.nr] || {}).s || 0; });
    var t = q.reduce(function (a, b) { return a + b; }, 0);
    var liv = CHEI.reduce(function (a, m) {
      var l = liniiDin(S.comenzi[m])[p.nr] || {};
      return a + (l.l != null ? l.l : 0);
    }, 0);
    var areLiv = CHEI.some(function (m) { return (liniiDin(S.comenzi[m])[p.nr] || {}).l != null; });
    tot += t * p.pret;
    h += "<tr><td>" + p.nume + "</td><td>" + p.um + "</td>";
    q.forEach(function (v) { h += '<td class="num">' + (v ? cant(v) : "–") + "</td>"; });
    h += '<td class="num"><b>' + cant(t) + "</b></td>";
    h += '<td class="num' + (areLiv && liv !== t ? " dif" : "") + '">' + (areLiv ? cant(liv) : "–") + "</td></tr>";
  });
  h += '<tr class="total"><td>Valoare solicitată</td><td></td>';
  CHEI.forEach(function (m) { h += '<td class="num">' + lei(valoare(liniiDin(S.comenzi[m]), "s")) + "</td>"; });
  h += '<td class="num">' + lei(tot) + "</td><td></td></tr></tbody></table>";
  box.innerHTML = h;
  return box;
}

function tabelMagazin(mag) {
  var linii = liniiDin(S.comenzi[mag]);
  var produse = PRODUSE.filter(function (p) { var l = linii[p.nr] || {}; return l.s > 0 || l.l > 0; });
  if (!produse.length) return goliciune(MAGAZINE[mag] + " nu a trimis încă nimic pentru această livrare.");
  var box = document.createElement("div"); box.className = "tabela";
  var tab = document.createElement("table");
  tab.innerHTML = '<thead><tr><th>Produs</th><th>U/M</th><th class="num">Cerut</th><th class="num">Livrat</th>' +
    '<th class="num">Dif.</th><th class="num">Valoare</th></tr></thead>';
  var tb = document.createElement("tbody");
  produse.forEach(function (p) {
    var l = linii[p.nr] || {}, s = l.s || 0, liv = (l.l != null ? l.l : null);
    var tr = document.createElement("tr");
    tr.innerHTML = "<td>" + p.nume + "</td><td>" + p.um + '</td><td class="num">' + cant(s) + "</td>";
    var tdL = document.createElement("td"); tdL.className = "num";
    var tdD = document.createElement("td"); tdD.className = "num";
    var tdV = document.createElement("td"); tdV.className = "num";
    var inp = document.createElement("input");
    inp.className = "liv" + (liv != null && liv !== s ? " modificat" : "");
    inp.type = "number"; inp.inputMode = "decimal"; inp.min = "0"; inp.step = p.um === "Buc" ? "1" : "0.5";
    inp.id = "l" + p.nr; inp.placeholder = cant(s); inp.value = (liv != null ? liv : "");
    inp.setAttribute("aria-label", "Livrat " + p.nume);
    var pune = function (v) {
      var d = (v == null ? 0 : v - s);
      tdD.textContent = d ? ((d > 0 ? "+" : "") + cant(d)) : (v == null ? "–" : "0");
      tdD.className = "num dif" + (d ? "" : " zero");
      tdV.textContent = lei((v == null ? s : v) * p.pret);
      inp.classList.toggle("modificat", v != null && v !== s);
    };
    inp.oninput = function (e) {
      var v = e.target.value === "" ? null : parseFloat(e.target.value);
      seteazaLinie(mag, p.nr, "l", v);
      pune(v); sumarDepozit();
    };
    inp.onfocus = function () { inp.select(); };
    tdL.appendChild(inp);
    pune(liv);
    tr.appendChild(tdL); tr.appendChild(tdD); tr.appendChild(tdV);
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
function copiaza(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      function () { toast("Copiat — lipește în Excel sau SmartBill"); },
      function () { toast("Nu am putut copia"); }
    );
  } else { toast("Nu am putut copia"); }
}
function tsvCentralizator() {
  var rows = [["Produs", "U/M"].concat(CHEI.map(function (m) { return MAGAZINE[m]; }), ["Total", "Pret"]).join("\t")];
  cerute().forEach(function (p) {
    var q = CHEI.map(function (m) { return (liniiDin(S.comenzi[m])[p.nr] || {}).s || 0; });
    var t = q.reduce(function (a, b) { return a + b; }, 0);
    rows.push([p.nume, p.um].concat(q, [t, p.pret.toFixed(2)]).join("\t"));
  });
  return rows.join("\n");
}
function tsvMagazin(mag) {
  var linii = liniiDin(S.comenzi[mag]);
  var rows = [["Produs", "U/M", "Cantitate", "Pret unitar", "Valoare"].join("\t")];
  PRODUSE.forEach(function (p) {
    var l = linii[p.nr] || {};
    var q = (l.l != null ? l.l : (l.s || 0));
    if (!q) return;
    rows.push([p.nume, p.um, q, p.pret.toFixed(2), (q * p.pret).toFixed(2)].join("\t"));
  });
  return rows.join("\n");
}

$("btnPrincipal").onclick = function () {
  if (S.rol === "depozit") {
    copiaza(S.depTab === "centralizator" ? tsvCentralizator() : tsvMagazin(S.depTab));
    return;
  }
  var c = comandaMea(); if (!c) return;
  c.status = "trimisa";
  scrie(S.magazin); deseneazaMagazin();
  toast("Comandă trimisă către depozit");
};
$("btnSecundar").onclick = function () {
  if (S.rol !== "magazin") return;
  S.comenzi[S.magazin] = { status: "draft", linii: {}, _local: true };
  scrie(S.magazin); deseneazaMagazin();
  toast("Comanda a fost golită");
};
$("copiazaAnterioara").onclick = function () {
  Store.recente(S.magazin).then(function (randuri) {
    var prec = null;
    randuri.forEach(function (v) {
      if (!prec && v && v.sesiune !== sesiuneKey() && v.linii && Object.keys(v.linii).length) prec = v;
    });
    if (!prec) { toast("Nu există o comandă anterioară"); return; }
    var linii = {};
    Object.keys(prec.linii).forEach(function (k) { var v = prec.linii[k]; if (v && v.s > 0) linii[k] = { s: v.s }; });
    S.comenzi[S.magazin] = { status: "draft", linii: linii, _local: true };
    scrie(S.magazin); deseneazaMagazin();
    toast("Am copiat comanda din " + dataRo(prec.data));
  });
};
$("cauta").oninput = function (e) { S.filtru = e.target.value; deseneazaMagazin(); };
$("dataLivrare").onchange = function (e) { S.data = e.target.value; porneste(); };
$("btnIesire").onclick = function () { location.hash = ""; };
Array.prototype.forEach.call($("segTura").children, function (b) {
  b.onclick = function () { S.tura = b.dataset.tura; sincronizeazaSegment(); porneste(); };
});
function sincronizeazaSegment() {
  Array.prototype.forEach.call($("segTura").children, function (b) {
    b.setAttribute("aria-pressed", String(b.dataset.tura === S.tura));
  });
}

function citesteHash() {
  var h = (location.hash || "").replace("#", "");
  if (h === "depozit") { S.rol = "depozit"; S.magazin = null; }
  else if (MAGAZINE[h]) { S.rol = "magazin"; S.magazin = h; S.depTab = "centralizator"; }
  else { S.rol = null; S.magazin = null; }
}
window.addEventListener("hashchange", function () { citesteHash(); porneste(); });

/* ------------------------------------------------------------------ pornire */
Store.init();
S.data = maine();
$("dataLivrare").value = S.data;
sincronizeazaSegment();
citesteHash();
deseneaza();
porneste();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  });
}
})();
