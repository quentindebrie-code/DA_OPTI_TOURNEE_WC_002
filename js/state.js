// État de travail partagé entre les onglets (tournée en cours, paramètres,
// résultat d'optimisation, barème, stock), avec brouillon local et
// sauvegarde automatique de la tournée ouverte dans Supabase.

import { DEPOT_DEFAUT, toast } from "./util.js";
import { baremeDefaut, normaliserBareme, BAREME_SETTING_KEY, nouvelArret, normaliserArret,
  autoDuree, cleanStock, stockDefaut, STOPS_COLUMNS } from "./metier.js";

const DRAFT_KEY = "brouillon-tournee-v1";
const today = () => new Date().toLocaleDateString("sv-SE"); // AAAA-MM-JJ local

export const S = {
  store: null,
  stops: [],
  params: {
    tourDate: today(), driver: "", heureMin: "07:00",
    depotDepart: DEPOT_DEFAUT, depotRetour: DEPOT_DEFAUT,
    eviterPeri: false, pause: true, etatLieuxParArret: true,
    fuelConso: 12.2, fuelPrice: 1.85,
  },
  result: null,         // résultat de l'optimisation (ordre optimisé)
  manual: null,         // résultat recalculé pour un ordre manuel
  resultStopsHash: null,
  optimMessages: [],
  tournee: { id: null, nom: "", savedHash: null, savedAt: null, autosave: true, error: null },
  bareme: baremeDefaut(),
  baremeError: null,
  stock: [],
  stockMaj: null,
  stockError: null,
  stockManutentions: false,
  seuilAlerte: 1,
};

// ── Événements ───────────────────────────────────────────────────────────────
const listeners = {};
export function on(evt, fn) { (listeners[evt] ||= new Set()).add(fn); }
export function emit(evt) {
  (listeners[evt] || []).forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  if (["stops", "params", "result", "tournee"].includes(evt)) saveDraft();
  if (["stops", "params", "tournee"].includes(evt)) scheduleAutosave();
}

export const activeResult = () => S.manual || S.result;

// ── Brouillon local (survit au rechargement de la page) ─────────────────────
let draftTimer = null;
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ stops: S.stops, params: S.params,
        result: S.result, manual: S.manual, resultStopsHash: S.resultStopsHash, optimMessages: S.optimMessages,
        tournee: { ...S.tournee, error: null }, stockManutentions: S.stockManutentions,
        seuilAlerte: S.seuilAlerte }));
    } catch { /* quota / navigation privée */ }
  }, 300);
}

function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    if (!d) return false;
    S.stops = (d.stops || []).map(normaliserArret);
    Object.assign(S.params, d.params || {});
    S.result = d.result || null;
    S.manual = d.manual || null;
    S.resultStopsHash = d.resultStopsHash || null;
    S.optimMessages = d.optimMessages || [];
    Object.assign(S.tournee, d.tournee || {});
    S.stockManutentions = !!d.stockManutentions;
    S.seuilAlerte = d.seuilAlerte ?? 1;
    return true;
  } catch { return false; }
}

// ── Arrêts ───────────────────────────────────────────────────────────────────
export function stopsVides() {
  return [1, 2, 3].map(() => nouvelArret(S.bareme));
}

/** Lignes significatives, prêtes à enregistrer (sans la colonne technique Suppr). */
export function stopsRecords(stops = S.stops) {
  return stops
    .filter((s) => String(s["Adresse"]).trim() || String(s["Client"]).trim() || String(s["Nom du client"]).trim())
    .map(({ Suppr, ...rest }) => rest);
}

export const stopsValides = () => S.stops.filter((s) => String(s["Adresse"] || "").trim());

export function dureeAuto(s) {
  const d = autoDuree(S.bareme, s["Action"], s["Produit"], s["Quantité"]);
  if (d != null) s["Durée (min)"] = d;
}

/** Empreinte de tout ce qui influence l'optimisation (saisie + règles de calcul). */
export function hashStops() {
  const p = S.params;
  return JSON.stringify([stopsValides().map((s) => STOPS_COLUMNS.map((c) => s[c])),
    p.depotDepart, p.depotRetour, p.heureMin, p.eviterPeri, p.pause]);
}

/** Paramètres sans effet sur l'ordre : appliqués directement au résultat existant. */
export function appliquerParamsResultat() {
  for (const r of [S.result, S.manual]) {
    if (!r) continue;
    r.etat_lieux_par_arret = S.params.etatLieuxParArret;
    r.fuel_conso = S.params.fuelConso;
    r.fuel_price = S.params.fuelPrice;
    r.fuel_liters = r.distance_km * r.fuel_conso / 100;
    r.fuel_cost = r.fuel_liters * r.fuel_price;
  }
}

/** Le résultat affiché ne correspond plus à la saisie. */
export const resultatObsolete = () => !!S.result && S.resultStopsHash !== hashStops();

