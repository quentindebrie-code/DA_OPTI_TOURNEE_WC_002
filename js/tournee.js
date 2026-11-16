// Onglet « Tournée optimisée » : indicateurs, carte de l'itinéraire, ordre des
// arrêts réorganisable par glisser-déposer (recalcul des horaires et du tracé).
/* global L */

import { ACTION_COLORS, esc, toast } from "./util.js";
import { PAUSE_DEJEUNER_MIN, ACTION_BG, COULEUR_HEX, COULEUR_TEXTE, fmtMin, fmtDuree } from "./metier.js";
import { S, on, emit, activeResult, resultatObsolete } from "./state.js";
import { recalcManuel, pauseSlot } from "./optim.js";
import { loadSortable } from "./libs.js";

const pin = (label, color, cls = "") => L.divIcon({ className: "",
  html: `<div class="pin ${cls}" style="--c:${color}"><span>${esc(label)}</span></div>`,
  iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -28] });

export function pastilles(couleurs) {
  return String(couleurs || "").split(",").map((c) => c.trim()).filter(Boolean).map((c) =>
    `<span class="pill" style="background:${COULEUR_HEX[c] || "#E0E0E0"};color:${COULEUR_TEXTE[c] || "#fff"}">${esc(c)}</span>`).join(" ");
}

