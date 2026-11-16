// Constantes métier, utilitaires et micro-interactions partagées.

import { icon } from "./icons.js?v=202611162108";

export const DEPOTS = {
  "Saint-Sulpice": "Imp. Gaston Phoebus, 81370 Saint-Sulpice-la-Pointe",
  "Villemur-sur-Tarn": "1 Avenue du Président Roosevelt 31340 Villemur-sur-Tarn",
};
export const DEPOT_DEFAUT = "Saint-Sulpice";

export const PRODUITS_CATALOGUE = ["WC chimique", "WC handicapé", "WC Luxe", "Lave-main", "Urinoir", "WC client"];
export const OPTIONS_WC = ["", "Lave-main", "Urinoir"];
export const COULEURS_PRODUITS = ["Vert", "Jaune", "Rose", "Bleu", "Orange", "Crème", "Blanc", "Gris"];

// Couleurs des types d'intervention (distinctes des couleurs d'état)
export const ACTION_COLORS = {
  "Nettoyer": "#1E7FD6",
  "Déposer": "#038D29",
  "Retirer": "#7A4BC2",
  "Chargement": "#00838F",
  "Déchargement": "#C26A12",
};

export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** Minuscules, sans accents, espaces compactés. */
export function normTxt(s) {
  return String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "").split(/\s+/).filter(Boolean).join(" ");
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
export function couleursArret(value) {
  const values = Array.isArray(value) ? value : String(value ?? "").split(/[,;/|]+/);
  const sel = new Set(values.map(normalizeCouleur));
  return COULEURS_PRODUITS.filter((c) => sel.has(c));
}
export const couleursTexte = (v) => couleursArret(v).join(", ");
export const PASTILLE = { "Vert": "#2E7D32", "Jaune": "#F9A825", "Rose": "#EC407A", "Bleu": "#1E88E5",
  "Orange": "#EF6C00", "Crème": "#D9C89E", "Blanc": "#FFFFFF", "Gris": "#9E9E9E" };

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
  return isNaN(d) ? String(iso) : d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}
export const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// ── Géocodage (Base Adresse Nationale), avec cache local ─────────────────────
const GEO_CACHE_KEY = "geo-cache-v1";
let geoCache = {};
try { geoCache = JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || "{}"); } catch { geoCache = {}; }
const geoPending = new Map();
let geoSaveTimer = null;
function saveGeoCache() {
  clearTimeout(geoSaveTimer);
  geoSaveTimer = setTimeout(() => { try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(geoCache)); } catch { /* quota */ } }, 400);
}
export const geoConnu = (address) => geoCache[normTxt(address)];
export async function geocode(address, signal) {
  const key = normTxt(address);
  if (!key) return null;
  if (key in geoCache) return geoCache[key];
  if (geoPending.has(key)) return geoPending.get(key);
  const p = (async () => {
    let last;
    for (let essai = 0; essai < 2; essai++) {
      try {
        const sig = signal && AbortSignal.any ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);
        const r = await fetch("https://data.geopf.fr/geocodage/search?limit=1&q=" + encodeURIComponent(address), { signal: sig });
        if (!r.ok) throw new Error(`service d'adresses indisponible (${r.status})`);
        const f = (await r.json()).features?.[0];
        const res = f ? { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], label: f.properties.label, score: f.properties.score } : null;
        geoCache[key] = res;
        saveGeoCache();
        return res;
      } catch (e) { last = e; if (signal?.aborted) throw e; }
    }
    throw last;
  })().finally(() => geoPending.delete(key));
  geoPending.set(key, p);
  return p;
}

// ── Notifications ────────────────────────────────────────────────────────────
/**
 * toast(message, kind, { action: { label, run } })
 * Les erreurs restent affichées jusqu'à fermeture ; les autres disparaissent seules
 * (plus tard si une action « Annuler » est proposée, jamais pendant le survol).
 */
export function toast(message, kind = "ok", opts = {}) {
  const host = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.setAttribute("role", kind === "err" ? "alert" : "status");
  const ic = { ok: "check-circle", err: "x-circle", info: "info", warn: "alert" }[kind] || "info";
  el.innerHTML = `${icon(ic)}<span></span>`;
  el.querySelector("span").textContent = message;
  const close = () => { if (!el.isConnected) return; el.classList.add("out"); setTimeout(() => el.remove(), 320); };
  if (opts.action) {
    const b = document.createElement("button");
    b.className = "btn btn-sm";
    b.textContent = opts.action.label;
    b.addEventListener("click", () => { opts.action.run(); close(); });
    el.appendChild(b);
  }
  if (kind === "err" || opts.action || opts.persist) {
    const x = document.createElement("button");
    x.className = "btn btn-sm btn-icon";
    x.setAttribute("aria-label", "Fermer le message");
    x.innerHTML = icon("x");
    x.addEventListener("click", close);
    el.appendChild(x);
  }
  host.appendChild(el);
  if (kind !== "err" && !opts.persist) {
    let t = setTimeout(close, opts.action ? 8000 : 3200);
    el.addEventListener("pointerenter", () => clearTimeout(t));
    el.addEventListener("focusin", () => clearTimeout(t));
    el.addEventListener("pointerleave", () => { t = setTimeout(close, 2500); });
  }
  return close;
}

/** Ferme un <dialog> avec une animation de sortie. */
export function closeDialog(dlg, value) {
  if (!dlg.open) return;
  dlg.classList.add("closing");
  setTimeout(() => { dlg.classList.remove("closing"); dlg.close(value); }, reduceMotion() ? 0 : 210);
}