export function resetResult() {
  S.result = null;
  S.manual = null;
  emit("result");
}

// ── Tournées enregistrées ────────────────────────────────────────────────────
export function nomParDefaut() {
  const [y, m, d] = S.params.tourDate.split("-");
  let nom = `Tournée du ${d}/${m}/${y}`;
  if (S.params.driver.trim()) nom += ` – ${S.params.driver.trim()}`;
  return nom;
}

const meta = () => ({ depot_depart_key: S.params.depotDepart, depot_retour_key: S.params.depotRetour,
  heure_min_depart: S.params.heureMin });

function hashTournee(nom) {
  return JSON.stringify({ s: stopsRecords(), nom, d: S.params.tourDate, c: S.params.driver, m: meta() });
}

let saving = null;
export async function saveTournee(nom, asNew = false) {
  nom = String(nom || "").trim() || S.tournee.nom || nomParDefaut();
  const records = stopsRecords();
  const h = hashTournee(nom);
  saving = (async () => {
    try {
      const id = await S.store.saveTournee(asNew ? null : S.tournee.id, nom, S.params.tourDate,
        S.params.driver, records, meta());
      Object.assign(S.tournee, { id, nom, savedHash: h, savedAt: new Date().toISOString(), error: null });
      return true;
    } catch (e) {
      S.tournee.error = e.message;
      return false;
    } finally {
      saving = null;
      emit("tournee");
    }
  })();
  return saving;
}

let autosaveTimer = null;
function scheduleAutosave() {
  if (!S.tournee.id || !S.tournee.autosave) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(async () => {
    if (saving) await saving;
    const nom = S.tournee.nom || nomParDefaut();
    if (hashTournee(nom) !== S.tournee.savedHash) await saveTournee(nom);
  }, 1500);
}

export async function loadTournee(id, asCopy = false) {
  const t = await S.store.getTournee(id);
  if (!t) throw new Error("Cette tournée n'existe plus.");
  S.stops = (t.stops?.length ? t.stops : []).map((s) => normaliserArret({ ...s, Suppr: false }));
  if (!S.stops.length) S.stops = stopsVides();
  S.params.driver = t.chauffeur || "";
  const m = t.meta || {};
  if (m.depot_depart_key) S.params.depotDepart = m.depot_depart_key;
  if (m.depot_retour_key) S.params.depotRetour = m.depot_retour_key;
  if (m.heure_min_depart) S.params.heureMin = m.heure_min_depart;
  if (asCopy) {
    Object.assign(S.tournee, { id: null, nom: `${t.nom} (copie)`, savedHash: null, savedAt: null, error: null });
  } else {
    if (t.tour_date) S.params.tourDate = t.tour_date;
    Object.assign(S.tournee, { id: t.id, nom: t.nom, savedAt: t.updated_at, error: null });
    S.tournee.savedHash = hashTournee(t.nom);
  }
  S.result = null; S.manual = null;
  emit("stops"); emit("params"); emit("result"); emit("tournee");
}

export function nouvelleTournee() {
  S.stops = stopsVides();
  Object.assign(S.tournee, { id: null, nom: "", savedHash: null, savedAt: null, error: null });
  S.result = null; S.manual = null;
  emit("stops"); emit("result"); emit("tournee");
}

// ── Barème ───────────────────────────────────────────────────────────────────
export async function saveBareme(b, appliquer) {
  S.bareme = normaliserBareme(b);
  try { await S.store.setSetting(BAREME_SETTING_KEY, S.bareme); S.baremeError = null; }
  catch (e) { S.baremeError = e.message; }
  if (appliquer) { S.stops.forEach(dureeAuto); emit("stops"); }
  emit("bareme");
}

// ── Stock ────────────────────────────────────────────────────────────────────
export async function saveStock(rows, message = "Stock enregistré") {
  S.stock = cleanStock(rows);
  try {
    await S.store.saveStock(S.stock);
    S.stockMaj = new Date().toISOString();
    S.stockError = null;
    toast(message);
  } catch (e) {
    S.stockError = e.message;
    toast("Stock non enregistré : " + e.message, "err");
  }
  emit("stock");
}

// ── Initialisation ───────────────────────────────────────────────────────────
export async function initState(store) {
  S.store = store;
  const [bar, stk] = await Promise.allSettled([store.getSetting(BAREME_SETTING_KEY), store.loadStock()]);
  if (bar.status === "fulfilled") S.bareme = normaliserBareme(bar.value);
  else S.baremeError = bar.reason?.message;
  if (stk.status === "fulfilled" && stk.value.rows.length) {
    S.stock = cleanStock(stk.value.rows);
    S.stockMaj = stk.value.maj;
  } else {
    S.stock = cleanStock(stockDefaut());
    S.stockMaj = null;
    if (stk.status === "rejected") S.stockError = stk.reason?.message;
  }
  if (!loadDraft() || !S.stops.length) S.stops = stopsVides();
}
