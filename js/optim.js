// Optimisation de tournée : géocodage, matrice OSRM, plus proche voisin + 2-opt
// avec fenêtres horaires, heure de départ optimale, pause déjeuner, mode
// périphérique toulousain, réordonnancement manuel. Porté de tournees.py.

import { geocode, DEPOTS } from "./util.js?v=202611162108";
import { PAUSE_DEJEUNER_MIN, parseHhmm, qtyLabel, articleKey, fmtMin } from "./metier.js?v=202611162108";
import { couleursTexte } from "./util.js?v=202611162108";

const OSRM_URL = "https://router.project-osrm.org";
const INF = 1e9;

let currentSignal = null;
async function osrm(path) {
  let r, last;
  for (let essai = 0; essai < 2; essai++) {
    try {
      const sig = currentSignal && AbortSignal.any ? AbortSignal.any([currentSignal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
      r = await fetch(`${OSRM_URL}${path}`, { signal: sig });
      const data = await r.json().catch(() => ({}));
      if (data.code === "Ok") return data;
      last = new Error("Le calcul d'itinéraire a échoué pour ces adresses.");
    } catch (e) {
      if (currentSignal?.aborted) { const a = new Error("Calcul annulé."); a.name = "AbortError"; throw a; }
      last = new Error("Le service de calcul d'itinéraire ne répond pas. Vos arrêts sont conservés, réessayez dans un instant.");
    }
  }
  throw last;
}
const coordStr = (pts) => pts.map(([lat, lon]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join(";");

async function osrmTable(pts) {
  const d = await osrm(`/table/v1/driving/${coordStr(pts)}?annotations=duration`);
  return d.durations.map((row) => row.map((v) => (v == null ? INF : v)));
}

export async function osrmRoute(pts, full = true) {
  const d = await osrm(`/route/v1/driving/${coordStr(pts)}?overview=${full ? "full" : "false"}&geometries=geojson`);
  const route = d.routes[0];
  return { distance_km: route.distance / 1000, duration_min: route.duration / 60,
    geometry: full ? route.geometry.coordinates.map(([lon, lat]) => [lat, lon]) : null };
}

// ── Calculs horaires ───────────────────────────────────────────────────────
// order : indices de matrice des arrêts (1..n) ; 0 = dépôt de départ ; R = dépôt de retour.
export function computeArrivals(order, M, departMin, tw, pauseAfterIdx = null) {
  const res = [];
  let t = departMin, cur = 0;
  order.forEach((nxt, k) => {
    let arrival = t + M[cur][nxt] / 60;
    const { earliest, latest, duration } = tw[nxt];
    let wait = 0;
    if (earliest != null && arrival < earliest) { wait = earliest - arrival; arrival = earliest; }
    const violated = latest != null && arrival > latest;
    const departure = arrival + (duration || 0);
    res.push({ arrival_min: arrival, wait_min: wait, departure_min: departure,
      tw_early: earliest, tw_late: latest, violated, duration_min: duration || 0 });
    t = departure;
    if (pauseAfterIdx != null && k === pauseAfterIdx) t += PAUSE_DEJEUNER_MIN;
    cur = nxt;
  });
  return res;
}

function costTw(order, M, R, departMin, tw, pause = false) {
  if (!order.length) return 0;
  let arr = computeArrivals(order, M, departMin, tw);
  // La pause déjeuner décale les arrêts suivants : on l'intègre au coût pour que
  // l'ordre retenu respecte les fenêtres une fois la pause insérée.
  if (pause) arr = computeArrivals(order, M, departMin, tw, findPausePosition(arr));
  const back = M[order[order.length - 1]][R] / 60;
  let total = arr[arr.length - 1].departure_min + back - departMin;
  for (const a of arr) if (a.violated) total += (a.arrival_min - a.tw_late) * 1e6;
  return total;
}

function costDist(order, M, R) {
  let c = 0, cur = 0;
  for (const i of order) { c += M[cur][i]; cur = i; }
  return c + M[cur][R];
}

function nearestNeighbour(n, M) {
  const unvisited = new Set(Array.from({ length: n }, (_, i) => i + 1));
  const tour = [];
  let cur = 0;
  while (unvisited.size) {
    let best = null;
    for (const j of unvisited) if (best == null || M[cur][j] < M[cur][best]) best = j;
    tour.push(best); unvisited.delete(best); cur = best;
  }
  return tour;
}

/**
 * Recherche locale : inversions de segments (2-opt, comme la version Streamlit)
 * puis déplacement d'un arrêt à une autre position (relocate). Le second
 * mouvement débloque les cas où une fenêtre horaire impose de visiter un
 * arrêt tôt, que le 2-opt seul ne trouve pas.
 */
function twoOpt(order, cost) {
  let best = order.slice(), bestCost = cost(best), improved = true;
  const tryCand = (cand) => {
    const c = cost(cand);
    if (c < bestCost - 1e-9) { best = cand; bestCost = c; improved = true; return true; }
    return false;
  };
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        tryCand(best.slice(0, i).concat(best.slice(i, j + 1).reverse(), best.slice(j + 1)));
      }
    }
    for (let i = 0; i < best.length; i++) {
      for (let j = 0; j < best.length; j++) {
        if (i === j) continue;
        const cand = best.slice();
        const [x] = cand.splice(i, 1);
        cand.splice(j, 0, x);
        tryCand(cand);
      }
    }
  }
  return best;
}

/** Départ le plus tardif respectant toutes les fenêtres (ou null sans contrainte). */
function optimalDeparture(order, M, tw) {
  let cumul = 0, cur = 0;
  const cand = [];
  for (const i of order) {
    cumul += M[cur][i] / 60;
    if (tw[i].latest != null) cand.push(tw[i].latest - cumul);
    if (tw[i].earliest != null) cand.push(tw[i].earliest - cumul);
    cumul += tw[i].duration || 0;
    cur = i;
  }
  return cand.length ? Math.max(0, Math.floor(Math.min(...cand))) : null;
}

/** Indice (0-based) de l'arrêt après lequel placer la pause : premier départ ≥ 12:00. */
export function findPausePosition(stops) {
  const i = stops.findIndex((s) => s.departure_min != null && s.departure_min >= 720);
  return i >= 0 ? i : Math.floor(stops.length / 2);
}

export function pauseSlot(stops, idx) {
  const s = stops[idx];
  const start = s ? (s.departure_min ?? s.arrival_min) : null;
  return start == null ? ["", ""] : [fmtMin(start), fmtMin(start + PAUSE_DEJEUNER_MIN)];
}

// ── Périphérique toulousain ────────────────────────────────────────────────
const TOULOUSE = [43.6047, 1.4442];
function haversineKm([la1, lo1], [la2, lo2]) {
  const r = Math.PI / 180, dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}
export const POINTE = { matin: [420, 540], soir: [1020, 1140] };
export function pointe(departMin) {
  if (departMin >= POINTE.matin[0] && departMin <= POINTE.matin[1]) return "matin";
  if (departMin >= POINTE.soir[0] && departMin <= POINTE.soir[1]) return "soir";
  return null;
}
function injectePeri(tw, coords, departMin) {
  const p = pointe(departMin);
  if (!p) return [tw, 0];
  let n = 0;
  const out = tw.map((w, k) => {
    if (k === 0 || !coords[k] || haversineKm(coords[k], TOULOUSE) >= 10) return w;
    const x = { ...w };
    let modif = false;
    if (p === "matin" && (x.earliest == null || x.earliest < 540)) { x.earliest = 540; modif = true; }
    if (p === "soir" && (x.latest == null || x.latest > 990)) { x.latest = 990; modif = true; }
    if (modif) n++;
    return x;
  });
  return [out, n];
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k], k); } catch { out[k] = null; }
    }
  }));
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
/**
 * Optimise la tournée.
 * @param p { stops, depotDepartKey, depotRetourKey, heureMinDepart (min), eviterPeri,
 *            pause, etatLieuxParArret, fuelConso, fuelPrice, besoins, onStatus }
 * @returns { result, messages: [{kind, text}] }
 */
