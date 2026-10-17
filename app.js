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
  rol: null, magazin: null, data: null, tura: "t2",
  filtru: "", categorie: "toate", comenzi: {}, depTab: "centralizator",
  pas: "lista", frecvente: [],
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
  return PRODUSE.reduce(function (t, p) {
    var l = linii[p.nr]; var q = l && l[camp];
    return t + (q && p.pret != null ? q * p.pret : 0);
  }, 0);
}
function bucatiComanda(c) {
  return totalBucati(liniiDin(c)) +
    ((c && c.altele) || []).reduce(function (t, it) { return t + (it.s || 1); }, 0);
}
function totalBucati(linii) {
  return PRODUSE.reduce(function (t, p) { var l = linii[p.nr]; return t + ((l && l.s) || 0); }, 0);
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
      status: c.status || "draft", linii: c.linii || {}, altele: c.altele || [],
      actualizat: new Date().toISOString()
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
  S.comenzi[mag] = { status: c.status || "draft", linii: linii, altele: c.altele || [],
    magazin: mag, sesiune: sesiuneKey(), data: S.data, tura: S.tura, _local: true };
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

  if (S.pas === "cos") { deseneazaCos(); return; }
  $("bara").hidden = false;
  $("categorii").hidden = false;

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

  // produsele cerute cel mai des de acest magazin stau primele
  if (S.categorie === "toate" && !q && S.frecvente.length) {
    var frec = S.frecvente.map(nrLaProdus).filter(Boolean).slice(0, 10);
    if (frec.length) {
      var sf = document.createElement("section"); sf.className = "grup";
      var hf = document.createElement("h2"); hf.textContent = "Comandate des"; sf.appendChild(hf);
      frec.forEach(function (p) { sf.appendChild(randProdus(p, linii[p.nr] || {}, "f")); });
      lista.appendChild(sf);
    }
  }

  CATEGORII.forEach(function (catg) {
    var items = vizibile.filter(function (p) { return p.categorie === catg; });
    var nota = (window.NOTA_CATEGORIE || {})[catg];
    if (!items.length && !(nota && !q && (S.categorie === "toate" || S.categorie === catg))) return;
    var sec = document.createElement("section"); sec.className = "grup";
    var h = document.createElement("h2"); h.textContent = catg; sec.appendChild(h);
    items.forEach(function (p) { sec.appendChild(randProdus(p, linii[p.nr] || {}, "c")); });
    if (!items.length && nota) {
      var pn = document.createElement("p"); pn.className = "gol"; pn.textContent = nota;
      sec.appendChild(pn);
    }
    if (catg === "Diverse" && S.categorie !== "Ouă") sec.appendChild(blocAltele(c));
    lista.appendChild(sec);
  });

  if (!vizibile.length && q) {
    var g = document.createElement("p"); g.className = "gol";
    g.textContent = "Niciun produs nu se potrivește căutării.";
    lista.appendChild(g);
  }
  actualizeazaSumar();
}

function nrLaProdus(nr) {
  for (var i = 0; i < PRODUSE.length; i++) if (PRODUSE[i].nr === nr) return PRODUSE[i];
  return null;
}

