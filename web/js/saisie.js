// Écran « Préparer » : tournée enregistrée, paramètres, arrêts (cartes sur mobile,
// lignes compactes sur grand écran), contrôles, et barre « Optimiser » toujours visible.

import { icon } from "./icons.js?v=202611162119";
import { DEPOTS, PRODUITS_CATALOGUE, COULEURS_PRODUITS, ACTION_COLORS, PASTILLE, esc, normTxt, couleursArret,
  couleursTexte, fmtDateHeure, toast, confirmer, fmtDate, ouvrirDialog, closeDialog, withBusy, geocode, geoConnu, confettis } from "./util.js?v=202611162119";
import { ACTIONS_CATALOGUE, BAREME_PRODUITS, BAREME_ACTIONS, baremeDefaut, besoinsTournee, controleDisponibilite,
  besoinsRecords, nouvelArret, normaliserArret, parseHhmm, PAUSE_DEJEUNER_MIN } from "./metier.js?v=202611162119";
import { S, on, emit, stopsVides, stopsValides, dureeAuto, saveTournee, loadTournee, nouvelleTournee, nomParDefaut,
  saveBareme, hashStops, resultatObsolete, appliquerParamsResultat, stopsEffectifs, instantane, restaurer } from "./state.js?v=202611162119";
import { exportStopsExcel, parseStopsExcel } from "./xlsx.js?v=202611162119";
import { telecharger, XLSX_MIME, loadExcel } from "./libs.js?v=202611162119";
import { optimiser, pointe } from "./optim.js?v=202611162119";