export async function optimiser(p) {
  currentSignal = p.signal || null;
  try { return await optimiserInterne(p); } finally { currentSignal = null; }
}

async function optimiserInterne(p) {
  const say = p.onStatus || (() => {});
  const messages = [];
  const depotDepartAddr = DEPOTS[p.depotDepartKey];
  const depotRetourAddr = DEPOTS[p.depotRetourKey] || depotDepartAddr;

  say("Localisation des dépôts", 3);
  const gDep = await geocode(depotDepartAddr, p.signal);
  if (!gDep) throw new Error(`Impossible de géocoder le dépôt de départ : ${depotDepartAddr}`);
  let gRet = depotRetourAddr === depotDepartAddr ? gDep : await geocode(depotRetourAddr).catch(() => null);
  if (!gRet) { messages.push({ kind: "warn", text: "Dépôt de retour introuvable : le dépôt de départ est utilisé." }); gRet = gDep; }

  let done = 0;
  const geos = await pool(p.stops, 6, async (s) => {
    const g = await geocode(s["Adresse"], p.signal);
    done++;
    say(`Localisation des adresses ${done}/${p.stops.length}`, 5 + Math.round((done / p.stops.length) * 50));
    return g;
  });
  if (p.signal?.aborted) { const a = new Error("Calcul annulé."); a.name = "AbortError"; throw a; }
  const failedIdx = p.stops.map((_, i) => i).filter((i) => !geos[i]);
  if (failedIdx.length && !p.ignorerIntrouvables) {
    const e = new Error("Adresses introuvables");
    e.code = "INTROUVABLES";
    e.lignes = failedIdx.map((i) => ({ ligne: p.stops[i]._ligne, adresse: p.stops[i]["Adresse"], client: p.stops[i]["Nom du client"] }));
    throw e;
  }
  const absents = failedIdx.map((i) => ({ ligne: p.stops[i]._ligne, adresse: p.stops[i]["Adresse"], client: p.stops[i]["Nom du client"] }));
  const ok = p.stops.map((s, i) => ({ s, g: geos[i] })).filter((x) => x.g);
  if (!ok.length) throw new Error("Aucune adresse valide après géocodage.");

  const n = ok.length, R = n + 1;
  const coords = [[gDep.lat, gDep.lon], ...ok.map((x) => [x.g.lat, x.g.lon]), [gRet.lat, gRet.lon]];
  let tw = [{ earliest: null, latest: null, duration: 0 },
    ...ok.map(({ s }) => ({ earliest: parseHhmm(s["Pas avant"]), latest: parseHhmm(s["Pas après"]),
      duration: Math.max(0, parseInt(s["Durée (min)"], 10) || 30) })),
    { earliest: null, latest: null, duration: 0 }];
  const legalMin = p.heureMinDepart;
  let periNb = 0;
  if (p.eviterPeri) [tw, periNb] = injectePeri(tw, coords, legalMin);

  say("Calcul des temps de trajet", 62);
  const M = await osrmTable(coords);

  say("Recherche du meilleur ordre", 75);
  let order = twoOpt(nearestNeighbour(n, M), (o) => costDist(o, M, R));

  let departMin;
  const raw = optimalDeparture(order, M, tw);
  if (raw == null) {
    departMin = legalMin;
    messages.push({ kind: "info", text: `Départ à ${fmtMin(departMin)}, aucun créneau client à respecter.` });
  } else if (raw < legalMin) {
    departMin = legalMin;
    messages.push({ kind: "warn", early: raw, text: "" });
  } else {
    departMin = raw;
    messages.push({ kind: "ok", text: `Départ conseillé à ${fmtMin(departMin)} pour tenir tous les créneaux sans attente inutile.` });
  }

  const hasTw = tw.slice(1, R).some((w) => w.earliest != null || w.latest != null);
  if (hasTw) {
    const c = (o) => costTw(o, M, R, departMin, tw, p.pause);
    const a = twoOpt(nearestNeighbour(n, M), c), b = twoOpt(order, c);
    order = c(a) <= c(b) ? a : b;
  }

  const prelim = computeArrivals(order, M, departMin, tw);
  const pauseIdx = findPausePosition(prelim);
  const arrivals = computeArrivals(order, M, departMin, tw, p.pause ? pauseIdx : null);

  const stopsOrdered = order.map((mi, k) => {
    const { s, g } = ok[mi - 1];
    const a = arrivals[k];
    return {
      order_num: k + 1, mi, action: s["Action"], quantity: qtyLabel(s),
      produit: s["Produit"] || "", option: s["Option"] || "", couleur: couleursTexte(s["Couleur"]),
      article: articleKey(s["Produit"], s["Option"]), qty_num: parseInt(s["Quantité"], 10) || 1,
      client: s["Nom du client"] || "", address: s["Adresse"], lat: g.lat, lon: g.lon,
      tw_early: tw[mi].earliest, tw_late: tw[mi].latest, duration_min: tw[mi].duration,
      arrival_min: a.arrival_min, departure_min: a.departure_min, wait_min: a.wait_min,
      violated: a.violated, observations: s["Observations"] || "",
    };
  });

  say("Tracé de l'itinéraire", 90);
  const [route, orig] = await Promise.all([
    osrmRoute([coords[0], ...order.map((i) => coords[i]), coords[R]]),
    osrmRoute(coords, false).catch(() => null),
  ]);
  say("Terminé", 100);

  const violes = stopsOrdered.filter((s) => s.violated);
  const early = messages.find((m) => m.early != null);
  if (early) {
    Object.assign(early, violes.length
      ? { text: `Il faudrait partir à ${fmtMin(early.early)} pour tenir tous les créneaux. Départ maintenu à ${fmtMin(departMin)}.` }
      : { kind: "ok", text: `Départ à ${fmtMin(departMin)} : tous les créneaux sont respectés.` });
    delete early.early;
  }
  if (violes.length) {
    messages.push({ kind: "warn", text: `${violes.length} créneau${violes.length > 1 ? "x" : ""} non tenu${violes.length > 1 ? "s" : ""}.` });
  }

  const durMin = route.duration_min + (p.pause ? PAUSE_DEJEUNER_MIN : 0);
  const last = stopsOrdered[stopsOrdered.length - 1];
  let returnMin = last.departure_min + M[last.mi][R] / 60;
  if (p.pause && pauseIdx >= stopsOrdered.length - 1) returnMin += PAUSE_DEJEUNER_MIN;
  const fuelL = route.distance_km * p.fuelConso / 100;

  const result = {
    stops_ordered: stopsOrdered,
    distance_km: route.distance_km,
    duration_min: durMin,
    fuel_liters: fuelL,
    fuel_cost: fuelL * p.fuelPrice,
    // Gain par rapport à l'ordre de saisie (signé : négatif si les créneaux imposent un détour)
    km_saved: orig ? orig.distance_km - route.distance_km : null,
    time_saved_min: orig ? orig.duration_min - route.duration_min : null,
    absents,
    geometry: route.geometry,
    depot_coords: coords[0], depot_retour_coords: coords[R],
    depot_depart_addr: depotDepartAddr, depot_retour_addr: depotRetourAddr,
    depart_min: departMin, return_min: returnMin,
    pause_dejeuner: !!p.pause, pause_idx: pauseIdx,
    etat_lieux_par_arret: !!p.etatLieuxParArret,
    peri_affectes_nb: periNb,
    matrix: M, retour_idx: R,
    fuel_conso: p.fuelConso, fuel_price: p.fuelPrice,
    besoins_records: p.besoins || [],
    is_manual: false, recalc_ok: true,
  };
  return { result, messages };
}

