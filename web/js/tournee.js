// Écran « Tournée » : résultat de l'optimisation, carte, ordre réorganisable,
// feuille de route (PDF / Excel) et mise à jour du stock une fois la tournée faite.

import { icon } from "./icons.js?v=202611162123";
import { ACTION_COLORS, PASTILLE, esc, toast, confirmer, fmtDate, withBusy, confettis } from "./util.js?v=202611162123";
import { PAUSE_DEJEUNER_MIN, fmtMin, fmtDuree, besoinsTournee, projeterStock } from "./metier.js?v=202611162123";
import { S, on, emit, activeResult, resultatObsolete, stopsEffectifs, saveStock } from "./state.js?v=202611162123";
import { recalcLocal, recalcManuel, pauseSlot } from "./optim.js?v=202611162123";
import { loadSortable, loadLeaflet, telecharger, XLSX_MIME, loadPdf, loadExcel } from "./libs.js?v=202611162123";

export function pastilles(couleurs) {
  return String(couleurs || "").split(",").map((c) => c.trim()).filter(Boolean)
    .map((c) => `<span class="mini"><i class="pastille" style="--pc:${PASTILLE[c] || "#ccc"}"></i>${esc(c)}</span>`).join(" ");
}
const km = (v) => `${Math.abs(v).toFixed(1).replace(".", ",")} km`;