/* Cererile scrise de mana, pentru ce nu e in lista (pixuri, mop, galeata...). */
function alteleDin(c) { return (c && c.altele) || []; }
function salveazaAltele(arr) {
  var c = S.comenzi[S.magazin] || { status: "draft", linii: {} };
  c.altele = arr; c._local = true;
  S.comenzi[S.magazin] = c;
  scrie(S.magazin);
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
  text.type = "text"; text.placeholder = "ex. mop, clor, pixuri"; text.id = "altText";
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

  var cap = document.createElement("div"); cap.className = "cos-cap";
  var h = document.createElement("h2"); h.textContent = "Verifică comanda";
  var p = document.createElement("p");
  p.textContent = "Pentru livrarea de " + dataRo(S.data) + ", " +
    (S.tura === "t1" ? "comanda de prânz" : "comanda de dimineață") + ". Cantitățile sunt în bucăți.";
  cap.appendChild(h); cap.appendChild(p);
  lista.appendChild(cap);

  var ceva = false;
  CATEGORII.forEach(function (catg) {
    var items = PRODUSE.filter(function (pr) {
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

function actualizeazaSumar() {
  if (S.rol !== "magazin") return;
  var c = comandaMea(), linii = liniiDin(c);
  var n = nrPozitii(linii, "s") + alteleDin(c).length;
  var buc = totalBucati(linii) + alteleDin(c).reduce(function (t, it) { return t + (it.s || 1); }, 0);
  $("sumar").innerHTML = "<b>" + n + (n === 1 ? " poziție" : " poziții") + "</b>" +
    cant(buc) + " bucăți în total";
  $("progresBar").style.width = Math.min(100, (n / 12) * 100) + "%";
  var princ = $("btnPrincipal"), sec = $("btnSecundar");
  var trimisa = !!(c && c.status === "trimisa");
  if (S.pas === "cos") {
    princ.textContent = trimisa ? "Retrimite comanda" : "Trimite comanda";
    princ.disabled = n === 0;
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
    v.textContent = nrPozitii(linii, "s") + alteleDin(c).length;
    var sm = document.createElement("small"); sm.textContent = " poziții"; v.appendChild(sm);
    var st = document.createElement("div"); st.className = "st";
    st.textContent = cant(bucatiComanda(c)) + " buc  •  " + (c ? (c.status === "trimisa" ? "trimisă" : "în lucru") : "nimic încă");
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
  var sp = tabelAltele(S.depTab === "centralizator" ? CHEI : [S.depTab]);
  if (sp) zona.appendChild(sp);

  $("btnPrincipal").textContent = S.depTab === "centralizator" ? "Copiază centralizatorul" : "Copiază pentru SmartBill";
  $("btnPrincipal").disabled = cerute().length === 0 &&
    !CHEI.some(function (m) { return alteleDin(S.comenzi[m]).length; });
  $("btnSecundar").hidden = true;
  sumarDepozit();
}

function sumarDepozit() {
  var tB = CHEI.reduce(function (t, m) { return t + bucatiComanda(S.comenzi[m]); }, 0);
  var tL = CHEI.reduce(function (t, m) { return t + valoare(liniiDin(S.comenzi[m]), "l"); }, 0);
  $("sumar").innerHTML = "<b>" + cant(tB) + " bucăți cerute</b>livrat " + lei(tL) + " lei";
}

function tabelCentralizator() {
  var produse = cerute();
  if (!produse.length) return goliciune("Niciun magazin nu a cerut încă ceva pentru această livrare.");
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
    var t = q.reduce(function (a, b) { return a + b; }, 0);
    var liv = CHEI.reduce(function (a, m) {
      var l = liniiDin(S.comenzi[m])[p.nr] || {};
      return a + (l.l != null ? l.l : 0);
    }, 0);
    var areLiv = CHEI.some(function (m) { return (liniiDin(S.comenzi[m])[p.nr] || {}).l != null; });
    tot += liv * (p.pret || 0);
    h += "<tr><td>" + p.nume + "</td>";
    q.forEach(function (v) { h += '<td class="num">' + (v ? cant(v) : "–") + "</td>"; });
    h += '<td class="num"><b>' + cant(t) + "</b></td>";
    h += '<td class="num' + (areLiv ? " dif" : "") + '">' + (areLiv ? cant(liv) : "–") + "</td>";
    h += "<td>" + p.um + "</td></tr>";
  });
  h += '<tr class="total"><td>Total bucăți cerute</td>';
  var totBuc = 0;
  CHEI.forEach(function (m) {
    var b = totalBucati(liniiDin(S.comenzi[m])); totBuc += b;
    h += '<td class="num">' + cant(b) + "</td>";
  });
  h += '<td class="num">' + cant(totBuc) + '</td><td class="num">' + lei(tot) + " lei</td><td></td></tr></tbody></table>";
  box.innerHTML = h;
  return box;
}

function tabelMagazin(mag) {
  var linii = liniiDin(S.comenzi[mag]);
  var produse = PRODUSE.filter(function (p) { var l = linii[p.nr] || {}; return l.s > 0 || l.l > 0; });
  if (!produse.length) return goliciune(MAGAZINE[mag] + " nu a trimis încă nimic pentru această livrare.");
  var box = document.createElement("div"); box.className = "tabela";
  var tab = document.createElement("table");
  tab.innerHTML = '<thead><tr><th>Produs</th><th class="num">Cerut buc</th><th class="num">Livrat</th>' +
    '<th>U/M</th><th class="num">Dif.</th><th class="num">Valoare</th></tr></thead>';
  var tb = document.createElement("tbody");
  produse.forEach(function (p) {
    var l = linii[p.nr] || {}, s = l.s || 0, liv = (l.l != null ? l.l : null);
    var tr = document.createElement("tr");
    tr.innerHTML = "<td>" + p.nume + '</td><td class="num">' + cant(s) + "</td>";
    var tdL = document.createElement("td"); tdL.className = "num";
    var tdU = document.createElement("td"); tdU.textContent = p.um;
    var tdD = document.createElement("td"); tdD.className = "num";
    var tdV = document.createElement("td"); tdV.className = "num";
    // diferenta are sens doar cand si cererea e in bucati (iaurt, oua, pungi)
    var comparabil = p.um === "Buc";
    var inp = document.createElement("input");
    inp.className = "liv";
    inp.type = "number"; inp.inputMode = "decimal"; inp.min = "0"; inp.step = p.um === "Buc" ? "1" : "0.1";
    inp.id = "l" + p.nr; inp.placeholder = comparabil ? cant(s) : p.um.toLowerCase();
    inp.value = (liv != null ? liv : "");
    inp.setAttribute("aria-label", "Livrat " + p.nume + " în " + p.um);
    var pune = function (v) {
      var d = (v == null || !comparabil ? 0 : v - s);
      tdD.textContent = !comparabil ? "–" : (d ? ((d > 0 ? "+" : "") + cant(d)) : (v == null ? "–" : "0"));
      tdD.className = "num dif" + (d ? "" : " zero");
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
    tr.appendChild(tdL); tr.appendChild(tdU); tr.appendChild(tdD); tr.appendChild(tdV);
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
  tab.innerHTML = "<thead><tr><th>Produs</th><th>Magazin</th><th class=\"num\">Buc</th></tr></thead>";
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
function copiaza(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      function () { toast("Copiat — lipește în Excel sau SmartBill"); },
      function () { toast("Nu am putut copia"); }
    );
  } else { toast("Nu am putut copia"); }
}
function tsvCentralizator() {
  var rows = [["Produs"].concat(CHEI.map(function (m) { return MAGAZINE[m] + " (buc)"; }),
    ["Total buc", "Livrat", "U/M", "Pret"]).join("\t")];
  cerute().forEach(function (p) {
    var q = CHEI.map(function (m) { return (liniiDin(S.comenzi[m])[p.nr] || {}).s || 0; });
    var t = q.reduce(function (a, b) { return a + b; }, 0);
    var liv = CHEI.reduce(function (a, m) {
      var l = liniiDin(S.comenzi[m])[p.nr] || {};
      return a + (l.l != null ? l.l : 0);
    }, 0);
    rows.push([p.nume].concat(q, [t, liv || "", p.um, p.pret != null ? p.pret.toFixed(2) : ""]).join("\t"));
  });
  CHEI.forEach(function (m) {
    alteleDin(S.comenzi[m]).forEach(function (it) {
      rows.push([it.t + " (" + MAGAZINE[m] + ")", "", "", it.s || 1, "", "buc", ""].join("\t"));
    });
  });
  return rows.join("\n");
}
function tsvMagazin(mag) {
  var linii = liniiDin(S.comenzi[mag]);
  var rows = [["Produs", "Cerut buc", "Cantitate livrata", "U/M", "Pret unitar", "Valoare"].join("\t")];
  PRODUSE.forEach(function (p) {
    var l = linii[p.nr] || {};
    if (!(l.s > 0 || l.l > 0)) return;
    var q = (l.l != null ? l.l : "");
    rows.push([p.nume, l.s || "", q, p.um, p.pret != null ? p.pret.toFixed(2) : "",
      (q === "" || p.pret == null ? "" : (q * p.pret).toFixed(2))].join("\t"));
  });
  alteleDin(S.comenzi[mag]).forEach(function (it) {
    rows.push([it.t, it.s || 1, "", "buc", "", ""].join("\t"));
  });
  return rows.join("\n");
}

$("btnPrincipal").onclick = function () {
  if (S.rol === "depozit") {
    copiaza(S.depTab === "centralizator" ? tsvCentralizator() : tsvMagazin(S.depTab));
    return;
  }
  var c = comandaMea(); if (!c) return;
  if (S.pas !== "cos") {            // intai verifica cineva coșul, abia apoi trimite
    S.pas = "cos";
    window.scrollTo(0, 0);
    deseneazaMagazin();
    return;
  }
  c.status = "trimisa";
  scrie(S.magazin);
  S.pas = "lista";
  window.scrollTo(0, 0);
  deseneazaMagazin();
  toast("Comandă trimisă către depozit");
};
$("btnSecundar").onclick = function () {
  if (S.rol !== "magazin") return;
  if (S.pas === "cos") { S.pas = "lista"; window.scrollTo(0, 0); deseneazaMagazin(); return; }
  S.comenzi[S.magazin] = { status: "draft", linii: {}, altele: [], _local: true };
  scrie(S.magazin); deseneazaMagazin();
  toast("Comanda a fost golită");
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
  S.pas = "lista";
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