/** Boîte de confirmation (promesse booléenne). */
export function confirmer(titre, message, libelleOk = "Confirmer", danger = true) {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "dialog";
    dlg.innerHTML = `<h2></h2><p class="muted"></p>
      <div class="dlg-actions"><button class="btn" data-v="non">Annuler</button>
      <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-v="oui"></button></div>`;
    dlg.querySelector("h2").textContent = titre;
    dlg.querySelector("p").textContent = message;
    dlg.querySelector("[data-v=oui]").textContent = libelleOk;
    document.body.appendChild(dlg);
    dlg.addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (b) closeDialog(dlg, b.dataset.v);
      else if (e.target === dlg) closeDialog(dlg, "non");
    });
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); closeDialog(dlg, "non"); });
    dlg.addEventListener("close", () => { resolve(dlg.returnValue === "oui"); dlg.remove(); });
    dlg.showModal();
  });
}

/** Ouvre un dialogue générique (fermeture animée sur Échap, clic extérieur ou [data-close]). */
export function ouvrirDialog(html, cls = "") {
  const dlg = document.createElement("dialog");
  dlg.className = `dialog ${cls}`;
  dlg.innerHTML = html;
  document.body.appendChild(dlg);
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); closeDialog(dlg); });
  dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest("[data-close]")) closeDialog(dlg); });
  dlg.addEventListener("close", () => setTimeout(() => dlg.remove(), 50));
  dlg.showModal();
  return dlg;
}

/** Indique qu'un bouton travaille (libellé + roue), puis le rétablit. */
export async function withBusy(btn, label, fn) {
  const html = btn.innerHTML;
  btn.setAttribute("aria-busy", "true");
  btn.disabled = true;
  const t = setTimeout(() => { btn.innerHTML = `${icon("refresh", "spin")}<span>${esc(label)}</span>`; }, 120);
  try { return await fn(); }
  finally { clearTimeout(t); if (btn.isConnected) { btn.innerHTML = html; btn.disabled = false; btn.removeAttribute("aria-busy"); } }
}

// ── Micro-interactions globales ──────────────────────────────────────────────
export function initInteractions() {
  const fine = matchMedia("(hover: hover) and (pointer: fine)");
  let current = null;
  const release = (b) => { b.style.setProperty("--mx", "0px"); b.style.setProperty("--my", "0px"); };
  // Effet magnétique : le bouton suit légèrement le pointeur
  document.addEventListener("pointermove", (e) => {
    if (!fine.matches || reduceMotion()) return;
    const b = e.target.closest?.(".btn:not(:disabled)");
    if (current && current !== b) release(current);
    current = b;
    if (!b) return;
    const r = b.getBoundingClientRect();
    b.style.setProperty("--mx", `${(((e.clientX - r.left) / r.width - .5) * 8).toFixed(1)}px`);
    b.style.setProperty("--my", `${(((e.clientY - r.top) / r.height - .5) * 6).toFixed(1)}px`);
  }, { passive: true });
  document.addEventListener("pointerleave", () => { if (current) release(current); }, true);
  // Ondulation au clic
  document.addEventListener("pointerdown", (e) => {
    const b = e.target.closest?.(".btn");
    if (!b || b.disabled || reduceMotion()) return;
    const r = b.getBoundingClientRect();
    const s = Math.max(r.width, r.height);
    const rip = document.createElement("span");
    rip.className = "ripple";
    rip.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
    b.appendChild(rip);
    setTimeout(() => rip.remove(), 650);
  });
}

/** Place l'indicateur glissant (.ink) sous l'élément actif d'un groupe. */
export function moveInk(container, active) {
  const ink = container?.querySelector(":scope > .ink");
  if (!ink) return;
  if (!active) { ink.style.opacity = "0"; return; }
  ink.style.opacity = "1";
  ink.style.transform = `translateX(${active.offsetLeft}px)`;
  ink.style.width = `${active.offsetWidth}px`;
}

/** Petite pluie de confettis aux couleurs de la charte (moments de réussite). */
export function confettis() {
  if (reduceMotion()) return;
  const c = document.createElement("canvas");
  c.className = "confetti";
  c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio;
  document.body.appendChild(c);
  const g = c.getContext("2d");
  g.scale(devicePixelRatio, devicePixelRatio);
  const cols = ["#00FA42", "#00AF33", "#038D29", "#D2FFE1", "#0A6D25"];
  const parts = Array.from({ length: 90 }, () => ({
    x: innerWidth / 2 + (Math.random() - .5) * 160, y: innerHeight * .55,
    vx: (Math.random() - .5) * 11, vy: -Math.random() * 13 - 6, r: Math.random() * 6 + 4,
    a: Math.random() * Math.PI, va: (Math.random() - .5) * .3, col: cols[(Math.random() * cols.length) | 0],
  }));
  const t0 = performance.now();
  (function frame(t) {
    g.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += .38; p.x += p.vx; p.y += p.vy; p.a += p.va;
      g.save(); g.translate(p.x, p.y); g.rotate(p.a); g.fillStyle = p.col;
      g.globalAlpha = Math.max(0, 1 - (t - t0) / 1800);
      g.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); g.restore();
    }
    if (t - t0 < 1800) requestAnimationFrame(frame); else c.remove();
  })(t0);
}