export function initSaisie(root, ctx) {
  let detailsTous = false;
  try { detailsTous = localStorage.getItem("saisie-details") === "1"; } catch { /* rien */ }
  let optimRun = null;           // { ctrl } pendant un calcul
  let introuvables = null;       // lignes non localisées au dernier essai
  const ouverts = new Set();     // lignes dépliées individuellement

  root.innerHTML = `
    <div class="page-head">
      <div><span class="eyebrow">Étape 1</span><h1>Préparer la tournée</h1></div>
    </div>
    <div class="saisie-grid">
      <aside class="side stack">
        <section class="glass" data-zone="tournee"></section>
        <section class="glass" data-zone="params"></section>
      </aside>
      <div class="stack">
        <section class="glass" data-zone="arrets">
          <div class="card-title">${icon("list")}<span>Arrêts</span><span class="badge push" data-count></span></div>
          <div class="toolbar">
            <button class="btn btn-sm" data-act="add">${icon("plus")}<span>Ajouter un arrêt</span></button>
            <button class="btn btn-sm" data-act="from-clients">${icon("clients")}<span>Depuis la base client</span></button>
            <label class="btn btn-sm btn-file">${icon("upload")}<span>Importer Excel</span><input type="file" accept=".xlsx,.xlsm,.xls,.csv" data-act="import" aria-label="Importer un fichier Excel"></label>
            <div class="menu">
              <button class="btn btn-sm btn-icon" data-act="menu" aria-haspopup="menu" aria-expanded="false" aria-label="Plus d'actions">${icon("dots")}</button>
            </div>
            <div class="push"><button class="btn btn-sm btn-danger-ghost" data-act="del-sel" hidden>${icon("trash")}<span></span></button></div>
          </div>
          <div class="stops-head" aria-hidden="true">
            <span>#</span><span>Client</span><span>Adresse</span><span>Action</span><span>Produit</span><span>Option</span><span>Couleur</span><span>Qté</span><span></span>
            <span><input type="checkbox" data-act="sel-all" aria-label="Tout sélectionner" title="Tout sélectionner"></span>
          </div>
          <div class="stops" role="list"></div>
          <datalist id="dl-clients"></datalist>
          <datalist id="dl-chauffeurs"></datalist>
        </section>
        <section class="glass" data-zone="controles"></section>
        <div class="action-bar" data-zone="action"></div>
      </div>
    </div>`;

  const $ = (s) => root.querySelector(s);
  const list = $(".stops");

  // ── Index base client (recherche tolérante : casse et accents ignorés) ────
  let cindex = new Map(), cnorm = new Map(), aindex = new Map();
  function rebuildIndex() {
    cindex = new Map(); cnorm = new Map(); aindex = new Map();
    for (const c of ctx.clients) {
      const base = String(c.nom || "").trim() || "Sans nom";
      let name = base, n = 2;
      while (cindex.has(name)) name = `${base} (${n++})`;
      cindex.set(name, c); cnorm.set(normTxt(name), name);
      for (const p of c.points || []) {
        const a = normTxt(p.adresse);
        if (a && !aindex.has(a)) aindex.set(a, { name, c, p });
      }
    }
    $("#dl-clients").innerHTML = [...cindex].map(([n, c]) => {
      const pts = pointsDe(c);
      const ville = (pts[0]?.adresse || "").match(/\d{5}\s+(.+)$/)?.[1] || "";
      return `<option value="${esc(n)}">${esc([ville, `${pts.length} adresse${pts.length > 1 ? "s" : ""}`].filter(Boolean).join(" · "))}</option>`;
    }).join("");
  }
  const pointsDe = (c) => (c?.points || []).filter((p) => String(p.adresse || "").trim());
  const clientDe = (s) => cindex.get(cnorm.get(normTxt(s.Client)) || "");

  function applyPoint(s, c, p) {
    const nom = String(c.nom || "").trim(), lib = String(p.libelle || "").trim();
    Object.assign(s, { "Nom du client": lib ? `${nom} – ${lib}` : nom, "Adresse": String(p.adresse || "").trim(),
      "Pas avant": p.pas_avant || c.pas_avant || "", "Pas après": p.pas_apres || c.pas_apres || "", "Observations": String(p.observations || "") });
  }
  function autofillFromClient(s, name) {
    const c = cindex.get(name);
    if (!c) return;
    const produit = c.produit || "WC chimique";
    Object.assign(s, { "Client": name, "Produit": produit,
      "Option": produit === "WC chimique" ? (c.option_produit || "Lave-main") : "",
      "Quantité": Math.max(1, parseInt(c.quantite, 10) || 1), "Couleur": couleursTexte(c.couleurs || "") });
    const pts = pointsDe(c);
    const deja = pts.find((p) => normTxt(p.adresse) === normTxt(s.Adresse));
    if (pts.length === 1) applyPoint(s, c, pts[0]);
    else if (deja) applyPoint(s, c, deja);
    else Object.assign(s, { "Nom du client": String(c.nom || "").trim(), "Adresse": "", "Pas avant": c.pas_avant || "", "Pas après": c.pas_apres || "", "Observations": "" });
    dureeAuto(s);
  }
  function autofillFromAddress(s) {
    const c = clientDe(s);
    const p = c ? pointsDe(c).find((x) => normTxt(x.adresse) === normTxt(s.Adresse)) : null;
    if (c && p) return applyPoint(s, c, p);
    const o = aindex.get(normTxt(s.Adresse));
    if (o && !c) { autofillFromClient(s, o.name); applyPoint(s, o.c, o.p); }
  }
  function matchClientByAddress(stops) {
    for (const s of stops) {
      if (String(s.Client).trim()) continue;
      const o = aindex.get(normTxt(s.Adresse));
      if (o) s.Client = o.name;
    }
    return stops;
  }

  // ── Tournée enregistrée ──────────────────────────────────────────────────
  function renderTournee() {
    const T = S.tournee;
    $('[data-zone="tournee"]').innerHTML = `
      <div class="card-title">${icon("route")}<span>Tournée</span>
        <span class="save-state push ${T.id ? "" : "unsaved"}"><i class="dot"></i>${T.id ? `Enregistrée ${esc(fmtDateHeure(T.savedAt).split(" ")[1] || "")}` : "Brouillon"}</span></div>
      <label>Nom<input data-t="nom" value="${esc(T.nom)}" placeholder="${esc(nomParDefaut())}"></label>
      ${T.error ? `<p class="note err">${icon("x-circle")}<span>Enregistrement impossible. Vos modifications restent sur cet appareil.</span></p>` : ""}
      <div class="row" style="margin-top:12px">
        ${T.id ? "" : `<button class="btn btn-primary btn-sm" data-act="save">${icon("save")}<span>Enregistrer</span></button>`}
        <button class="btn btn-sm" data-act="list">${icon("folder")}<span>Tournées</span></button>
        <button class="btn btn-sm btn-ghost" data-act="new">${icon("plus")}<span>Nouvelle</span></button>
      </div>`;
  }

  // ── Paramètres ───────────────────────────────────────────────────────────
  function renderParams() {
    const p = S.params;
    const pt = pointe(parseHhmm(p.heureMin) ?? 0);
    const resume = `${p.depotDepart}${p.depotRetour !== p.depotDepart ? " → " + p.depotRetour : ""} · ${String(p.fuelConso).replace(".", ",")} L/100 · pause ${p.pause ? PAUSE_DEJEUNER_MIN + " min" : "non"}`;
    $('[data-zone="params"]').innerHTML = `
      <div class="card-title">${icon("calendar")}<span>Paramètres</span></div>
      <div class="stack">
        <div class="grid-2">
          <label>Date<input type="date" data-p="tourDate" value="${esc(p.tourDate)}"></label>
          <label>Départ dès<input type="time" step="300" data-p="heureMin" value="${esc(p.heureMin)}"></label>
        </div>
        <label>Chauffeur<input data-p="driver" list="dl-chauffeurs" value="${esc(p.driver)}" placeholder="Nom du chauffeur" autocomplete="name"></label>
        <details class="inset">
          <summary class="row" style="list-style:none;cursor:pointer"><b>Dépôts, véhicule et règles</b>${icon("chevron-down", "chev")}</summary>
          <div class="summary-line">${esc(resume)}</div>
          <div class="details-body stack" style="margin-top:12px">
            <div class="grid-2">
              <label>Départ<select data-p="depotDepart">${Object.keys(DEPOTS).map((k) => `<option${k === p.depotDepart ? " selected" : ""}>${esc(k)}</option>`).join("")}</select></label>
              <label>Retour<select data-p="depotRetour">${Object.keys(DEPOTS).map((k) => `<option${k === p.depotRetour ? " selected" : ""}>${esc(k)}</option>`).join("")}</select></label>
              <label>Conso. L/100 km<input type="number" min="5" max="30" step="0.5" data-p="fuelConso" value="${p.fuelConso}"></label>
              <label>Prix € / L<input type="number" min="1" max="3.5" step="0.01" data-p="fuelPrice" value="${p.fuelPrice}"></label>
            </div>
            <label class="switch"><input type="checkbox" data-p="eviterPeri"${p.eviterPeri ? " checked" : ""}><span>Éviter le périphérique aux heures de pointe
              <span class="hint">${p.eviterPeri ? (pt === "matin" ? "Arrêts dans la rocade après 09:00" : pt === "soir" ? "Arrêts dans la rocade avant 16:30" : "Départ hors heure de pointe") : "Toulouse, 07:00–09:00 et 17:00–19:00"}</span></span></label>
            <label class="switch"><input type="checkbox" data-p="pause"${p.pause ? " checked" : ""}><span>Pause déjeuner de ${PAUSE_DEJEUNER_MIN} min</span></label>
            <label class="switch"><input type="checkbox" data-p="etatLieuxParArret"${p.etatLieuxParArret ? " checked" : ""}><span>Une fiche d'état des lieux par arrêt</span></label>
            <button class="btn btn-sm" data-act="bareme">${icon("timer")}<span>Barème des durées</span></button>
          </div>
        </details>
      </div>`;
  }

  // ── Arrêts ───────────────────────────────────────────────────────────────
  const optHtml = (vals, v, labels = {}) => vals.map((x) => `<option value="${esc(x)}"${x === v ? " selected" : ""}>${esc(labels[x] ?? x)}</option>`).join("");

  function couleurHtml(s) {
    const man = couleursArret(s.Couleur);
    const auto = !man.length ? couleursArret(s.CouleurAuto) : [];
    const cs = man.length ? man : auto;
    if (!cs.length) return `<span class="txt muted">Au choix</span>`;
    return cs.map((c) => `<i class="pastille" style="--pc:${PASTILLE[c] || "#ccc"}"></i>`).join("")
      + `<span class="txt">${esc(cs.join(", "))}</span>${auto.length ? '<span class="auto-tag">auto</span>' : ""}`;
  }

  function pillsHtml(s) {
    const out = [`<span class="mini">${icon("timer")}${esc(s["Durée (min)"])} min</span>`];
    if (s["Pas avant"] || s["Pas après"]) out.push(`<span class="mini">${icon("clock")}${esc(s["Pas avant"] || "…")}–${esc(s["Pas après"] || "…")}</span>`);
    if (s.Observations) out.push(`<span class="mini">${icon("note")}Note</span>`);
    return out.join("");
  }

  function adresseOptions(s, i) {
    const c = clientDe(s);
    const pts = c ? pointsDe(c) : [];
    return `<datalist id="dl-a-${i}">${(c ? pts.map((p) => [p.adresse, p.libelle || c.nom])
      : [...aindex.values()].map((o) => [o.p.adresse, `${o.name}${o.p.libelle ? " · " + o.p.libelle : ""}`]))
      .map(([a, l]) => `<option value="${esc(a)}">${esc(l)}</option>`).join("")}</datalist>`;
  }

  function rowHtml(s, i) {
    const col = ACTION_COLORS[s.Action] || "#038D29";
    const open = detailsTous || ouverts.has(i);
    const geo = String(s.Adresse).trim() ? geoConnu(s.Adresse) : undefined;
    return `<div class="stop-row${open ? "" : " collapsed"}${s.Suppr ? " sel" : ""}" role="listitem" data-i="${i}" style="--act:${col}">
      <div class="head"><span class="num">${i + 1}</span><span class="grow">${esc(s["Nom du client"] || s.Client || `Arrêt ${i + 1}`)}</span>
        <span class="mini-actions row">
          <button class="btn btn-ghost btn-icon btn-sm" data-act="toggle" aria-expanded="${open}" aria-label="Détails de l'arrêt ${i + 1}">${icon("chevron-down", "chev")}</button>
          <button class="btn btn-ghost btn-icon btn-sm" data-act="del-one" aria-label="Supprimer l'arrêt ${i + 1}">${icon("trash")}</button>
        </span></div>
      <label class="f wide"><span>Client</span><input data-c="Client" list="dl-clients" value="${esc(s.Client)}" placeholder="Rechercher un client" autocomplete="off"></label>
      <label class="f wide f-addr"><span>Adresse</span><input data-c="Adresse" list="dl-a-${i}" value="${esc(s.Adresse)}" placeholder="${clientDe(s) ? "Choisir une adresse du client" : "Rue, code postal, ville"}" autocomplete="off"${geo === null ? ` aria-invalid="true" aria-describedby="err-addr-${i}"` : ""}>${adresseOptions(s, i)}${geo === null ? `<span class="field-error" id="err-addr-${i}">Adresse introuvable : précisez la commune ou le code postal.</span>` : ""}</label>
      <label class="f"><span>Action</span><select data-c="Action">${optHtml(ACTIONS_CATALOGUE, s.Action)}</select></label>
      <label class="f"><span>Produit</span><select data-c="Produit">${optHtml(PRODUITS_CATALOGUE, s.Produit)}</select></label>
      <label class="f${s.Produit !== "WC chimique" ? " f-off" : ""}"><span>Option</span><select data-c="Option"${s.Produit !== "WC chimique" ? " disabled" : ""}>${optHtml(["", "Lave-main", "Urinoir"], s.Option, { "": "Aucune" })}</select></label>
      <div class="f"><span>Couleur</span><button type="button" class="couleur-btn${!couleursArret(s.Couleur).length && s.CouleurAuto ? " auto" : ""}" data-c="Couleur" aria-label="Couleur, ${esc(couleursTexte(s.Couleur) || (s.CouleurAuto ? "automatique : " + s.CouleurAuto : "au choix"))}">${couleurHtml(s)}</button></div>
      <label class="f"><span>Quantité</span><input data-c="Quantité" type="number" min="1" max="20" inputmode="numeric" value="${esc(s["Quantité"])}"></label>
      <button class="btn btn-ghost btn-icon btn-sm d-only" data-act="toggle" aria-expanded="${open}" aria-label="Détails de l'arrêt ${i + 1}" title="Détails">${icon("chevron-down", "chev")}</button>
      <label class="check d-only" title="Sélectionner"><input type="checkbox" data-c="Suppr"${s.Suppr ? " checked" : ""} aria-label="Sélectionner l'arrêt ${i + 1}"></label>
      <div class="more">
        <label class="f"><span>Nom sur la feuille de route</span><input data-c="Nom du client" value="${esc(s["Nom du client"])}"></label>
        <label class="f"><span>Durée (min)</span><input data-c="Durée (min)" type="number" min="1" max="480" step="5" inputmode="numeric" value="${esc(s["Durée (min)"])}"></label>
        <label class="f"><span>Pas avant</span><input data-c="Pas avant" type="time" step="300" value="${esc(s["Pas avant"])}"></label>
        <label class="f"><span>Pas après</span><input data-c="Pas après" type="time" step="300" value="${esc(s["Pas après"])}"></label>
        <label class="f wide"><span>Observations</span><input data-c="Observations" value="${esc(s.Observations)}" placeholder="Code portail, accès, contact"></label>
      </div>
      <div class="pills">${pillsHtml(s)}</div>
    </div>`;
  }

  function renderArrets(animate = null) {
    const valides = stopsValides().length;
    $("[data-count]").textContent = `${valides} / ${S.stops.length}`;
    if (!S.stops.length) {
      list.innerHTML = `<div class="empty-stops">${icon("route", "i-hero")}<h3>Aucun arrêt pour l'instant</h3>
        <p class="muted">Ajoutez vos arrêts à la main, depuis la base client ou depuis un fichier Excel.</p>
        <div class="row"><button class="btn btn-primary" data-act="from-clients">${icon("clients")}<span>Depuis la base client</span></button>
        <button class="btn" data-act="add">${icon("plus")}<span>Ajouter un arrêt</span></button></div></div>`;
    } else {
      list.innerHTML = S.stops.map(rowHtml).join("");
      if (animate === "all") list.querySelectorAll(".stop-row").forEach((r, k) => { r.style.animationDelay = `${Math.min(k * 35, 400)}ms`; r.classList.add("enter"); });
      else if (Number.isInteger(animate)) list.children[animate]?.classList.add("enter");
    }
    majSelection();
    renderControles();
  }

  function majLigne(i) {
    const old = list.children[i];
    if (!old) return;
    const active = document.activeElement;
    const key = active && old.contains(active) ? active.dataset.c : null;
    const tmp = document.createElement("div");
    tmp.innerHTML = rowHtml(S.stops[i], i);
    old.replaceWith(tmp.firstElementChild);
    if (key) list.children[i].querySelector(`[data-c="${CSS.escape(key)}"]`)?.focus();
  }

  function majSelection() {
    const n = S.stops.filter((s) => s.Suppr).length;
    const b = $("[data-act=del-sel]");
    b.hidden = !n;
    b.querySelector("span").textContent = `Supprimer (${n})`;
    const all = $("[data-act=sel-all]");
    all.checked = n > 0 && n === S.stops.length;
    all.indeterminate = n > 0 && n < S.stops.length;
  }

  function onCell(e, committed) {
    const el = e.target;
    const row = el.closest(".stop-row");
    if (!row || !el.dataset.c || el.dataset.c === "Couleur") return;
    const i = Number(row.dataset.i);
    const s = S.stops[i];
    const c = el.dataset.c;
    if (c === "Suppr") { s.Suppr = el.checked; row.classList.toggle("sel", el.checked); majSelection(); return; }
    if (!committed && el.tagName === "SELECT") return;
    if (!committed && (c === "Client" || c === "Adresse") && (!e.inputType || e.inputType === "insertReplacementText")) committed = true;
    s[c] = el.value;
    if (!committed) { emit("stops"); return; }
    if (c === "Client") {
      const name = cnorm.get(normTxt(el.value));
      if (name) autofillFromClient(s, name);
    }
    if (c === "Adresse" && String(el.value).trim()) { autofillFromAddress(s); verifierAdresse(i); }
    if (c === "Produit" && el.value !== "WC chimique") s.Option = "";
    if (c === "Produit" && el.value === "WC chimique" && !s.Option) s.Option = "Lave-main";
    if (c === "Quantité") {
      const v = parseInt(el.value, 10);
      s[c] = Math.min(20, Math.max(1, v || 1));
      if (v > 20) toast(`Arrêt ${i + 1} : quantité limitée à 20.`, "info");
    }
    if (c === "Durée (min)") {
      const v = parseInt(el.value, 10);
      s[c] = Math.min(480, Math.max(1, v || 30));
      if (v > 480) toast(`Arrêt ${i + 1} : durée limitée à 480 min.`, "info");
    }
    if (["Action", "Produit", "Quantité"].includes(c)) dureeAuto(s);
    emit("stops");
    majLigne(i);
    renderControles();
  }
  list.addEventListener("change", (e) => onCell(e, true));
  list.addEventListener("input", (e) => onCell(e, false));

  async function verifierAdresse(i) {
    const s = S.stops[i];
    const addr = String(s.Adresse || "").trim();
    if (!addr || geoConnu(addr) !== undefined) return;
    try { await geocode(addr); } catch { return; }
    if (S.stops[i] === s && !list.children[i]?.contains(document.activeElement)) majLigne(i);
    renderControles();
  }

  // Sélecteur de couleur (manuel ou automatique)
  const pop = document.createElement("div");
  pop.className = "popover";
  pop.hidden = true;
  document.body.appendChild(pop);
  let popRow = null;
  function ouvrirCouleurs(btn) {
    popRow = Number(btn.closest(".stop-row").dataset.i);
    const s = S.stops[popRow];
    const sel = couleursArret(s.Couleur);
    pop.innerHTML = `<label class="chip full"><input type="radio" name="cmode" value="auto"${sel.length ? "" : " checked"}>
        <span>Automatique selon le stock${s.CouleurAuto ? ` · <b>${esc(s.CouleurAuto)}</b>` : ""}</span></label>
      <div class="full small muted" style="margin:4px 2px">Ou couleurs acceptées par le client :</div>`
      + COULEURS_PRODUITS.map((c) => `<label class="chip"><input type="checkbox" value="${esc(c)}"${sel.includes(c) ? " checked" : ""}>
        <i class="pastille" style="--pc:${PASTILLE[c]}"></i>${esc(c)}</label>`).join("");
    pop.hidden = false;
    const r = btn.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const left = Math.max(12, Math.min(r.left + scrollX, scrollX + vw - pop.offsetWidth - 12));
    pop.style.left = `${left}px`;
    pop.style.top = `${r.bottom + scrollY + 6}px`;
    pop.querySelector("input")?.focus();
  }
  pop.addEventListener("change", (e) => {
    const s = S.stops[popRow];
    if (e.target.name === "cmode") { s.Couleur = ""; pop.querySelectorAll("input[type=checkbox]").forEach((x) => { x.checked = false; }); }
    else {
      s.Couleur = couleursTexte([...pop.querySelectorAll("input[type=checkbox]:checked")].map((x) => x.value));
      pop.querySelector("[name=cmode]").checked = !s.Couleur;
    }
    emit("stops");
    majLigne(popRow);
    renderControles();
  });
  const fermerPop = () => { if (!pop.hidden) { pop.hidden = true; list.children[popRow]?.querySelector(".couleur-btn")?.focus({ preventScroll: true }); } };
  document.addEventListener("click", (e) => { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest(".couleur-btn")) pop.hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") fermerPop(); });

  // ── Contrôles et disponibilité ───────────────────────────────────────────
  function renderControles() {
    const valid = stopsValides();
    const notes = [];
    if (introuvables?.length) {
      notes.push(`<div class="note warn">${icon("alert")}<div><b>${introuvables.length} adresse${introuvables.length > 1 ? "s" : ""} introuvable${introuvables.length > 1 ? "s" : ""}</b>
        <ul>${introuvables.map((l) => `<li><button class="btn-link" data-goto="${l.ligne}">Arrêt ${l.ligne + 1}</button> · ${esc(l.client || "")} ${esc(l.adresse)}</li>`).join("")}</ul>
        <div class="row"><button class="btn btn-sm" data-act="optim-sans">Optimiser sans ces arrêts</button></div></div></div>`);
    }
    const aChoisir = S.stops.map((s, i) => [s, i]).filter(([s]) => clientDe(s) && !String(s.Adresse).trim());
    if (aChoisir.length) notes.push(`<div class="note info">${icon("pin")}<div>Adresse à choisir : ${aChoisir.map(([s, i]) =>
      `<button class="btn-link" data-goto="${i}">arrêt ${i + 1}</button>`).join(", ")}.</div></div>`);
    const sansOpt = valid.filter((s) => s.Produit === "WC chimique" && !s.Option);
    if (sansOpt.length) notes.push(`<div class="note warn">${icon("alert")}<div>${sansOpt.length} WC chimique${sansOpt.length > 1 ? "s" : ""} sans lave-main ni urinoir (obligatoire, art. R4228-7).
      <div class="row"><button class="btn btn-sm" data-act="fix-option">Ajouter un lave-main</button></div></div></div>`);

    const eff = stopsEffectifs();
    const bes = besoinsTournee(eff, S.stockManutentions);
    const ctl = controleDisponibilite(S.stock, bes);
    const source = S.stockMaj ? `stock du ${fmtDate(S.stockMaj)}` : "stock de référence, non mis à jour";
    let stockHtml;
    if (!ctl.length) {
      const ret = bes.reduce((n, b) => n + b.retours, 0);
      stockHtml = `<p class="small muted">${ret ? `${ret} unité${ret > 1 ? "s" : ""} reviendront au dépôt.` : "Aucun matériel à sortir du dépôt."}</p>`;
    } else {
      const manq = ctl.filter((x) => x.manque > 0);
      stockHtml = manq.length
        ? `<div class="note err">${icon("x-circle")}<div><b>Stock insuffisant</b><ul>${manq.map((x) => `<li>${esc(x.article)} · ${esc(x.couleur)} : ${x.manque} manquant${x.manque > 1 ? "s" : ""}</li>`).join("")}</ul></div></div>`
        : S.stockMaj
          ? `<div class="note ok">${icon("check-circle")}<div>${ctl.reduce((n, x) => n + x.besoin, 0)} unité${ctl.length > 1 ? "s" : ""} à charger, toutes disponibles.</div></div>`
          : `<div class="note info">${icon("info")}<div>Calcul sur le stock de référence. <a href="#stock">Importer le stock du jour</a></div></div>`;
    }
    $('[data-zone="controles"]').innerHTML = `
      <div class="card-title">${icon("box-check")}<span>Vérifications</span><span class="small muted push">${esc(source)}</span></div>
      ${notes.join("") || `<p class="small muted">${valid.length ? `${valid.length} arrêt${valid.length > 1 ? "s" : ""} prêt${valid.length > 1 ? "s" : ""}.` : "Ajoutez au moins un arrêt avec une adresse."}</p>`}
      ${stockHtml}`;
    renderAction();
  }

  // ── Barre d'action ───────────────────────────────────────────────────────
  function renderAction() {
    const zone = $('[data-zone="action"]');
    if (optimRun) return;
    const n = stopsValides().length;
    const obs = S.result && resultatObsolete();
    zone.innerHTML = `
      <div class="ab-info"><b>${n} arrêt${n > 1 ? "s" : ""} prêt${n > 1 ? "s" : ""}</b>
        <span>${!n ? "Ajoutez une adresse pour commencer" : !S.result ? "Calcul de l'ordre, des horaires et du trajet" : obs ? "La saisie a changé : relancez le calcul" : `Tournée calculée · <a href="#tournee">voir</a>`}</span></div>
      <button class="btn btn-primary btn-lg" data-act="optimize"${n ? "" : " disabled"}>${icon("bolt")}<span>${S.result && !obs ? "Recalculer" : "Optimiser"}</span></button>`;
  }

  async function lancerOptimisation(ignorerIntrouvables = false) {
    const valid = S.stops.map((s, i) => ({ ...stopsEffectifs([s])[0], _ligne: i })).filter((s) => String(s.Adresse || "").trim());
    if (!valid.length || optimRun) return;
    const ctrl = new AbortController();
    optimRun = { ctrl };
    const zone = $('[data-zone="action"]');
    zone.innerHTML = `<div class="progress" role="status" aria-live="polite"><div class="row between"><b data-txt>Préparation</b>
      <button class="btn btn-sm btn-ghost" data-act="cancel">Annuler</button></div><div class="bar"><i></i></div></div>`;
    const bar = zone.querySelector(".bar i"), txt = zone.querySelector("[data-txt]");
    try {
      const { result, messages } = await optimiser({
        stops: valid, depotDepartKey: S.params.depotDepart, depotRetourKey: S.params.depotRetour,
        heureMinDepart: parseHhmm(S.params.heureMin) ?? 420, eviterPeri: S.params.eviterPeri, pause: S.params.pause,
        etatLieuxParArret: S.params.etatLieuxParArret, fuelConso: S.params.fuelConso, fuelPrice: S.params.fuelPrice,
        besoins: besoinsRecords(valid, S.stock, S.stockManutentions), signal: ctrl.signal, ignorerIntrouvables,
        onStatus: (t, pct) => { txt.textContent = t; if (pct != null) bar.style.width = `${pct}%`; },
      });
      introuvables = null;
      S.result = result; S.manual = null; S.resultStopsHash = hashStops(); S.optimMessages = messages;
      S.tournee.pdfAt = null;
      emit("result"); emit("tournee");
      confettis();
      ctx.goto("tournee");
    } catch (err) {
      if (err.code === "INTROUVABLES") { introuvables = err.lignes; toast("Certaines adresses sont introuvables.", "warn"); }
      else if (err.name !== "AbortError") toast(err.message, "err");
    } finally {
      optimRun = null;
      renderControles();
    }
  }

  // ── Actions ──────────────────────────────────────────────────────────────
  function annulable(message, snap) {
    toast(message, "ok", { action: { label: "Annuler", run: () => { restaurer(snap); renderArrets("all"); toast("Action annulée"); } } });
  }
  function animerSortie(indices, then) {
    const rows = indices.map((i) => list.children[i]).filter(Boolean);
    rows.forEach((r) => r.classList.add("leave"));
    setTimeout(then, rows.length && !matchMedia("(prefers-reduced-motion: reduce)").matches ? 260 : 0);
  }

  root.addEventListener("click", async (e) => {
    const go = e.target.closest("[data-goto]");
    if (go) {
      const i = Number(go.dataset.goto);
      const r = list.children[i];
      r?.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => r?.querySelector('[data-c="Adresse"]')?.focus({ preventScroll: true }), 400);
      return;
    }
    if (e.target.closest(".couleur-btn")) { ouvrirCouleurs(e.target.closest(".couleur-btn")); return; }
    const b = e.target.closest("[data-act]");
    if (!b || b.tagName === "INPUT") return;
    const act = b.dataset.act;
    if (act === "add") {
      S.stops.push(nouvelArret(S.bareme));
      emit("stops");
      renderArrets(S.stops.length - 1);
      const row = list.lastElementChild;
      row?.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => row?.querySelector('[data-c="Client"]')?.focus({ preventScroll: true }), 300);
    } else if (act === "toggle") {
      const row = b.closest(".stop-row"), i = Number(row.dataset.i);
      const open = row.classList.toggle("collapsed") === false;
      if (open) ouverts.add(i); else ouverts.delete(i);
      row.querySelectorAll("[data-act=toggle]").forEach((x) => x.setAttribute("aria-expanded", open));
    } else if (act === "del-one") {
      const i = Number(b.closest(".stop-row").dataset.i);
      const snap = instantane();
      animerSortie([i], () => { S.stops.splice(i, 1); ouverts.clear(); emit("stops"); renderArrets(); annulable(`Arrêt ${i + 1} supprimé`, snap); });
    } else if (act === "del-sel") {
      const idx = S.stops.map((s, i) => (s.Suppr ? i : -1)).filter((i) => i >= 0);
      const snap = instantane();
      animerSortie(idx, () => { S.stops = S.stops.filter((s) => !s.Suppr); ouverts.clear(); emit("stops"); renderArrets(); annulable(`${idx.length} arrêt${idx.length > 1 ? "s" : ""} supprimé${idx.length > 1 ? "s" : ""}`, snap); });
    } else if (act === "menu") {
      ouvrirMenu(b);
    } else if (act === "from-clients") {
      choisirClients();
    } else if (act === "fix-option") {
      const snap = instantane();
      let n = 0;
      S.stops.forEach((s) => { if (s.Produit === "WC chimique" && !s.Option && String(s.Adresse).trim()) { s.Option = "Lave-main"; dureeAuto(s); n++; } });
      emit("stops"); renderArrets();
      annulable(`Lave-main ajouté à ${n} arrêt${n > 1 ? "s" : ""}`, snap);
    } else if (act === "optimize") {
      lancerOptimisation(false);
    } else if (act === "optim-sans") {
      lancerOptimisation(true);
    } else if (act === "cancel") {
      optimRun?.ctrl.abort();
    } else if (act === "save") {
      enregistrer();
    } else if (act === "list") {
      ouvrirTournees();
    } else if (act === "new") {
      const snap = instantane();
      const tsnap = structuredClone(S.tournee);
      animerSortie(S.stops.map((_, i) => i), () => {
        nouvelleTournee(); introuvables = null; renderAll("all");
        toast("Nouvelle tournée", "ok", { action: { label: "Annuler", run: () => { Object.assign(S.tournee, tsnap); restaurer(snap); renderAll("all"); } } });
      });
    } else if (act === "bareme") {
      ouvrirBareme();
    }
  });
  $("[data-act=sel-all]").addEventListener("change", (e) => {
    S.stops.forEach((s) => { s.Suppr = e.target.checked; });
    list.querySelectorAll('[data-c="Suppr"]').forEach((x) => { x.checked = e.target.checked; x.closest(".stop-row").classList.toggle("sel", e.target.checked); });
    majSelection();
  });

  function ouvrirMenu(btn) {
    const host = btn.closest(".menu");
    host.querySelector(".menu-pop")?.remove();
    btn.setAttribute("aria-expanded", "true");
    host.insertAdjacentHTML("beforeend", `<div class="menu-pop" role="menu">
      <button role="menuitem" data-m="template">${icon("sheet")}Modèle Excel vierge</button>
      <button role="menuitem" data-m="export">${icon("download")}Exporter la saisie</button>
      <button role="menuitem" data-m="details">${icon("list")}${detailsTous ? "Masquer les détails" : "Afficher tous les détails"}</button>
      <button role="menuitem" data-m="clear" style="color:var(--err)">${icon("trash")}Vider la liste</button></div>`);
    const m = host.querySelector(".menu-pop");
    m.querySelector("button").focus();
    const close = () => { m.remove(); btn.setAttribute("aria-expanded", "false"); document.removeEventListener("click", outside, true); };
    const outside = (e) => { if (!host.contains(e.target)) close(); };
    setTimeout(() => document.addEventListener("click", outside, true));
    m.addEventListener("keydown", (e) => { if (e.key === "Escape") { close(); btn.focus(); } });
    m.addEventListener("click", async (e) => {
      const it = e.target.closest("[data-m]");
      if (!it) return;
      close();
      try {
        if (it.dataset.m === "template") telecharger(await exportStopsExcel(null, S.params.tourDate, S.params.driver), "Modele_saisie_tournee.xlsx", XLSX_MIME);
        else if (it.dataset.m === "export") {
          const v = stopsValides();
          if (!v.length) return toast("Aucun arrêt à exporter.", "info");
          telecharger(await exportStopsExcel(v, S.params.tourDate, S.params.driver), `Tournee_saisie_${fmtDate(S.params.tourDate).replaceAll("/", "-")}.xlsx`, XLSX_MIME);
        } else if (it.dataset.m === "details") {
          detailsTous = !detailsTous;
          try { localStorage.setItem("saisie-details", detailsTous ? "1" : "0"); } catch { /* rien */ }
          renderArrets();
        } else if (it.dataset.m === "clear") {
          const snap = instantane();
          animerSortie(S.stops.map((_, i) => i), () => { S.stops = stopsVides(); S.result = null; S.manual = null; emit("stops"); emit("result"); renderArrets("all"); annulable("Liste vidée", snap); });
        }
      } catch (err) { toast(err.message, "err"); }
    });
  }

  // Import Excel : le mode (remplacer / ajouter) est demandé après le choix du fichier.
  $("[data-act=import]").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const { stops, message, avertissements } = await parseStopsExcel(file);
      stops.forEach(dureeAuto);
      let mode = "replace";
      if (stopsValides().length) {
        const dlg = ouvrirDialog(`<h2>Importer ${stops.length} arrêt${stops.length > 1 ? "s" : ""}</h2>
          <p class="muted">Votre liste contient déjà ${stopsValides().length} arrêt(s).</p>
          <div class="dlg-actions"><button class="btn" data-m="replace">Remplacer la liste</button>
          <button class="btn btn-primary" data-m="add">Ajouter à la suite</button></div>`);
        mode = await new Promise((res) => {
          dlg.addEventListener("click", (ev) => { const m = ev.target.closest("[data-m]"); if (m) { closeDialog(dlg); res(m.dataset.m); } });
          dlg.addEventListener("close", () => res(null));
        });
        if (!mode) return;
      }
      const snap = instantane();
      const base = mode === "add" ? S.stops.filter((s) => String(s.Adresse).trim()) : [];
      S.stops = matchClientByAddress([...base, ...stops.map(normaliserArret)]);
      S.result = null; S.manual = null;
      emit("stops"); emit("result");
      renderArrets("all");
      annulable(message, snap);
      if (avertissements.length) toast(`${avertissements.length} correction${avertissements.length > 1 ? "s" : ""} appliquée${avertissements.length > 1 ? "s" : ""} pendant l'import : ${avertissements.join(" ")}`, "warn", { persist: true });
    } catch (err) { toast(err.message, "err"); }
  });

  // Ajout groupé depuis la base client
  function choisirClients() {
    const items = [...cindex].flatMap(([name, c]) => pointsDe(c).map((p, k) => ({ id: `${name}|${k}`, name, c, p })));
    const dlg = ouvrirDialog(`
      <div class="dlg-head">${icon("clients", "i-lg")}<h2>Ajouter depuis la base client</h2>
        <button class="btn btn-ghost btn-icon btn-sm" data-close aria-label="Fermer">${icon("x")}</button></div>
      <div class="search">${icon("search")}<input type="search" placeholder="Nom, ville, adresse" aria-label="Rechercher"></div>
      <div class="dlg-body client-list" style="max-height:50vh">${items.length ? items.map((x) => `
        <label class="client-item" data-q="${esc(normTxt(`${x.name} ${x.p.libelle} ${x.p.adresse}`))}"><input type="checkbox" value="${esc(x.id)}">
          <span class="grow"><b>${esc(x.name)}</b><small>${esc(x.p.libelle ? x.p.libelle + " · " : "")}${esc(x.p.adresse)}</small></span></label>`).join("")
        : `<p class="empty">La base client est vide.</p>`}</div>
      <div class="dlg-actions"><button class="btn" data-close>Annuler</button>
        <button class="btn btn-primary" data-ok disabled>${icon("plus")}<span>Ajouter</span></button></div>`, "dialog-wide");
    const ok = dlg.querySelector("[data-ok]");
    const majOk = () => { const n = dlg.querySelectorAll("input[type=checkbox]:checked").length; ok.disabled = !n; ok.querySelector("span").textContent = n ? `Ajouter ${n} arrêt${n > 1 ? "s" : ""}` : "Ajouter"; };
    dlg.addEventListener("change", majOk);
    dlg.querySelector("input[type=search]").addEventListener("input", (e) => {
      const q = normTxt(e.target.value);
      dlg.querySelectorAll("[data-q]").forEach((el) => { el.hidden = q && !el.dataset.q.includes(q); });
    });
    dlg.querySelector("input[type=search]").focus();
    ok.addEventListener("click", () => {
      const ids = [...dlg.querySelectorAll("input[type=checkbox]:checked")].map((x) => x.value);
      const snap = instantane();
      const vides = S.stops.filter((s) => !String(s.Adresse).trim() && !String(s.Client).trim()).length === S.stops.length;
      if (vides) S.stops = [];
      const debut = S.stops.length;
      for (const id of ids) {
        const x = items.find((it) => it.id === id);
        const s = nouvelArret(S.bareme);
        autofillFromClient(s, x.name);
        applyPoint(s, x.c, x.p);
        S.stops.push(s);
      }
      closeDialog(dlg);
      emit("stops");
      renderArrets("all");
      list.children[debut]?.scrollIntoView({ behavior: "smooth", block: "center" });
      annulable(`${ids.length} arrêt${ids.length > 1 ? "s" : ""} ajouté${ids.length > 1 ? "s" : ""}`, snap);
      S.stops.forEach((_, i) => { if (i >= debut) verifierAdresse(i); });
    });
  }

  // Tournées enregistrées
  async function ouvrirTournees() {
    const dlg = ouvrirDialog(`
      <div class="dlg-head">${icon("folder", "i-lg")}<h2>Tournées enregistrées</h2>
        <button class="btn btn-ghost btn-icon btn-sm" data-close aria-label="Fermer">${icon("x")}</button></div>
      <div class="row" style="margin-bottom:12px"><div class="search" style="flex:1 1 220px">${icon("search")}<input type="search" placeholder="Nom ou chauffeur" aria-label="Rechercher"></div>
        <div class="seg" role="group" aria-label="Période"><span class="ink"></span>
          <button data-per="30" aria-pressed="true">30 jours</button><button data-per="all" aria-pressed="false">Toutes</button></div></div>
      <div class="dlg-body"><p class="empty">Chargement…</p></div>`, "dialog-wide");
    const body = dlg.querySelector(".dlg-body");
    const seg = dlg.querySelector(".seg");
    let periode = "30", liste = [];
    const { moveInk } = await import("./util.js?v=202611162119");
    const dessiner = () => {
      const q = normTxt(dlg.querySelector("input[type=search]").value);
      const lim = Date.now() - 30 * 864e5;
      const vis = liste.filter((t) => (periode === "all" || new Date(t.updated_at).getTime() >= lim)
        && (!q || normTxt(`${t.nom} ${t.chauffeur}`).includes(q)));
      body.innerHTML = vis.length ? `<div class="list-tour">${vis.map((t) => `
        <div class="row" style="flex-wrap:nowrap;gap:6px">
          <button data-x="open" data-id="${esc(t.id)}" style="flex:1">${icon("route")}<span class="grow"><b>${esc(t.nom)}${t.id === S.tournee.id ? ' <span class="badge">ouverte</span>' : ""}</b>
            <span class="meta">${esc(fmtDate(t.tour_date))} · ${t.nb_arrets} arrêt${t.nb_arrets > 1 ? "s" : ""}${t.chauffeur ? " · " + esc(t.chauffeur) : ""}</span></span></button>
          <button class="btn btn-sm btn-icon" data-x="copy" data-id="${esc(t.id)}" aria-label="Dupliquer ${esc(t.nom)}" title="Dupliquer">${icon("copy")}</button>
          <button class="btn btn-sm btn-icon btn-danger-ghost" data-x="del" data-id="${esc(t.id)}" data-nom="${esc(t.nom)}" aria-label="Supprimer ${esc(t.nom)}" title="Supprimer">${icon("trash")}</button>
        </div>`).join("")}</div><p class="small muted" style="margin-top:8px">${vis.length} sur ${liste.length}</p>`
        : `<p class="empty">Aucune tournée${q ? " ne correspond" : ""}.</p>`;
    };
    requestAnimationFrame(() => moveInk(seg, seg.querySelector('[aria-pressed="true"]')));
    seg.addEventListener("click", (e) => {
      const b = e.target.closest("[data-per]");
      if (!b) return;
      periode = b.dataset.per;
      seg.querySelectorAll("[data-per]").forEach((x) => x.setAttribute("aria-pressed", x === b));
      moveInk(seg, b);
      dessiner();
    });
    dlg.querySelector("input[type=search]").addEventListener("input", dessiner);
    try { liste = await ctx.store.listTournees(); dessiner(); } catch (err) { body.innerHTML = `<p class="note err">${icon("x-circle")}<span>${esc(err.message)}</span></p>`; }
    dlg.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-x]");
      if (!b) return;
      try {
        if (b.dataset.x === "open" || b.dataset.x === "copy") {
          await loadTournee(b.dataset.id, b.dataset.x === "copy");
          introuvables = null;
          closeDialog(dlg);
          renderAll("all");
          toast(b.dataset.x === "copy" ? "Copie prête : pensez à l'enregistrer" : "Tournée ouverte");
        } else if (b.dataset.x === "del") {
          if (!await confirmer(`Supprimer « ${b.dataset.nom} » ?`, "Cette tournée sera supprimée définitivement.", "Supprimer")) return;
          await ctx.store.deleteTournee(b.dataset.id);
          if (b.dataset.id === S.tournee.id) { S.tournee.id = null; S.tournee.savedHash = null; emit("tournee"); }
          liste = liste.filter((t) => t.id !== b.dataset.id);
          dessiner();
          toast("Tournée supprimée");
        }
      } catch (err) { toast(err.message, "err"); }
    });
  }

  function ouvrirBareme() {
    const dlg = ouvrirDialog(`
      <div class="dlg-head">${icon("timer", "i-lg")}<h2>Barème des durées</h2>
        <button class="btn btn-ghost btn-icon btn-sm" data-close aria-label="Fermer">${icon("x")}</button></div>
      <p class="small muted">Minutes par unité, multipliées par la quantité. Case vide : durée saisie à la main.</p>
      <div class="table-wrap"><table class="table"><thead><tr><th>Action</th>${BAREME_PRODUITS.map((p) => `<th>${esc(p)}</th>`).join("")}</tr></thead>
        <tbody>${BAREME_ACTIONS.map((a) => `<tr><th>${esc(a)}</th>${BAREME_PRODUITS.map((p) =>
          `<td><input type="number" min="1" max="240" step="5" style="width:5rem" data-bp="${esc(p)}" data-ba="${esc(a)}" value="${S.bareme[p]?.[a] ?? ""}" aria-label="${esc(a)}, ${esc(p)}"></td>`).join("")}</tr>`).join("")}</tbody></table></div>
      <label class="switch" style="margin-top:12px"><input type="checkbox" data-b="appliquer" checked><span>Recalculer les durées des arrêts saisis</span></label>
      <div class="dlg-actions"><button class="btn btn-ghost" data-b="defaut">Valeurs par défaut</button><button class="btn btn-primary" data-b="save">Enregistrer</button></div>`, "dialog-wide");
    dlg.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-b=save], [data-b=defaut]");
      if (!b) return;
      const val = {};
      if (b.dataset.b === "save") dlg.querySelectorAll("[data-bp]").forEach((x) => { (val[x.dataset.bp] ||= {})[x.dataset.ba] = x.value === "" ? null : parseInt(x.value, 10); });
      await withBusy(b, "Enregistrement…", () => saveBareme(b.dataset.b === "save" ? val : baremeDefaut(), dlg.querySelector("[data-b=appliquer]").checked));
      closeDialog(dlg);
      renderArrets();
      toast(S.baremeError ? "Barème appliqué sur cet appareil uniquement" : "Barème enregistré", S.baremeError ? "info" : "ok");
    });
  }

  async function enregistrer() {
    const nom = root.querySelector("[data-t=nom]")?.value;
    const btn = root.querySelector("[data-act=save]");
    const run = () => saveTournee(nom);
    const ok = btn ? await withBusy(btn, "Enregistrement…", run) : await run();
    if (ok) toast("Tournée enregistrée");
  }

  // Paramètres et nom
  root.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset.t === "nom") { if (S.tournee.id) { S.tournee.nom = el.value.trim() || nomParDefaut(); emit("tournee"); } return; }
    const k = el.dataset.p;
    if (!k) return;
    S.params[k] = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value;
    if (["etatLieuxParArret", "fuelConso", "fuelPrice"].includes(k)) { appliquerParamsResultat(); emit("result"); }
    emit("params");
    if (["eviterPeri", "pause", "depotDepart", "depotRetour", "fuelConso"].includes(k)) {
      const open = root.querySelector('[data-zone="params"] details')?.open;
      renderParams();
      if (open) root.querySelector('[data-zone="params"] details').open = true;
    }
    renderAction();
  });

  async function chargerChauffeurs() {
    try {
      const l = await ctx.store.listTournees();
      $("#dl-chauffeurs").innerHTML = [...new Set(l.map((t) => t.chauffeur).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join("");
    } catch { /* facultatif */ }
  }

  function renderAll(anim) { renderTournee(); renderParams(); renderArrets(anim); }

  ctx.onClients(() => { rebuildIndex(); if (!root.hidden) renderArrets(); });
  on("tournee", () => { if (!root.contains(document.activeElement) || document.activeElement.dataset.t !== "nom") renderTournee(); });
  on("stock", () => { if (!root.hidden) renderArrets(); });
  on("result", renderAction);

  ctx.optimiser = () => lancerOptimisation(false);
  rebuildIndex();
  renderAll();
  chargerChauffeurs();

  return { show() { renderAll(); }, enregistrer };
}
