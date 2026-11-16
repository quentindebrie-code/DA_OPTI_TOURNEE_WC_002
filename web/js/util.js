// Constantes métier et petits utilitaires partagés (repris de tournees.py).

export const DEPOTS = {
  "Saint-Sulpice": "Imp. Gaston Phoebus, 81370 Saint-Sulpice-la-Pointe",
  "Villemur-sur-Tarn": "1 Avenue du Président Roosevelt 31340 Villemur-sur-Tarn",
};
export const DEPOT_DEFAUT = "Saint-Sulpice";

export const PRODUITS_CATALOGUE = ["WC chimique", "WC handicapé", "WC Luxe",
  "Lave-main", "Urinoir", "WC client"];
export const OPTIONS_WC = ["", "Lave-main", "Urinoir"];
export const COULEURS_PRODUITS = ["Vert", "Jaune", "Rose", "Bleu", "Orange",
  "Crème", "Blanc", "Gris"];

export const ACTION_COLORS = {
  "Nettoyer": "#1f6aa5",
  "Déposer": "#28a745",
  "Retirer": "#dc3545",
  "Chargement": "#7B1FA2",
  "Déchargement": "#E65100",
};

/** Échappe une valeur pour insertion dans du HTML. */
export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

/** Minuscules, sans accents, espaces compactés (= _norm_txt). */
export function normTxt(s) {
  return String(s ?? "").trim().toLowerCase()
    .normalize("NFD").replace(/\p{Mn}/gu, "")
    .split(/\s+/).filter(Boolean).join(" ");
}

function normalizeCouleur(label) {
  const n = normTxt(label);
  if (!n) return "";
  for (const c of COULEURS_PRODUITS) {
    const cn = normTxt(c);
    if (n === cn || n === cn + "s" || n.startsWith(cn)) return c;
  }
  const t = String(label).trim();
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

/** Liste ordonnée des couleurs connues contenues dans une cellule texte ou un tableau. */
export function couleursArret(value) {
  const values = Array.isArray(value) ? value : String(value ?? "").split(/[,;/|]+/);
  const sel = new Set(values.map(normalizeCouleur));
  return COULEURS_PRODUITS.filter((c) => sel.has(c));
}
export const couleursTexte = (v) => couleursArret(v).join(", ");

export function uid() {
  return crypto.randomUUID ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
}

export function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  return isNaN(d) ? String(iso) : d.toLocaleDateString("fr-FR");
}

export function fmtDateHeure(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? String(iso)
    : d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

// ── Géocodage (Base Adresse Nationale via la Géoplateforme IGN), avec cache local ─────────────────────
const GEO_CACHE_KEY = "geo-cache-v1";
let geoCache = {};
try { geoCache = JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || "{}"); } catch { geoCache = {}; }
const geoPending = new Map();

function saveGeoCache() {
  try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(geoCache)); } catch { /* quota / privé */ }
}

/** Retourne {lat, lon, label, score} ou null si l'adresse est introuvable. */
export async function geocode(address) {
  const key = normTxt(address);
  if (!key) return null;
  if (key in geoCache) return geoCache[key];
  if (geoPending.has(key)) return geoPending.get(key);
  const p = (async () => {
    const url = "https://data.geopf.fr/geocodage/search?limit=1&q=" + encodeURIComponent(address);
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`Géocodage indisponible (${r.status})`);
    const f = (await r.json()).features?.[0];
    const res = f ? { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
      label: f.properties.label, score: f.properties.score } : null;
    geoCache[key] = res;
    saveGeoCache();
    return res;
  })().finally(() => geoPending.delete(key));
  geoPending.set(key, p);
  return p;
}

// ── Notifications ────────────────────────────────────────────────────────────
export function toast(message, kind = "ok") {
  const host = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.setAttribute("role", kind === "err" ? "alert" : "status");
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.classList.add("out"), kind === "err" ? 6000 : 3000);
  setTimeout(() => el.remove(), kind === "err" ? 6400 : 3400);
}

/** Boîte de confirmation (renvoie une promesse booléenne). */
export function confirmer(titre, message, libelleOk = "Confirmer") {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "dialog";
    dlg.innerHTML = `<form method="dialog">
      <h3>${esc(titre)}</h3><p>${esc(message)}</p>
      <div class="row end">
        <button value="non" class="btn">Annuler</button>
        <button value="oui" class="btn btn-danger">${esc(libelleOk)}</button>
      </div></form>`;
    document.body.appendChild(dlg);
    dlg.addEventListener("close", () => { resolve(dlg.returnValue === "oui"); dlg.remove(); });
    dlg.showModal();
  });
}