export function initTournee(root, ctx) {
  let map = null, layer = null, sortable = null, busy = false, dirty = true;

  function ensureMap() {
    const el = root.querySelector("#route-map");
    if (!el) return;
    if (map && map.getContainer() === el) { map.invalidateSize(); return; }
    map?.remove();
    map = L.map(el).setView([43.75, 1.68], 9);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
    layer = L.layerGroup().addTo(map);
  }

  function drawMap(r) {
    ensureMap();
    if (!map) return;
    layer.clearLayers();
    const pts = [];
    if (r.geometry?.length) {
      L.polyline(r.geometry, { color: "#fff", weight: 8, opacity: 0.8 }).addTo(layer);
      L.polyline(r.geometry, { color: "#1f4e79", weight: 4.5, opacity: 0.9 }).addTo(layer);
      pts.push(...r.geometry);
    }
    const same = r.depot_coords[0] === r.depot_retour_coords[0] && r.depot_coords[1] === r.depot_retour_coords[1];
    L.marker(r.depot_coords, { icon: pin("⌂", "#b45309", "pin-depot"), zIndexOffset: 1000 })
      .bindPopup(`<b>Dépôt – ${same ? "Départ / retour" : "Départ"}</b><br>${esc(r.depot_depart_addr)}`).addTo(layer);
    if (!same) L.marker(r.depot_retour_coords, { icon: pin("R", "#b91c1c", "pin-depot"), zIndexOffset: 1000 })
      .bindPopup(`<b>Dépôt – Retour</b><br>${esc(r.depot_retour_addr)}`).addTo(layer);
    for (const s of r.stops_ordered) {
      L.marker([s.lat, s.lon], { icon: pin(s.order_num, ACTION_COLORS[s.action] || "#555") })
        .bindPopup(`<b>Arrêt ${s.order_num}</b> · ${esc(s.action)}<br>${s.client ? `<b>${esc(s.client)}</b><br>` : ""}
          📦 ${esc(s.quantity)}<br>📍 ${esc(s.address)}<br>🕐 Arrivée ${fmtMin(s.arrival_min)}${s.violated ? " ⚠️" : ""}`)
        .bindTooltip(`${s.order_num}. ${s.action} – ${s.client || s.address}`).addTo(layer);
      pts.push([s.lat, s.lon]);
    }
    pts.push(r.depot_coords);
    map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });
  }

  function stopCard(s, k) {
    const tw = [s.tw_early != null && `⏰ Pas avant ${fmtMin(s.tw_early)}`, s.tw_late != null && `⏰ Pas après ${fmtMin(s.tw_late)}`].filter(Boolean).join(" · ");
    return `<li class="stop-card" data-k="${k}" style="--bg:${ACTION_BG[s.action] || "#f0f0f0"};--bd:${ACTION_COLORS[s.action] || "#999"}">
      <span class="handle" title="Glisser pour réorganiser" aria-hidden="true">⋮⋮</span>
      <div class="sc-body">
        <div><b>#${s.order_num} ${esc(s.action)}</b>${s.client ? " · " + esc(s.client) : ""}</div>
        <div class="small">📍 ${esc(s.address)}</div>
        <div class="small">📦 ${esc(s.quantity)} ${pastilles(s.couleur)}</div>
        ${tw ? `<div class="small muted">${tw}</div>` : ""}
        <div class="small ${s.violated ? "err" : "ok"}"><b>${s.violated ? "⚠️" : "🕐"} Arrivée ${fmtMin(s.arrival_min)}</b>
          ${s.wait_min > 0.5 ? `<span class="muted">(attente ${Math.round(s.wait_min)} min)</span>` : ""}
          <span class="muted">· intervention ${s.duration_min} min → départ ${fmtMin(s.departure_min)}</span></div>
        ${s.observations ? `<div class="small muted">📝 ${esc(s.observations)}</div>` : ""}
      </div>
      <div class="sc-move">
        <button class="btn btn-icon btn-sm" data-move="-1" aria-label="Monter l'arrêt ${s.order_num}">↑</button>
        <button class="btn btn-icon btn-sm" data-move="1" aria-label="Descendre l'arrêt ${s.order_num}">↓</button>
      </div>
    </li>`;
  }

  function render() {
    const r = activeResult();
    if (!r) {
      root.innerHTML = `<div class="card placeholder"><h3>🗺️ Aucune tournée optimisée</h3>
        <p>Saisissez vos arrêts dans l'onglet <a href="#saisie">📋 Saisie</a> puis cliquez sur <b>🚀 Optimiser la tournée</b>.</p></div>`;
      map?.remove(); map = null;
      return;
    }
    const ref = S.result;
    const totalMin = r.return_min - r.depart_min;
    const interv = r.stops_ordered.reduce((n, s) => n + (s.duration_min || 0), 0);
    const trajet = Math.max(0, Math.round(r.duration_min - (r.pause_dejeuner ? PAUSE_DEJEUNER_MIN : 0)));
    // L'ordre manuel courant exprimé en indices de l'ordre optimisé
    const order = S.manual?.manual_order || ref.stops_ordered.map((_, i) => i);
    const stops = r.stops_ordered;
    const pauseIdx = r.pause_idx;
    const items = stops.map((s, i) => stopCard(s, order[i]) + (r.pause_dejeuner && i === pauseIdx
      ? (() => { const [a, b] = pauseSlot(stops, i); return `<li class="stop-card pause-card" data-fixed>🍽️ <b>Pause déjeuner — ${PAUSE_DEJEUNER_MIN} min</b><br><span class="small">Créneau : ${a ? `${a} – ${b}` : `${PAUSE_DEJEUNER_MIN} min`}</span></li>`; })()
      : "")).join("");

    root.innerHTML = `
      <div class="page-head">
        <div><h2>🗺️ Tournée optimisée ${S.manual ? '<span class="badge badge-warn">✏️ Ordre manuel</span>' : ""}</h2>
          <p class="muted">Départ : <b>${esc(S.params.depotDepart)}</b> · Retour : <b>${esc(S.params.depotRetour)}</b></p></div>
        <div class="head-actions"><a class="btn" href="#export">📤 Exporter</a></div>
      </div>
      ${resultatObsolete() ? `<p class="note warn">⚠️ La saisie ou les règles ont changé depuis cette optimisation. <a href="#saisie">Relancez l'optimisation</a> pour mettre la tournée à jour.</p>` : ""}
      ${(S.optimMessages || []).filter((m) => m.kind !== "ok" || !S.manual).map((m) => `<p class="note ${m.kind}">${esc(m.text)}</p>`).join("")}
      ${r.is_manual && !r.recalc_ok ? `<p class="note warn">⚠️ Le service d'itinéraire n'a pas répondu : l'ordre est bien le vôtre, mais la distance et le tracé sont ceux de l'ordre optimisé.</p>` : ""}
      <div class="kpis">
        <div class="kpi"><span>📍 Arrêts</span><b>${stops.length}</b></div>
        <div class="kpi"><span>🛣️ Distance</span><b>${r.distance_km.toFixed(1)} km</b></div>
        <div class="kpi"><span>⏱️ Durée trajet</span><b>${fmtDuree(r.duration_min)}</b></div>
        <div class="kpi"><span>⛽ Carburant</span><b>${r.fuel_liters.toFixed(1)} L</b></div>
        <div class="kpi"><span>💶 Coût</span><b>${r.fuel_cost.toFixed(2)} €</b></div>
        <div class="kpi"><span>⏳ Temps gagné</span><b>${Math.round(ref.time_saved_min)} min</b><small>−${ref.km_saved.toFixed(1)} km</small></div>
        <div class="kpi"><span>🕖 Départ</span><b>${fmtMin(r.depart_min)}</b></div>
        <div class="kpi"><span>🏁 Retour</span><b>${fmtMin(r.return_min)}</b></div>
      </div>
      <p class="note info">🗓️ <b>Durée totale : ${fmtDuree(totalMin)}</b> — dont ${trajet} min de trajet, ${interv} min d'interventions${
        r.pause_dejeuner ? ` et ${PAUSE_DEJEUNER_MIN} min de pause déjeuner 🍽️` : ". ⛔ Aucune pause déjeuner comptée"}.</p>
      ${ref.peri_affectes_nb ? `<p class="note info">🚦 Mode périphérique : <b>${ref.peri_affectes_nb} arrêt(s)</b> intra-rocade repoussé(s) hors des heures de pointe.</p>` : ""}
      <div class="route-layout">
        <div class="card map-wrap route-map-wrap"><div id="route-map" class="map"></div></div>
        <div class="card order-pane">
          <div class="row between"><h3>📋 Ordre des arrêts</h3>
            ${S.manual ? `<button class="btn btn-sm" data-act="reset">↩️ Ordre optimisé</button>` : ""}</div>
          <p class="small muted">↕️ Glissez les cartes (ou utilisez ↑ ↓) pour réorganiser : horaires, distance et tracé sont recalculés.</p>
          <div class="stop-card depot-card"><b>🏭 Dépôt — Départ ${fmtMin(r.depart_min)}</b><br><span class="small">${esc(r.depot_depart_addr)}</span></div>
          <ol class="stop-cards">${items}</ol>
          <div class="stop-card depot-card"><b>🏁 Dépôt — Retour ${fmtMin(r.return_min)}</b><br><span class="small">${esc(r.depot_retour_addr)}</span></div>
          <p class="small muted busy" hidden>🔄 Recalcul de l'itinéraire…</p>
        </div>
      </div>`;
    drawMap(r);
    initSortable();
  }

  async function initSortable() {
    const list = root.querySelector(".stop-cards");
    if (!list) return;
    try {
      const Sortable = await loadSortable();
      sortable = Sortable.create(list, { handle: ".handle, .sc-body", draggable: ".stop-card[data-k]",
        animation: 150, ghostClass: "dragging", onEnd: () => applyOrder(currentOrder()) });
    } catch { /* les boutons ↑ ↓ restent disponibles */ }
  }

  const currentOrder = () => [...root.querySelectorAll(".stop-cards .stop-card[data-k]")].map((li) => Number(li.dataset.k));

  async function applyOrder(order) {
    const n = S.result.stops_ordered.length;
    if (order.length !== n || [...order].sort((a, b) => a - b).some((v, i) => v !== i)) return render();
    const optimal = order.every((v, i) => v === i);
    if (busy) return;
    busy = true;
    root.querySelector(".busy").hidden = false;
    try {
      S.manual = optimal ? null : await recalcManuel(S.result, order);
      emit("result");
    } catch (e) { toast(e.message, "err"); render(); }
    finally { busy = false; }
  }

  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act], [data-move]");
    if (!b) return;
    if (b.dataset.act === "reset") { S.manual = null; emit("result"); return; }
    if (b.dataset.move) {
      const order = currentOrder();
      const k = Number(b.closest("[data-k]").dataset.k);
      const i = order.indexOf(k), j = i + Number(b.dataset.move);
      if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      applyOrder(order);
    }
  });

  on("result", () => { if (!root.hidden) render(); else dirty = true; });
  on("params", () => { if (!root.hidden) render(); else dirty = true; });

  return { show() { if (dirty || !root.querySelector(".kpis, .placeholder")) { dirty = false; render(); } else map?.invalidateSize(); } };
}