/** Horaires recalculés localement (instantané) pour un ordre manuel ; tracé et distance inchangés. */
export function recalcLocal(result, newOrder) {
  const base = result.stops_ordered;
  const M = result.matrix, R = result.retour_idx;
  const tw = [];
  for (const s of base) tw[s.mi] = { earliest: s.tw_early, latest: s.tw_late, duration: s.duration_min };
  const order = newOrder.map((k) => base[k].mi);
  const prelim = computeArrivals(order, M, result.depart_min, tw);
  const pauseIdx = findPausePosition(prelim);
  const arrivals = computeArrivals(order, M, result.depart_min, tw, result.pause_dejeuner ? pauseIdx : null);
  const stops = newOrder.map((k, rank) => ({ ...base[k], order_num: rank + 1, ...pickArr(arrivals[rank]) }));
  const last = stops[stops.length - 1];
  let returnMin = last.departure_min + M[last.mi][R] / 60;
  if (result.pause_dejeuner && pauseIdx >= stops.length - 1) returnMin += PAUSE_DEJEUNER_MIN;
  return { ...result, stops_ordered: stops, return_min: returnMin, pause_idx: pauseIdx, is_manual: true,
    manual_order: [...newOrder], route_pending: true, recalc_ok: true };
}

/** Ordre manuel complet : horaires + tracé, distance et carburant réels. */
export async function recalcManuel(result, newOrder) {
  const local = recalcLocal(result, newOrder);
  let { geometry, distance_km, duration_min } = result;
  let recalcOk = true;
  try {
    const route = await osrmRoute([result.depot_coords, ...local.stops_ordered.map((s) => [s.lat, s.lon]), result.depot_retour_coords]);
    geometry = route.geometry;
    distance_km = route.distance_km;
    duration_min = route.duration_min + (result.pause_dejeuner ? PAUSE_DEJEUNER_MIN : 0);
  } catch { recalcOk = false; }
  const fuelL = distance_km * result.fuel_conso / 100;
  return { ...local, geometry, distance_km, duration_min, fuel_liters: fuelL, fuel_cost: fuelL * result.fuel_price,
    route_pending: false, recalc_ok: recalcOk };
}

const pickArr = (a) => ({ arrival_min: a.arrival_min, departure_min: a.departure_min,
  wait_min: a.wait_min, violated: a.violated });
