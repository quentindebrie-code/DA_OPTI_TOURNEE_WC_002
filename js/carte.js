// Onglet « Carte » : tournées enregistrées et points de livraison des clients.
/* global L */

import { DEPOTS, DEPOT_DEFAUT, ACTION_COLORS, esc, normTxt, geocode, fmtDate, fmtDateHeure, toast } from "./util.js";

/** Exécute fn sur chaque élément avec au plus `limit` appels simultanés. */
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k], k); } catch { out[k] = null; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const pinIcon = (label, color, extra = "") => L.divIcon({
  className: "",
  html: `<div class="pin ${extra}" style="--c:${color}"><span>${esc(label)}</span></div>`,
  iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -28],
});

export function initCarte(root, ctx) {
  let mode = "tournees";
  let tournees = null;
  let selectedTournee = null;
  let focusClient = null;
  let map = null;
  let layer = null;
  let loadSeq = 0;

  root.innerHTML = `
    <div class="map-layout">
      <aside class="card map-side">
        <div class="seg" role="tablist" aria-label="Contenu de la carte">
          <button role="tab" data-mode="tournees">Tournées</button>
          <button role="tab" data-mode="clients">Points clients</button>
        </div>
        <div class="side-body"></div>
      </aside>
      <div class="card map-wrap">
        <div id="map" class="map" aria-label="Carte"></div>
        <div class="map-status small" hidden></div>
        <div class="legend small">${Object.entries(ACTION_COLORS).map(([a, c]) =>
          `<span><i style="background:${c}"></i>${esc(a)}</span>`).join("")}
          <span><i class="legend-depot"></i>Dépôt</span></div>
      </div>
    </div>`;

  const side = root.querySelector(".side-body");
  const status = root.querySelector(".map-status");

  function setStatus(msg) { status.hidden = !msg; status.textContent = msg || ""; }

  function ensureMap() {
    if (map) { map.invalidateSize(); return; }
    map = L.map(root.querySelector("#map"), { zoomControl: true }).setView([43.75, 1.68], 9);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
  }

  function fit(latlngs) {
    if (latlngs.length === 1) map.setView(latlngs[0], 13);
    else if (latlngs.length) map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] });
  }

  function setMode(m) {
    mode = m;
    root.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === m)));
    if (m === "tournees") renderTournees(); else renderClients();
  }
  root.querySelector(".seg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode]");
    if (b) { focusClient = null; setMode(b.dataset.mode); }
  });

  // ── Tournées ────────────────────────────────────────────────────────────────
  async function renderTournees(force = false) {
    if (!tournees || force) {
      side.innerHTML = `<p class="empty">Chargement des tournées…</p>`;
      try { tournees = await ctx.store.listTournees(); } catch (e) { toast(e.message, "err"); tournees = []; }
      if (mode !== "tournees") return;
    }
    side.innerHTML = `
      <div class="row between"><b>${tournees.length} tournée${tournees.length > 1 ? "s" : ""} enregistrée${tournees.length > 1 ? "s" : ""}</b>
        <button class="btn btn-sm" data-act="reload" title="Recharger la liste">🔄</button></div>
      <div class="tour-list">${tournees.map((t) => `
        <button class="client-item${t.id === selectedTournee ? " active" : ""}" data-tid="${esc(t.id)}">
          <b>${esc(t.nom)}</b>
          <span>${esc(fmtDate(t.tour_date))}${t.chauffeur ? " · " + esc(t.chauffeur) : ""} · ${t.nb_arrets} arrêt${t.nb_arrets > 1 ? "s" : ""}</span>
          <span class="muted small">Modifiée le ${esc(fmtDateHeure(t.updated_at))}</span>
        </button>`).join("") || `<p class="empty">Aucune tournée enregistrée.</p>`}</div>
      <div class="stops"></div>`;
    if (selectedTournee) showTournee(selectedTournee);
    else { layer.clearLayers(); setStatus(""); }
  }

  side.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tid]");
    if (t) {
      selectedTournee = t.dataset.tid;
      side.querySelectorAll("[data-tid]").forEach((b) => b.classList.toggle("active", b === t));
      showTournee(selectedTournee);
    }
    if (e.target.closest("[data-act=reload]")) renderTournees(true);
    const s = e.target.closest("[data-stop]");
    if (s && s._marker) { map.setView(s._marker.getLatLng(), Math.max(map.getZoom(), 13)); s._marker.openPopup(); }
    const c = e.target.closest("[data-open-client]");
    if (c) ctx.goto("clients", { clientId: c.dataset.openClient });
  });

  async function showTournee(id) {
    const seq = ++loadSeq;
    layer.clearLayers();
    setStatus("Chargement de la tournée…");
    const stopsBox = side.querySelector(".stops");
    let t;
    try { t = await ctx.store.getTournee(id); } catch (e) { toast(e.message, "err"); return; }
    if (seq !== loadSeq || !t) return;
    const meta = t.meta || {};
    const depKey = DEPOTS[meta.depot_depart_key] ? meta.depot_depart_key : DEPOT_DEFAUT;
    const retKey = DEPOTS[meta.depot_retour_key] ? meta.depot_retour_key : depKey;
    const stops = (t.stops || []).filter((s) => String(s["Adresse"] || "").trim());

    setStatus(`Géocodage de ${stops.length} adresse${stops.length > 1 ? "s" : ""}…`);
    const depotKeys = [...new Set([depKey, retKey])];
    const [depotGeo, stopGeo] = await Promise.all([
      pool(depotKeys, 2, (k) => geocode(DEPOTS[k])),
      pool(stops, 6, (s) => geocode(s["Adresse"])),
    ]);
    if (seq !== loadSeq) return;

    const pts = [];
    depotKeys.forEach((k, i) => {
      const g = depotGeo[i];
      if (!g) return;
      const role = k === depKey && k === retKey ? "Départ / retour" : k === depKey ? "Départ" : "Retour";
      L.marker([g.lat, g.lon], { icon: pinIcon("⌂", "#b45309", "pin-depot"), zIndexOffset: 1000 })
        .bindPopup(`<b>Dépôt – ${esc(role)}</b><br>${esc(DEPOTS[k])}`)
        .bindTooltip(`Dépôt – ${role}`).addTo(layer);
      pts.push([g.lat, g.lon]);
    });

    let introuvables = 0;
    const markers = stops.map((s, i) => {
      const g = stopGeo[i];
      if (!g) { introuvables++; return null; }
      const action = s["Action"] || "";
      const color = ACTION_COLORS[action] || "#555";
      const m = L.marker([g.lat, g.lon], { icon: pinIcon(i + 1, color) })
        .bindPopup(`<b>Arrêt ${i + 1}</b> · ${esc(action)}<br>
          ${s["Nom du client"] ? `<b>${esc(s["Nom du client"])}</b><br>` : ""}
          ${esc(s["Produit"])}${s["Option"] ? " + " + esc(s["Option"]) : ""} × ${esc(s["Quantité"])}<br>
          ${esc(s["Adresse"])}
          ${s["Pas avant"] || s["Pas après"] ? `<br>⏰ ${esc(s["Pas avant"] || "…")} – ${esc(s["Pas après"] || "…")}` : ""}
          ${s["Observations"] ? `<br>📝 ${esc(s["Observations"])}` : ""}`)
        .bindTooltip(`${i + 1}. ${action} – ${s["Nom du client"] || s["Adresse"]}`)
        .addTo(layer);
      pts.push([g.lat, g.lon]);
      return m;
    });
    fit(pts);
    setStatus(introuvables ? `⚠️ ${introuvables} adresse${introuvables > 1 ? "s" : ""} introuvable${introuvables > 1 ? "s" : ""}` : "");

    stopsBox.innerHTML = `
      <h4>${esc(t.nom)}</h4>
      <p class="muted small">Arrêts dans l'ordre de saisie. L'itinéraire optimisé arrivera avec l'onglet
        <i>Saisie &amp; optimisation</i>.</p>
      <ol class="stop-list">${stops.map((s, i) => `
        <li><button class="stop" data-stop="${i}"${markers[i] ? "" : " disabled"}>
          <i class="dot" style="background:${ACTION_COLORS[s["Action"]] || "#555"}"></i>
          <span><b>${esc(s["Action"])}</b> · ${esc(s["Nom du client"] || "—")}<br>
          <span class="muted small">${esc(s["Adresse"])}${markers[i] ? "" : " — ⚠️ introuvable"}</span></span>
        </button></li>`).join("")}</ol>`;
    stopsBox.querySelectorAll("[data-stop]").forEach((b) => { b._marker = markers[Number(b.dataset.stop)]; });
  }

  // ── Points clients ──────────────────────────────────────────────────────────
  async function renderClients() {
    const seq = ++loadSeq;
    layer.clearLayers();
    const clients = focusClient ? ctx.clients.filter((c) => c.id === focusClient) : ctx.clients;
    const items = clients.flatMap((c) => (c.points || []).map((p) => ({ c, p })));
    side.innerHTML = `
      ${focusClient && clients[0] ? `<div class="row between"><b>${esc(clients[0].nom)}</b>
        <button class="btn btn-sm" data-act="all">Tous les clients</button></div>` : ""}
      <input type="search" class="search" placeholder="🔎 Filtrer les points…" aria-label="Filtrer les points">
      <ol class="stop-list">${items.map(({ c, p }, i) => `
        <li data-q="${esc(normTxt(`${c.nom} ${p.libelle} ${p.adresse}`))}"><button class="stop" data-stop="${i}">
          <i class="dot" style="background:#1f6aa5"></i>
          <span><b>${esc(c.nom)}</b>${p.libelle ? " · " + esc(p.libelle) : ""}<br>
          <span class="muted small">${esc(p.adresse)}</span></span></button></li>`).join("")
        || `<p class="empty">Aucun point de livraison.</p>`}</ol>`;
    side.querySelector("[data-act=all]")?.addEventListener("click", () => { focusClient = null; renderClients(); });
    side.querySelector(".search").addEventListener("input", (e) => {
      const q = normTxt(e.target.value);
      side.querySelectorAll("[data-q]").forEach((li) => { li.hidden = q && !li.dataset.q.includes(q); });
    });

    setStatus(items.length ? `Géocodage de ${items.length} point${items.length > 1 ? "s" : ""}…` : "");
    const geo = await pool(items, 6, ({ p }) => geocode(p.adresse));
    if (seq !== loadSeq) return;
    const pts = [];
    let introuvables = 0;
    const buttons = side.querySelectorAll("[data-stop]");
    items.forEach(({ c, p }, i) => {
      const g = geo[i];
      if (!g) { introuvables++; buttons[i].disabled = true; return; }
      const m = L.marker([g.lat, g.lon], { icon: pinIcon("", "#1f6aa5", "pin-small") })
        .bindPopup(`<b>${esc(c.nom)}</b>${p.libelle ? "<br>" + esc(p.libelle) : ""}<br>${esc(p.adresse)}
          ${p.observations ? `<br>📝 ${esc(p.observations)}` : ""}
          <br><button class="btn btn-sm popup-btn" data-open-client="${esc(c.id)}">Ouvrir la fiche</button>`)
        .bindTooltip(c.nom).addTo(layer);
      buttons[i]._marker = m;
      pts.push([g.lat, g.lon]);
    });
    fit(pts);
    setStatus(introuvables ? `⚠️ ${introuvables} adresse${introuvables > 1 ? "s" : ""} introuvable${introuvables > 1 ? "s" : ""}` : "");
  }

  // Bouton « Ouvrir la fiche » dans les popups (hors du panneau latéral).
  root.querySelector("#map").addEventListener("click", (e) => {
    const c = e.target.closest("[data-open-client]");
    if (c) ctx.goto("clients", { clientId: c.dataset.openClient });
  });

  ctx.onClients(() => { if (map && mode === "clients" && !root.hidden) renderClients(); });

  return {
    show(arg) {
      ensureMap();
      if (arg?.clientId) { focusClient = arg.clientId; setMode("clients"); }
      else if (!side.innerHTML) setMode("tournees");
      else map.invalidateSize();
    },
  };
}
