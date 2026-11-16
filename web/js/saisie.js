// Onglet « Saisie des arrêts » : tournées enregistrées, paramètres, import /
// export Excel, tableau éditable relié à la base client, barème, contrôle de
// stock en temps réel et lancement de l'optimisation.

import { DEPOTS, PRODUITS_CATALOGUE, COULEURS_PRODUITS, ACTION_COLORS, esc, normTxt, couleursArret,
  couleursTexte, fmtDateHeure, toast, confirmer, fmtDate } from "./util.js";
import { ACTIONS_CATALOGUE, BAREME_PRODUITS, BAREME_ACTIONS, baremeDefaut, besoinsTournee,
  controleDisponibilite, besoinsRecords, nouvelArret, normaliserArret, parseHhmm, PAUSE_DEJEUNER_MIN } from "./metier.js";
import { S, on, emit, stopsVides, stopsValides, dureeAuto, saveTournee, loadTournee, nouvelleTournee,
  nomParDefaut, saveBareme, hashStops, resultatObsolete, appliquerParamsResultat } from "./state.js";
import { exportStopsExcel, parseStopsExcel } from "./xlsx.js";
import { telecharger, XLSX_MIME } from "./libs.js";
import { optimiser, pointe } from "./optim.js";

export function initSaisie(root, ctx) {
  root.innerHTML = `
    <div class="page-head">
      <div><h2>📋 Saisie des arrêts</h2>
        <p class="muted">Préparez la tournée (saisie, base client ou import Excel), puis lancez l'optimisation.
        L'ordre de saisie n'a pas d'importance.</p></div>
    </div>

    <section class="card tournee-bar">
      <div class="tb-row">
        <label class="tb-nom">💾 Nom de la tournée<input data-t="nom" placeholder=""></label>
        <button class="btn btn-primary" data-act="save"></button>
        <button class="btn" data-act="list">📂 Tournées enregistrées</button>
        <button class="btn" data-act="new" title="Repart d'un tableau vide (la tournée enregistrée n'est pas modifiée)">➕ Nouvelle</button>
      </div>
      <div class="tb-status small"></div>
    </section>

    <div class="saisie-layout">
      <aside class="card params">
        <h3>📅 Tournée</h3>
        <label>Date<input type="date" data-p="tourDate"></label>
        <label>👤 Chauffeur<input data-p="driver" placeholder="ex : Jean Dupont"></label>
        <label title="Repos quotidien de 11 h (art. L3131-1 du Code du travail) ; départ rarement avant 06:00">🕖 Départ au plus tôt
          <input type="time" step="300" data-p="heureMin"></label>
        <h3>🏭 Dépôts</h3>
        <label>📍 Départ<select data-p="depotDepart">${Object.keys(DEPOTS).map((k) => `<option>${esc(k)}</option>`).join("")}</select></label>
        <label>🏁 Retour<select data-p="depotRetour">${Object.keys(DEPOTS).map((k) => `<option>${esc(k)}</option>`).join("")}</select></label>
        <h3>🚛 Véhicule</h3>
        <div class="grid-2">
          <label>L/100 km<input type="number" min="5" max="30" step="0.5" data-p="fuelConso"></label>
          <label>€ / L<input type="number" min="1" max="3.5" step="0.01" data-p="fuelPrice"></label>
        </div>
        <h3>⚖️ Règles</h3>
        <label class="switch"><input type="checkbox" data-p="eviterPeri"><span>🚦 Périphérique toulousain</span></label>
        <p class="small muted" data-info="peri"></p>
        <label class="switch"><input type="checkbox" data-p="pause"><span>🍽️ Pause déjeuner (${PAUSE_DEJEUNER_MIN} min)</span></label>
        <label class="switch"><input type="checkbox" data-p="etatLieuxParArret"><span>📋 Une fiche état des lieux par arrêt</span></label>
        <p class="small muted" data-info="el"></p>
      </aside>

      <div class="saisie-main">
        <section class="card">
          <h3>1️⃣ Import de la tournée</h3>
          <div class="row">
            <label class="btn btn-file">📥 Importer un fichier Excel<input type="file" accept=".xlsx,.xlsm" data-act="import" hidden></label>
            <select data-act="mode" aria-label="Mode d'import">
              <option value="replace">Remplacer la saisie</option>
              <option value="add">Ajouter aux arrêts existants</option>
            </select>
            <button class="btn" data-act="template">📄 Modèle vierge</button>
            <button class="btn" data-act="export-saisie">⬇️ Exporter la saisie</button>
          </div>
          <div class="import-msg"></div>
        </section>

        <section class="card">
          <div class="row between">
            <h3>2️⃣ Tableau des arrêts</h3>
            <div class="legend-inline small">${Object.entries(ACTION_COLORS).map(([a, c]) =>
              `<span><i style="background:${c}"></i>${esc(a)}</span>`).join("")}</div>
          </div>
          <div class="row toolbar">
            <button class="btn btn-sm" data-act="add">➕ Ajouter un arrêt</button>
            <button class="btn btn-sm" data-act="del-sel" disabled>🗑️ Supprimer la sélection</button>
            <button class="btn btn-sm btn-danger-ghost" data-act="clear">Tout vider</button>
          </div>
          <div class="stops-wrap">
            <table class="stops-table">
              <thead><tr>
                <th class="c-num">#</th><th class="c-sel" title="Sélection pour suppression">🗑️</th>
                <th>📇 Client</th><th>Action</th><th>Produit</th><th>Option</th><th>🎨 Couleurs</th>
                <th>Qté</th><th>Nom du client</th><th>📍 Adresse complète</th><th>⏱ Durée</th>
                <th>Pas avant</th><th>Pas après</th><th>📝 Observations</th>
              </tr></thead>
              <tbody></tbody>
            </table>
          </div>
          <datalist id="dl-clients"></datalist>
          <datalist id="dl-adresses"></datalist>
          <div class="saisie-checks"></div>
        </section>

        <details class="card bareme">
          <summary>⏱️ Barème des durées (modifiable)</summary>
          <p class="small muted">Minutes <b>par unité</b>, multipliées par la quantité. Case vide = hors barème :
            la durée se saisit à la main (WC Luxe par défaut). Le WC client n'a pas de barème.</p>
          <div class="table-wrap"><table class="table bareme-table"></table></div>
          <label class="switch"><input type="checkbox" data-b="appliquer" checked><span>Recalculer aussi les durées des arrêts déjà saisis</span></label>
          <div class="row">
            <button class="btn btn-primary btn-sm" data-act="bareme-save">💾 Enregistrer le barème</button>
            <button class="btn btn-sm" data-act="bareme-reset">♻️ Valeurs par défaut</button>
          </div>
          <p class="small err" data-bareme-err hidden></p>
        </details>

        <section class="card stock-live"></section>

        <section class="card">
          <h3>3️⃣ Optimisation de la tournée</h3>
          <button class="btn btn-primary btn-block btn-lg" data-act="optimize">🚀 Optimiser la tournée</button>
          <div class="optim-out"></div>
        </section>
      </div>
    </div>`;

  const $ = (s) => root.querySelector(s);
  const tbody = $(".stops-table tbody");

  // ── Index base client ────────────────────────────────────────────────────
  let cindex = new Map();   // nom affiché → fiche
  let aindex = new Map();   // adresse → [{ name, c, p }]
  function rebuildIndex() {
    cindex = new Map();
    for (const c of ctx.clients) {
      const base = String(c.nom || "").trim() || "Sans nom";
      let name = base, n = 2;
      while (cindex.has(name)) name = `${base} (${n++})`;
      cindex.set(name, c);
    }
    aindex = new Map();
    for (const [name, c] of cindex) {
      for (const p of c.points || []) {
        const a = String(p.adresse || "").trim();
        if (!a) continue;
        if (!aindex.has(a)) aindex.set(a, []);
        aindex.get(a).push({ name, c, p });
      }
    }
    $("#dl-clients").innerHTML = [...cindex.keys()].map((n) => `<option value="${esc(n)}"></option>`).join("");
    $("#dl-adresses").innerHTML = [...aindex.entries()].map(([a, o]) =>
      `<option value="${esc(a)}">${esc(o[0].name)}${o[0].p.libelle ? " · " + esc(o[0].p.libelle) : ""}</option>`).join("");
  }

  const pointsDe = (c) => (c.points || []).filter((p) => String(p.adresse || "").trim());

  function applyPoint(s, c, p) {
    const nom = String(c.nom || "").trim(), lib = String(p.libelle || "").trim();
    s["Nom du client"] = lib ? `${nom} – ${lib}` : nom;
    s["Adresse"] = String(p.adresse || "").trim();
    s["Pas avant"] = p.pas_avant || c.pas_avant || "";
    s["Pas après"] = p.pas_apres || c.pas_apres || "";
    s["Observations"] = String(p.observations || "");
  }

  function autofillFromClient(s, name) {
    const c = cindex.get(name);
    if (!c) return;
    const produit = c.produit || "WC chimique";
    Object.assign(s, { "Client": name, "Produit": produit,
      "Option": produit === "WC chimique" ? c.option_produit || "" : "",
      "Quantité": Math.max(1, parseInt(c.quantite, 10) || 1), "Couleur": couleursTexte(c.couleurs || "") });
    const pts = pointsDe(c);
    const deja = pts.find((p) => String(p.adresse).trim() === String(s["Adresse"]).trim());
    if (pts.length === 1) applyPoint(s, c, pts[0]);
    else if (deja) applyPoint(s, c, deja);
    else Object.assign(s, { "Nom du client": String(c.nom || "").trim(), "Adresse": "",
      "Pas avant": c.pas_avant || "", "Pas après": c.pas_apres || "", "Observations": "" });
    dureeAuto(s);
  }

  function autofillFromAddress(s) {
    const addr = String(s["Adresse"] || "").trim();
    const owners = aindex.get(addr);
    if (!owners) return;
    const cur = String(s["Client"] || "").trim();
    const o = owners.find((x) => x.name === cur) || owners[0];
    if (o.name !== cur) { autofillFromClient(s, o.name); s["Adresse"] = addr; }
    applyPoint(s, o.c, o.p);
  }

  function matchClientByAddress(stops) {
    const by = new Map();
    for (const [name, c] of cindex) for (const p of c.points || []) {
      const k = normTxt(p.adresse);
      if (k && !by.has(k)) by.set(k, name);
    }
    for (const s of stops) if (!String(s["Client"]).trim() && by.has(normTxt(s["Adresse"]))) s["Client"] = by.get(normTxt(s["Adresse"]));
    return stops;
  }

  // ── Tableau ──────────────────────────────────────────────────────────────
  const opt = (list, v, labels = {}) => list.map((x) =>
    `<option value="${esc(x)}"${x === v ? " selected" : ""}>${esc(labels[x] ?? x)}</option>`).join("");

  function rowHtml(s, i) {
    return `<tr data-i="${i}">
      <td class="c-num">${i + 1}</td>
      <td class="c-sel"><input type="checkbox" data-c="Suppr" aria-label="Sélectionner la ligne ${i + 1}"></td>
      <td><input data-c="Client" list="dl-clients" class="w-client" placeholder="—"></td>
      <td><select data-c="Action" class="w-action">${opt(ACTIONS_CATALOGUE, s["Action"])}</select></td>
      <td><select data-c="Produit">${opt(PRODUITS_CATALOGUE, s["Produit"])}</select></td>
      <td><select data-c="Option">${opt(["", "Lave-main", "Urinoir"], s["Option"], { "": "—" })}</select></td>
      <td><button type="button" class="couleur-btn" data-c="Couleur"></button></td>
      <td><input data-c="Quantité" type="number" min="1" max="20" class="w-num"></td>
      <td><input data-c="Nom du client" class="w-nom"></td>
      <td><input data-c="Adresse" list="dl-adresses" class="w-addr" placeholder="Rue, code postal, ville"></td>
      <td><input data-c="Durée (min)" type="number" min="1" max="480" step="5" class="w-num"></td>
      <td><input data-c="Pas avant" type="time" step="300"></td>
      <td><input data-c="Pas après" type="time" step="300"></td>
      <td><input data-c="Observations" class="w-obs"></td>
    </tr>`;
  }

  function fillRow(tr, s) {
    tr.querySelectorAll("[data-c]").forEach((el) => {
      const c = el.dataset.c;
      if (c === "Suppr") el.checked = !!s.Suppr;
      else if (c === "Couleur") {
        const cs = couleursArret(s.Couleur);
        el.innerHTML = cs.length ? cs.map((x) => `<i class="pastille" style="--pc:${pastille(x)}" title="${esc(x)}"></i>`).join("")
          + `<span>${esc(cs.join(", "))}</span>` : `<span class="muted">Toutes</span>`;
      } else if (el.value !== String(s[c] ?? "")) el.value = String(s[c] ?? "");
    });
    const opt = tr.querySelector("[data-c=Option]");
    opt.disabled = s["Produit"] !== "WC chimique";
    tr.querySelector("[data-c=Action]").style.borderLeft = `4px solid ${ACTION_COLORS[s.Action] || "#999"}`;
    tr.classList.toggle("sel", !!s.Suppr);
  }

  function renderTable() {
    tbody.innerHTML = S.stops.map(rowHtml).join("");
    tbody.querySelectorAll("tr").forEach((tr, i) => fillRow(tr, S.stops[i]));
    refreshChecks();
  }

  tbody.addEventListener("change", (e) => onCell(e, true));
  tbody.addEventListener("input", (e) => onCell(e, false));

  function onCell(e, committed) {
    const el = e.target;
    const tr = el.closest("tr");
    if (!tr || !el.dataset.c) return;
    const s = S.stops[Number(tr.dataset.i)];
    const c = el.dataset.c;
    if (c === "Suppr") { s.Suppr = el.checked; tr.classList.toggle("sel", el.checked); refreshChecks(); emit("stops"); return; }
    const v = el.value;
    if (!committed && el.tagName === "SELECT") return;
    // Choix dans une liste de suggestions (datalist) : appliqué immédiatement
    if (!committed && (c === "Client" || c === "Adresse") && (!e.inputType || e.inputType === "insertReplacementText")) committed = true;
    s[c] = c === "Quantité" || c === "Durée (min)" ? (v === "" ? "" : Number(v)) : v;
    if (committed) {
      if (c === "Client" && cindex.has(v)) autofillFromClient(s, v);
      if (c === "Adresse" && String(v).trim()) autofillFromAddress(s);
      if (c === "Produit" && v !== "WC chimique") s["Option"] = "";
      if (["Action", "Produit", "Quantité"].includes(c)) {
        if (c === "Quantité") s[c] = Math.min(20, Math.max(1, parseInt(v, 10) || 1));
        dureeAuto(s);
      }
      if (c === "Durée (min)") s[c] = Math.min(480, Math.max(1, parseInt(v, 10) || 30));
      fillRow(tr, s);
    }
    refreshChecks();
    emit("stops");
  }

  // Sélecteur de couleurs (popover unique, positionné sous la cellule)
  const pastille = (c) => ({ "Vert": "#2E7D32", "Jaune": "#F9A825", "Rose": "#EC407A", "Bleu": "#1E88E5",
    "Orange": "#EF6C00", "Crème": "#D9C89E", "Blanc": "#FFFFFF", "Gris": "#9E9E9E" })[c] || "#ccc";
  const pop = document.createElement("div");
  pop.className = "popover";
  pop.hidden = true;
  document.body.appendChild(pop);
  let popRow = null;
  tbody.addEventListener("click", (e) => {
    const b = e.target.closest(".couleur-btn");
    if (!b) return;
    const tr = b.closest("tr");
    popRow = Number(tr.dataset.i);
    const sel = couleursArret(S.stops[popRow].Couleur);
    pop.innerHTML = `<div class="small muted">Couleurs acceptées (aucune = toutes)</div>` + COULEURS_PRODUITS.map((c) =>
      `<label class="chip"><input type="checkbox" value="${esc(c)}"${sel.includes(c) ? " checked" : ""}>
        <i class="pastille" style="--pc:${pastille(c)}"></i>${esc(c)}</label>`).join("");
    const r = b.getBoundingClientRect();
    pop.hidden = false;
    pop.style.top = `${r.bottom + window.scrollY + 4}px`;
    pop.style.left = `${Math.min(r.left + window.scrollX, window.scrollX + innerWidth - pop.offsetWidth - 16)}px`;
    e.stopPropagation();
  });
  pop.addEventListener("change", () => {
    const s = S.stops[popRow];
    s.Couleur = couleursTexte([...pop.querySelectorAll("input:checked")].map((x) => x.value));
    fillRow(tbody.children[popRow], s);
    refreshChecks();
    emit("stops");
  });
  document.addEventListener("click", (e) => { if (!pop.hidden && !pop.contains(e.target)) pop.hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") pop.hidden = true; });

  // ── Contrôles sous le tableau ───────────────────────────────────────────
  function refreshChecks() {
    const valid = stopsValides();
    const sel = S.stops.filter((s) => s.Suppr).length;
    const del = $("[data-act=del-sel]");
    del.disabled = !sel;
    del.textContent = `🗑️ Supprimer la sélection${sel ? ` (${sel})` : ""}`;
    const msgs = [`<p class="small">📍 <b>${valid.length}</b> arrêt(s) avec adresse renseignée</p>`];
    const aChoisir = S.stops.map((s, i) => [s, i]).filter(([s]) => cindex.has(String(s.Client).trim()) && !String(s.Adresse).trim())
      .map(([s, i]) => `ligne ${i + 1} (${esc(s.Client)})`);
    if (aChoisir.length) msgs.push(`<p class="note info">📍 Adresse de livraison à choisir dans la colonne Adresse : ${aChoisir.join(", ")}.</p>`);
    const sansOpt = valid.filter((s) => s.Produit === "WC chimique" && !s.Option).length;
    if (sansOpt) msgs.push(`<p class="note warn">🚽 <b>${sansOpt} arrêt(s) avec WC chimique sans option.</b> Chaque WC chimique doit être accompagné d'un Urinoir ou d'un Lave-main (Code du travail, art. R4228-7).</p>`);
    if (!ctx.clients.length) msgs.push(`<p class="small muted">📇 La colonne Client propose les fiches de l'onglet Clients : créez-y vos clients pour remplir les lignes automatiquement.</p>`);
    $(".saisie-checks").innerHTML = msgs.join("");
    $("[data-act=optimize]").disabled = !valid.length;
    renderStockLive();
    renderOptimState();
  }

  function renderStockLive() {
    const bes = besoinsTournee(S.stops, S.stockManutentions);
    const ctl = controleDisponibilite(S.stock, bes);
    let html;
    if (!ctl.length) {
      const ret = bes.reduce((n, b) => n + b.retours, 0);
      html = ret ? `<p class="note info">📥 Cette tournée génère uniquement des retours au dépôt (${ret} unité(s) réintégrée(s) en stock).</p>`
        : `<p class="small muted">📦 Aucun mouvement de matériel n'est généré par cette saisie (seules les actions Déposer et Retirer — et les manutentions si l'option est activée dans l'onglet Stock — affectent le parc).</p>`;
    } else {
      const manq = ctl.filter((x) => x.manque > 0), justes = ctl.filter((x) => x.statut === "juste");
      if (manq.length) {
        html = `<div class="note err"><b>🔴 Stock insuffisant pour cette tournée</b><ul>${manq.map((x) =>
          `<li><b>${esc(x.article)}</b> · ${esc(x.couleur)} → besoin <b>${x.besoin}</b>, disponible <b>${x.disponible}</b> → <b>${x.manque} manquant(s)</b></li>`).join("")}</ul>
          Ajustez les quantités ou les couleurs, ou consultez l'onglet <a href="#stock">📦 Stock</a>.</div>`;
      } else if (justes.length) {
        html = `<p class="note warn">🟠 <b>Stock juste suffisant</b> sur ${justes.length} référence(s) : la tournée videra complètement ces lignes de stock.</p>`;
      } else {
        html = `<p class="note ok">🟢 <b>Stock suffisant</b> : ${ctl.reduce((n, x) => n + x.besoin, 0)} unité(s) à sortir du dépôt, toutes disponibles.</p>`;
      }
    }
    $(".stock-live").innerHTML = `<h3>📦 Disponibilité du matériel</h3>${html}`;
  }

  root.querySelector(".saisie-main").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    if (act === "add") {
      S.stops.push(nouvelArret(S.bareme));
      renderTable();
      emit("stops");
      tbody.lastElementChild.querySelector("[data-c=Client]").focus();
    } else if (act === "del-sel") {
      const keep = S.stops.filter((s) => !s.Suppr);
      S.stops = keep.length ? keep : stopsVides();
      renderTable();
      emit("stops");
    } else if (act === "clear") {
      if (!await confirmer("Vider le tableau ?", "Tous les arrêts saisis seront retirés du tableau.", "Tout vider")) return;
      S.stops = stopsVides();
      S.result = null; S.manual = null;
      renderTable();
      emit("stops"); emit("result");
    } else if (act === "template") {
      await download(() => exportStopsExcel(null, S.params.tourDate, S.params.driver), "Modele_saisie_tournee.xlsx");
    } else if (act === "export-saisie") {
      const v = stopsValides();
      if (!v.length) return toast("Aucun arrêt avec adresse à exporter.", "err");
      await download(() => exportStopsExcel(v, S.params.tourDate, S.params.driver),
        `Tournee_saisie_${fmtDate(S.params.tourDate).replaceAll("/", "-")}.xlsx`);
    } else if (act === "bareme-save") {
      await saveBareme(readBareme(), $("[data-b=appliquer]").checked);
      if (!S.baremeError) toast("✅ Barème enregistré");
      renderTable();
    } else if (act === "bareme-reset") {
      await saveBareme(baremeDefaut(), $("[data-b=appliquer]").checked);
      renderTable();
    } else if (act === "optimize") {
      runOptim(b);
    }
  });

  async function download(make, nom) {
    try { telecharger(await make(), nom, XLSX_MIME); }
    catch (err) { toast(err.message, "err"); }
  }

  // ── Import Excel ─────────────────────────────────────────────────────────
  $("[data-act=import]").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const box = $(".import-msg");
    box.innerHTML = `<p class="small muted">Lecture de ${esc(file.name)}…</p>`;
    try {
      const { stops, message, avertissements } = await parseStopsExcel(file);
      stops.forEach(dureeAuto);
      const base = $("[data-act=mode]").value === "add" ? S.stops.filter((s) => String(s.Adresse).trim()) : [];
      S.stops = matchClientByAddress([...base, ...stops.map(normaliserArret)]);
      S.result = null; S.manual = null;
      renderTable();
      emit("stops"); emit("result");
      box.innerHTML = `<p class="note ok">📥 <b>${esc(file.name)}</b> — ${esc(message)}</p>` + (avertissements.length
        ? `<details class="note warn"><summary>⚠️ ${avertissements.length} point(s) de vigilance sur l'import</summary><ul>${
          avertissements.map((a) => `<li>${esc(a)}</li>`).join("")}</ul><p class="small">Ces corrections ont été appliquées automatiquement. Vérifiez les lignes concernées.</p></details>` : "");
    } catch (err) {
      box.innerHTML = `<p class="note err">❌ ${esc(err.message)}</p>`;
    }
  });

  // ── Barème ───────────────────────────────────────────────────────────────
  function renderBareme() {
    $(".bareme-table").innerHTML = `<thead><tr><th>Action</th>${BAREME_PRODUITS.map((p) => `<th>${esc(p)}</th>`).join("")}</tr></thead>
      <tbody>${BAREME_ACTIONS.map((a) => `<tr><th>${esc(a)}</th>${BAREME_PRODUITS.map((p) =>
        `<td><input type="number" min="1" max="240" step="5" class="w-num" data-bp="${esc(p)}" data-ba="${esc(a)}"
          value="${S.bareme[p]?.[a] ?? ""}" aria-label="${esc(a)} – ${esc(p)} (minutes)"></td>`).join("")}</tr>`).join("")}</tbody>`;
    const err = $("[data-bareme-err]");
    err.hidden = !S.baremeError;
    err.textContent = S.baremeError ? `⚠️ Barème non enregistré dans Supabase (conservé pour cette session) : ${S.baremeError}` : "";
  }
  function readBareme() {
    const b = {};
    root.querySelectorAll("[data-bp]").forEach((el) => {
      (b[el.dataset.bp] ||= {})[el.dataset.ba] = el.value === "" ? null : parseInt(el.value, 10);
    });
    return b;
  }

  // ── Paramètres ───────────────────────────────────────────────────────────
  const params = root.querySelector(".params");
  function renderParams() {
    params.querySelectorAll("[data-p]").forEach((el) => {
      const v = S.params[el.dataset.p];
      if (el.type === "checkbox") el.checked = !!v; else el.value = v;
    });
    const p = pointe(parseHhmm(S.params.heureMin) ?? 0);
    params.querySelector("[data-info=peri]").textContent = !S.params.eviterPeri
      ? "En heure de pointe, reporte les arrêts situés dans la rocade toulousaine."
      : p === "matin" ? `⚠️ Départ à ${S.params.heureMin} (pointe du matin) : les arrêts intra-rocade seront repoussés après 09:00.`
        : p === "soir" ? `⚠️ Départ à ${S.params.heureMin} (pointe du soir) : les arrêts intra-rocade seront planifiés avant 16:30.`
          : `ℹ️ Départ à ${S.params.heureMin}, hors heure de pointe : aucun report.`;
    params.querySelector("[data-info=el]").textContent = S.params.etatLieuxParArret
      ? "Une fiche pré-remplie par arrêt dans les exports." : "Une seule fiche généraliste pour toute la tournée.";
  }
  params.addEventListener("change", (e) => {
    const el = e.target;
    const k = el.dataset.p;
    if (!k) return;
    S.params[k] = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value;
    if (["etatLieuxParArret", "fuelConso", "fuelPrice"].includes(k)) { appliquerParamsResultat(); emit("result"); }
    renderParams();
    emit("params");
    refreshChecks();
  });

  // ── Tournées enregistrées ────────────────────────────────────────────────
  const nomInput = $("[data-t=nom]");
  function renderTourneeBar() {
    const T = S.tournee;
    nomInput.placeholder = nomParDefaut();
    if (document.activeElement !== nomInput) nomInput.value = T.nom || "";
    $("[data-act=save]").textContent = T.id ? "💾 Mettre à jour" : "💾 Enregistrer";
    const st = $(".tb-status");
    let html = T.error ? `<span class="err">❌ Enregistrement impossible : ${esc(T.error)}</span> ` : "";
    if (T.id) {
      html += `✏️ Tournée ouverte : <b>${esc(T.nom)}</b> · ☁️ enregistrée le ${esc(fmtDateHeure(T.savedAt))}
        <label class="switch inline"><input type="checkbox" data-t="autosave"${T.autosave ? " checked" : ""}><span>Sauvegarde automatique</span></label>`;
    } else {
      html += `📝 Tournée non enregistrée. Cliquez sur <b>💾 Enregistrer</b> pour la retrouver plus tard${ctx.store.persistent ? " ; elle sera ensuite sauvegardée automatiquement." : " (mode démo : enregistrée dans ce navigateur)."}`;
    }
    st.innerHTML = html;
  }
  nomInput.addEventListener("change", () => {
    if (S.tournee.id) { S.tournee.nom = nomInput.value.trim() || nomParDefaut(); emit("tournee"); }
  });
  root.querySelector(".tournee-bar").addEventListener("change", (e) => {
    if (e.target.dataset.t === "autosave") { S.tournee.autosave = e.target.checked; emit("tournee"); }
  });
  root.querySelector(".tournee-bar").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    if (b.dataset.act === "save") {
      b.disabled = true;
      if (await saveTournee(nomInput.value)) toast("✅ Tournée enregistrée");
      b.disabled = false;
    } else if (b.dataset.act === "new") {
      if (!await confirmer("Nouvelle tournée ?", "Le tableau sera vidé. La tournée enregistrée n'est pas modifiée.", "Nouvelle tournée")) return;
      nouvelleTournee();
      renderTable();
    } else if (b.dataset.act === "list") {
      openTourneesDialog();
    }
  });

  async function openTourneesDialog() {
    const dlg = document.createElement("dialog");
    dlg.className = "dialog dialog-wide";
    dlg.innerHTML = `<div class="row between"><h3>📂 Tournées enregistrées</h3><button class="btn btn-sm" data-x="close" aria-label="Fermer">✕</button></div>
      <p class="small muted"><b>Ouvrir</b> reprend la tournée et y enregistre vos modifications.
      <b>Réutiliser</b> charge ses arrêts dans une nouvelle tournée (l'originale reste intacte).</p>
      <div class="dlg-body"><p class="empty">Chargement…</p></div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener("close", () => dlg.remove());
    dlg.showModal();
    const body = dlg.querySelector(".dlg-body");
    const render = async () => {
      let list;
      try { list = await ctx.store.listTournees(); } catch (err) { body.innerHTML = `<p class="note err">${esc(err.message)}</p>`; return; }
      body.innerHTML = list.length ? `<table class="table"><thead><tr><th>Nom</th><th>Date</th><th>Chauffeur</th><th class="num">Arrêts</th><th>Modifiée</th><th></th></tr></thead><tbody>${
        list.map((t) => `<tr${t.id === S.tournee.id ? ' class="current"' : ""}><td><b>${esc(t.nom)}</b>${t.id === S.tournee.id ? ' <span class="badge">ouverte</span>' : ""}</td>
          <td>${esc(fmtDate(t.tour_date))}</td><td>${esc(t.chauffeur)}</td><td class="num">${t.nb_arrets}</td><td class="small">${esc(fmtDateHeure(t.updated_at))}</td>
          <td class="actions"><button class="btn btn-sm btn-primary" data-x="open" data-id="${esc(t.id)}">✏️ Ouvrir</button>
          <button class="btn btn-sm" data-x="copy" data-id="${esc(t.id)}">📑 Réutiliser</button>
          <button class="btn btn-sm btn-danger-ghost" data-x="del" data-id="${esc(t.id)}" data-nom="${esc(t.nom)}" aria-label="Supprimer">🗑️</button></td></tr>`).join("")}</tbody></table>`
        : `<p class="empty">Aucune tournée enregistrée.</p>`;
    };
    dlg.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-x]");
      if (!b) return;
      const x = b.dataset.x;
      if (x === "close") return dlg.close();
      try {
        if (x === "open" || x === "copy") {
          await loadTournee(b.dataset.id, x === "copy");
          renderTable(); renderParams();
          dlg.close();
          toast(x === "copy" ? "Arrêts chargés dans une nouvelle tournée" : "Tournée ouverte");
        } else if (x === "del") {
          if (!await confirmer(`Supprimer « ${b.dataset.nom} » ?`, "La tournée enregistrée sera supprimée définitivement.", "Supprimer")) return;
          await ctx.store.deleteTournee(b.dataset.id);
          if (b.dataset.id === S.tournee.id) { S.tournee.id = null; S.tournee.savedHash = null; emit("tournee"); }
          render();
        }
      } catch (err) { toast(err.message, "err"); }
    });
    render();
  }

  // ── Optimisation ─────────────────────────────────────────────────────────
  let optimMsgs = [];
  function renderOptimState() {
    const out = $(".optim-out");
    const parts = optimMsgs.map((m) => `<p class="note ${m.kind}">${esc(m.text)}</p>`);
    if (S.result) {
      parts.push(resultatObsolete()
        ? `<p class="note warn">⚠️ La saisie a changé depuis la dernière optimisation : relancez l'optimisation pour mettre la tournée à jour.</p>`
        : `<p class="note ok">✅ Tournée optimisée. <a href="#tournee">Voir la tournée optimisée →</a></p>`);
    }
    out.innerHTML = parts.join("");
  }

  async function runOptim(btn) {
    const valid = stopsValides();
    if (!valid.length) return;
    btn.disabled = true;
    const label = btn.textContent;
    optimMsgs = [];
    const out = $(".optim-out");
    const say = (txt) => { btn.textContent = "⏳ " + txt; };
    try {
      const { result, messages } = await optimiser({
        stops: valid, depotDepartKey: S.params.depotDepart, depotRetourKey: S.params.depotRetour,
        heureMinDepart: parseHhmm(S.params.heureMin) ?? 420, eviterPeri: S.params.eviterPeri,
        pause: S.params.pause, etatLieuxParArret: S.params.etatLieuxParArret,
        fuelConso: S.params.fuelConso, fuelPrice: S.params.fuelPrice,
        besoins: besoinsRecords(valid, S.stock, S.stockManutentions), onStatus: say });
      S.result = result;
      S.manual = null;
      S.resultStopsHash = hashStops();
      optimMsgs = messages;
      S.optimMessages = messages;
      emit("result");
      toast("✅ Tournée optimisée");
      ctx.goto("tournee");
    } catch (err) {
      optimMsgs = [{ kind: "err", text: "❌ " + err.message }];
    } finally {
      btn.textContent = label;
      btn.disabled = !stopsValides().length;
      renderOptimState();
      out.scrollIntoView({ block: "nearest" });
    }
  }

  // ── Abonnements ──────────────────────────────────────────────────────────
  ctx.onClients(() => { rebuildIndex(); refreshChecks(); });
  on("stock", renderStockLive);
  on("result", renderOptimState);
  on("tournee", renderTourneeBar);
  on("params", renderTourneeBar);
  on("bareme", renderBareme);

  rebuildIndex();
  renderParams();
  renderTable();
  renderBareme();
  renderTourneeBar();

  return { show() { refreshChecks(); } };
}