export function initTournee(root, ctx) {
  let L = null, map = null, layer = null, markers = [], dirty = true;
  let reorderSeq = 0;
  let prevKpi = null;

  let fitFor = null;
  async function ensureMap(r) {
    const el = root.querySelector("#route-map");
    if (!el) return;
    // La carte existante est réutilisée d'un rendu à l'autre (pas de clignotement).
    if (map && map.getContainer() !== el && !map.getContainer().isConnected) {
      el.replaceWith(map.getContainer());
      map.invalidateSize();
      draw(r, fitFor !== S.result);
      fitFor = S.result;
      return;
    }
    try { L = L || await loadLeaflet(); } catch { el.innerHTML = `<p class="empty">Carte indisponible hors connexion.</p>`; return; }
    if (!root.querySelector("#route-map")) return;
    if (!map || map.getContainer() !== el) {
      map?.remove();
      map = L.map(el, { zoomControl: false }).setView([43.75, 1.68], 9);
      L.control.zoom({ position: "topright" }).addTo(map);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
      layer = L.layerGroup().addTo(map);
    }
    draw(r, true);
    fitFor = S.result;
  }

  const pin = (label, color, cls = "") => L.divIcon({ className: "", iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -14],
    html: `<div class="pin ${cls}" style="--c:${color}"><span>${label}</span></div>` });

  function draw(r, fit) {
    if (!map) return;
    layer.clearLayers();
    markers = [];
    if (r.geometry?.length) {
      L.polyline(r.geometry, { color: "#fff", weight: 9, opacity: .85 }).addTo(layer);
      L.polyline(r.geometry, { color: "#038D29", weight: 5, opacity: r.route_pending ? .45 : .95, dashArray: r.route_pending ? "8 10" : null }).addTo(layer);
    }
    L.marker(r.depot_coords, { icon: pin(icon("depot"), "#002C09", "pin-depot"), zIndexOffset: 1000 })
      .bindPopup(`<b>Dépôt de départ</b><br>${esc(r.depot_depart_addr)}`).addTo(layer);
    const same = r.depot_coords[0] === r.depot_retour_coords[0] && r.depot_coords[1] === r.depot_retour_coords[1];
    if (!same) L.marker(r.depot_retour_coords, { icon: pin(icon("flag"), "#002C09", "pin-depot"), zIndexOffset: 1000 })
      .bindPopup(`<b>Dépôt de retour</b><br>${esc(r.depot_retour_addr)}`).addTo(layer);
    r.stops_ordered.forEach((s, k) => {
      const m = L.marker([s.lat, s.lon], { icon: pin(s.order_num, ACTION_COLORS[s.action] || "#038D29"), riseOnHover: true })
        .bindPopup(`<b>${s.order_num}. ${esc(s.client || s.address)}</b><br>${esc(s.action)} · ${esc(s.quantity)}<br>Arrivée ${fmtMin(s.arrival_min)}`)
        .addTo(layer);
      m.on("mouseover", () => surligner(k, true));
      m.on("mouseout", () => surligner(k, false));
      m.on("click", () => root.querySelector(`.timeline li[data-pos="${k}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
      markers[k] = m;
    });
    if (fit) map.fitBounds(L.latLngBounds([r.depot_coords, r.depot_retour_coords, ...r.stops_ordered.map((s) => [s.lat, s.lon])]), { padding: [40, 40] });
  }

  function surligner(k, onOff) {
    root.querySelector(`.timeline li[data-pos="${k}"] .stop-card`)?.classList.toggle("hl", onOff);
    markers[k]?.getElement()?.classList.toggle("pin-active", onOff);
  }

  function stopCard(s, k, pos) {
    const col = ACTION_COLORS[s.action] || "#038D29";
    const tw = [s.tw_early != null && `après ${fmtMin(s.tw_early)}`, s.tw_late != null && `avant ${fmtMin(s.tw_late)}`].filter(Boolean).join(", ");
    return `<li data-k="${k}" data-pos="${pos}" style="--nc:${col}"><span class="node">${s.order_num}</span>
      <div class="stop-card${s.violated ? " violated" : ""}">
        <span class="handle" aria-hidden="true">${icon("grip")}</span>
        <div class="body">
          <div class="t">${esc(s.client || s.address)} <span class="act-tag">${esc(s.action)}</span></div>
          <div class="line">${icon("pin")}<span>${esc(s.address)}</span></div>
          <div class="line">${icon("stock")}<span>${esc(s.quantity)}</span></div>
          ${s.couleur ? `<div class="line">${pastilles(s.couleur)}</div>` : ""}
          <div class="line">${icon("clock")}<span><span class="time">${fmtMin(s.arrival_min)}</span>${s.violated ? " · hors créneau" : ""}${s.wait_min > 0.5 ? ` · ${Math.round(s.wait_min)} min d'attente` : ""} · ${s.duration_min} min sur place${tw ? ` · ${tw}` : ""}</span></div>
          ${s.observations ? `<div class="line">${icon("note")}<span>${esc(s.observations)}</span></div>` : ""}
        </div>
        <div class="move">
          <button class="btn btn-sm btn-icon" data-move="-1" aria-label="Monter l'arrêt ${s.order_num}">${icon("chevron-up")}</button>
          <button class="btn btn-sm btn-icon" data-move="1" aria-label="Descendre l'arrêt ${s.order_num}">${icon("chevron-down")}</button>
        </div>
      </div></li>`;
  }

  function kpi(id, label, val, sub = "", main = false) {
    const changed = prevKpi && prevKpi[id] !== undefined && prevKpi[id] !== val;
    return `<div class="kpi${main ? " main" : ""}${changed ? " changed" : ""}"><span>${label}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
  }

  function render() {
    const r = activeResult();
    if (!r) {
      root.innerHTML = `<div class="page-head"><div><span class="eyebrow">Étape 2</span><h1>Tournée</h1></div></div>
        <section class="glass empty-stops">${icon("route", "i-hero")}<h2>Pas encore de tournée calculée</h2>
          <p class="muted">Préparez vos arrêts puis lancez l'optimisation.</p>
          <div class="row"><a class="btn btn-primary" href="#saisie">${icon("plus")}<span>Préparer une tournée</span></a></div></section>`;
      map?.remove(); map = null;
      return;
    }
    const ref = S.result;
    const stops = r.stops_ordered;
    const order = S.manual?.manual_order || ref.stops_ordered.map((_, i) => i);
    const viol = stops.filter((s) => s.violated);
    const total = r.return_min - r.depart_min;
    const interv = stops.reduce((n, s) => n + (s.duration_min || 0), 0);
    const ecart = S.manual ? { km: ref.distance_km - r.distance_km } : null;
    const vals = {
      dep: fmtMin(r.depart_min), ret: fmtMin(r.return_min), tot: fmtDuree(total),
      nb: String(stops.length), dist: `${r.distance_km.toFixed(1).replace(".", ",")} km`, traj: fmtDuree(r.duration_min - (r.pause_dejeuner ? PAUSE_DEJEUNER_MIN : 0)),
      fuel: `${r.fuel_liters.toFixed(1).replace(".", ",")} L`, cout: `${r.fuel_cost.toFixed(2).replace(".", ",")} €`,
      gain: ecart ? (Math.abs(ecart.km) < .05 ? "0 km" : `${ecart.km < 0 ? "+" : "−"}${km(ecart.km)}`)
        : ref.km_saved == null ? "—" : ref.km_saved >= 0 ? km(ref.km_saved) : `+${km(ref.km_saved)}`,
    };
    let items = "";
    stops.forEach((s, i) => {
      items += stopCard(s, order[i], i);
      if (r.pause_dejeuner && i === r.pause_idx) {
        const [a, b] = pauseSlot(stops, i);
        items += `<li data-fixed><span class="node pause">${icon("lunch")}</span><div class="stop-card fixed"><div class="body"><div class="t">Pause déjeuner</div>
          <div class="line">${icon("clock")}<span>${a ? `${a} – ${b}` : `${PAUSE_DEJEUNER_MIN} min`}</span></div></div></div></li>`;
      }
    });
    const T = S.tournee;
    root.innerHTML = `
      <div class="page-head">
        <div><span class="eyebrow">Étape 2${S.manual ? " · ordre personnalisé" : ""}</span>
          <h1>Tournée du ${esc(fmtDate(S.params.tourDate))}</h1>
          <p>${S.params.driver ? esc(S.params.driver) + " · " : ""}${stops.length} arrêt${stops.length > 1 ? "s" : ""} · départ ${esc(S.params.depotDepart)}</p></div>
        <div class="head-actions">
          <button class="btn ${T.pdfAt && !resultatObsolete() ? "" : "btn-primary "}btn-lg" data-act="pdf">${icon("printer")}<span>${T.pdfAt && !resultatObsolete() ? "Réimprimer" : "Feuille de route"}</span></button>
          <button class="btn btn-lg" data-act="xlsx">${icon("sheet")}<span>Excel</span></button>
        </div>
      </div>
      ${resultatObsolete() ? `<div class="note warn">${icon("alert")}<div>La saisie a changé depuis ce calcul.<div class="row"><button class="btn btn-sm" data-act="relancer">${icon("refresh")}<span>Recalculer</span></button></div></div></div>` : ""}
      ${r.absents?.length ? `<div class="note warn">${icon("alert")}<div><b>${r.absents.length} arrêt${r.absents.length > 1 ? "s" : ""} hors tournée</b> (adresse introuvable) : ${r.absents.map((a) => esc(a.client || a.adresse)).join(", ")}. <a href="#saisie">Corriger</a></div></div>` : ""}
      ${viol.length ? `<div class="note err">${icon("clock")}<div><b>${viol.length} créneau${viol.length > 1 ? "x" : ""} non tenu${viol.length > 1 ? "s" : ""}</b> : ${viol.map((s) => `arrêt ${s.order_num} (${esc(s.client || s.address)}) à ${fmtMin(s.arrival_min)}, prévu avant ${fmtMin(s.tw_late)}`).join(" · ")}</div></div>` : ""}
      ${r.is_manual && !r.recalc_ok ? `<div class="note warn">${icon("alert")}<div>Trajet non recalculé (service indisponible) : distance et tracé correspondent à l'ordre optimisé.</div></div>` : ""}
      ${T.pdfAt && !resultatObsolete() ? `<div class="done">${icon("check-circle")}<div style="flex:1"><b>Feuille de route prête</b>
        <div class="small">${T.stockAt ? "Stock mis à jour. Bonne tournée !" : "Une fois la tournée faite, mettez le stock à jour en un geste."}</div></div>
        ${T.stockAt ? "" : `<button class="btn btn-primary btn-sm" data-act="stock">${icon("box-check")}<span>Tournée effectuée</span></button>`}</div>` : ""}
      <details class="kpi-details"${kpiOuverts ? " open" : ""}>
        <summary><span class="kpi-sum"><b>${vals.dep} → ${vals.ret}</b> · ${vals.dist.replace(" ", "\u00a0")} · ${vals.cout.replace(" ", "\u00a0")}</span><span class="small muted">Détails</span>${icon("chevron-down", "chev")}</summary>
      <div class="kpi-groups">
        <section class="glass kpi-group"><h2 class="group-title">${icon("clock")}Horaires</h2>
          <div class="kpis">${kpi("dep", "Départ", vals.dep)}${kpi("ret", "Retour", vals.ret, "", true)}${kpi("tot", "Journée", vals.tot, r.pause_dejeuner ? "pause incluse" : "sans pause")}</div></section>
        <section class="glass kpi-group"><h2 class="group-title">${icon("route")}Itinéraire</h2>
          <div class="kpis">${kpi("dist", "Distance", vals.dist, "", true)}${kpi("traj", "Conduite", vals.traj, `${interv} min sur place`)}</div></section>
        <section class="glass kpi-group"><h2 class="group-title">${icon("fuel")}Coût</h2>
          <div class="kpis">${kpi("fuel", "Carburant", vals.fuel)}${kpi("cout", "Coût", vals.cout, "", true)}${kpi("gain", ecart ? "Écart" : (ref.km_saved ?? 0) >= 0 ? "Économisés" : "Détour", vals.gain, ecart ? "vs ordre optimisé" : (ref.km_saved ?? 0) >= 0 ? "vs ordre de saisie" : "pour tenir les créneaux")}</div></section>
      </div></details>
      <div class="route-layout">
        <section class="glass route-map"><div id="route-map" class="map" aria-label="Carte de la tournée"></div></section>
        <section class="glass">
          <div class="card-title">${icon("list")}<span>Ordre des arrêts</span>
            ${S.manual ? `<button class="btn btn-sm btn-ghost push" data-act="reset">${icon("undo")}<span>Ordre optimisé</span></button>` : ""}</div>
          <p class="small muted">Glissez une carte ou utilisez les flèches : les horaires suivent.</p>
          <ol class="timeline">
            <li data-fixed><span class="node depot">${icon("depot")}</span><div class="stop-card fixed"><div class="body"><div class="t">Départ ${fmtMin(r.depart_min)}</div><div class="line">${icon("pin")}<span>${esc(r.depot_depart_addr)}</span></div></div></div></li>
            ${items}
            <li data-fixed><span class="node depot">${icon("flag")}</span><div class="stop-card fixed"><div class="body"><div class="t">Retour ${fmtMin(r.return_min)}</div><div class="line">${icon("pin")}<span>${esc(r.depot_retour_addr)}</span></div></div></div></li>
          </ol>
          <p class="sr-only" role="status" aria-live="polite" data-live></p>
        </section>
      </div>`;
    prevKpi = vals;
    const tl = root.querySelector(".timeline");
    const cle = `${S.resultStopsHash}|${stops.length}`;
    if (tl && cle === derniereCle) tl.classList.add("calm");   // pas de rejeu d'entrée après un réordonnancement
    derniereCle = cle;
    if (movedKey != null) {
      root.querySelector(`.timeline li[data-k="${movedKey}"]`)?.classList.add("moved");
      clearTimeout(movedTimer);
      movedTimer = setTimeout(() => { movedKey = null; }, 1800);   // survit au second rendu (tracé réel)
    }
    root.querySelector(".kpi-details")?.addEventListener("toggle", (e) => { kpiOuverts = e.target.open; });
    ensureMap(r);
    initSortable();
    // Préchargement des bibliothèques d'export pendant la lecture de la tournée
    (window.requestIdleCallback || setTimeout)(() => { loadPdf().catch(() => {}); loadExcel().catch(() => {}); });
  }

  let kpiOuverts = !matchMedia("(max-width: 767px)").matches;
  let derniereCle = null, movedKey = null, movedTimer = 0;

  async function initSortable() {
    const list = root.querySelector(".timeline");
    if (!list) return;
    try {
      const Sortable = await loadSortable();
      Sortable.create(list, { handle: ".handle, .body", draggable: "li[data-k]", animation: 220, easing: "cubic-bezier(.22,1,.36,1)",
        ghostClass: "dragging", chosenClass: "drag-chosen", delay: 120, delayOnTouchOnly: true,
        onEnd: (ev) => { movedKey = ev.item?.dataset.k ?? null; applyOrder([...list.querySelectorAll("li[data-k]")].map((li) => Number(li.dataset.k))); } });
    } catch { /* les flèches restent disponibles */ }
  }

  async function applyOrder(order) {
    const n = S.result.stops_ordered.length;
    if (order.length !== n || [...order].sort((a, b) => a - b).some((v, i) => v !== i)) return render();
    if (order.every((v, i) => v === i)) { S.manual = null; emit("result"); return; }
    const seq = ++reorderSeq;
    S.manual = recalcLocal(S.result, order);          // horaires immédiats
    emit("result");
    const full = await recalcManuel(S.result, order); // tracé et distance réels
    if (seq !== reorderSeq) return;                   // un ordre plus récent a été demandé
    S.manual = full;
    emit("result");
    const live = root.querySelector("[data-live]");
    if (live) live.textContent = `Ordre modifié. Retour à ${fmtMin(full.return_min)}.`;
  }

  async function exporter(kind, btn) {
    const r = activeResult();
    const date = fmtDate(S.params.tourDate).replaceAll("/", "-");
    const suffix = r.is_manual ? "_ordre-perso" : "";
    await withBusy(btn, "Préparation…", async () => {
      try {
        if (kind === "pdf") {
          const { exportTourneePdf } = await import("./pdf.js?v=202611162123");
          telecharger(await exportTourneePdf(r, S.params.tourDate, S.params.driver), `Feuille_de_route_${date}${suffix}.pdf`, "application/pdf");
          S.tournee.pdfAt = new Date().toISOString();
          S.tournee.stockAt = null;
          emit("tournee");
          toast("Feuille de route téléchargée");
        } else {
          const { exportTourneeExcel } = await import("./xlsx.js?v=202611162123");
          telecharger(await exportTourneeExcel(r, S.params.tourDate, S.params.driver), `Tournee_${date}${suffix}.xlsx`, XLSX_MIME);
          toast("Fichier Excel téléchargé");
        }
      } catch (err) {
        console.error(err);
        toast(kind === "pdf" ? "La feuille de route n'a pas pu être créée. Essayez la version Excel." : "Le fichier Excel n'a pas pu être créé.", "err");
      }
    });
  }

  async function appliquerStock(btn) {
    const bes = besoinsTournee(stopsEffectifs(), S.stockManutentions);
    const sorties = bes.reduce((a, b) => a + b.sorties, 0), retours = bes.reduce((a, b) => a + b.retours, 0);
    if (!sorties && !retours) return toast("Cette tournée ne modifie pas le stock.", "info");
    if (!await confirmer("Tournée effectuée ?", `Le stock sera mis à jour : ${sorties} sortie${sorties > 1 ? "s" : ""}, ${retours} retour${retours > 1 ? "s" : ""}.`, "Mettre à jour", false)) return;
    const avant = structuredClone(S.stock);
    await withBusy(btn, "Mise à jour…", () => saveStock(projeterStock(S.stock, bes), null));
    S.tournee.stockAt = new Date().toISOString();
    emit("tournee");
    confettis();
    toast("Stock mis à jour", "ok", { action: { label: "Annuler", run: async () => { await saveStock(avant, "Stock rétabli"); S.tournee.stockAt = null; emit("tournee"); } } });
  }

  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act], [data-move]");
    if (!b) return;
    const act = b.dataset.act;
    if (act === "reset") { S.manual = null; emit("result"); toast("Ordre optimisé rétabli"); }
    else if (act === "pdf" || act === "xlsx") exporter(act, b);
    else if (act === "stock") appliquerStock(b);
    else if (act === "relancer") { ctx.goto("saisie"); setTimeout(() => ctx.optimiser?.(), 350); }
    else if (b.dataset.move) {
      const li = b.closest("li[data-k]");
      const order = [...root.querySelectorAll(".timeline li[data-k]")].map((x) => Number(x.dataset.k));
      const i = order.indexOf(Number(li.dataset.k)), j = i + Number(b.dataset.move);
      if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      const k = li.dataset.k, dir = b.dataset.move;
      movedKey = k;
      applyOrder(order).then(() => root.querySelector(`.timeline li[data-k="${k}"] [data-move="${dir}"]`)?.focus());
    }
  });
  root.addEventListener("mouseover", (e) => { const li = e.target.closest(".timeline li[data-pos]"); if (li) markers[Number(li.dataset.pos)]?.getElement()?.classList.add("pin-active"); });
  root.addEventListener("mouseout", (e) => { const li = e.target.closest(".timeline li[data-pos]"); if (li) markers[Number(li.dataset.pos)]?.getElement()?.classList.remove("pin-active"); });

  const maj = () => { if (!root.hidden) render(); else dirty = true; };
  on("result", maj); on("params", maj); on("tournee", maj);

  return { show() { if (dirty || !root.innerHTML) { dirty = false; render(); } else map?.invalidateSize(); } };
}
