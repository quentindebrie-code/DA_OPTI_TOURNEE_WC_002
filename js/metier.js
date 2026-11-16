// Règles métier portées de tournees.py : barème des durées, parc / stock,
// normalisation des saisies, consignes et nomenclature d'état des lieux.

import { COULEURS_PRODUITS, PRODUITS_CATALOGUE, normTxt, couleursArret, couleursTexte } from "./util.js?v=202611161929";

export const ACTIONS_CATALOGUE = ["Nettoyer", "Déposer", "Retirer", "Chargement", "Déchargement"];
export const OPTIONS_CATALOGUE = ["Lave-main", "Urinoir"];
export const STOPS_COLUMNS = ["Action", "Produit", "Option", "Couleur", "Quantité",
  "Nom du client", "Adresse", "Durée (min)", "Pas avant", "Pas après", "Observations"];

export const PAUSE_DEJEUNER_MIN = 30;

// Couleurs de fond (cartes, Excel, PDF) et de bordure par action
export const ACTION_BG = { "Nettoyer": "#D6E8F8", "Déposer": "#CFF5DA", "Retirer": "#E6DCF5",
  "Chargement": "#CDEEF0", "Déchargement": "#F6E1CC" };

export const COULEUR_HEX = { "Vert": "#2E7D32", "Jaune": "#F9A825", "Rose": "#EC407A",
  "Bleu": "#1E88E5", "Orange": "#EF6C00", "Crème": "#D9C89E", "Blanc": "#FFFFFF", "Gris": "#9E9E9E" };
export const COULEUR_TEXTE = { "Jaune": "#3E2723", "Crème": "#3E2723", "Blanc": "#3E2723" };

// ═════════════════════════════════════════════════════════════════════════════
// Barème des durées (minutes par unité, × quantité)
// ═════════════════════════════════════════════════════════════════════════════
export const BAREME_PRODUITS = ["WC chimique", "WC handicapé", "WC Luxe", "Urinoir", "Lave-main"];
export const BAREME_ACTIONS = ACTIONS_CATALOGUE;
export const BAREME_SETTING_KEY = "bareme_durees";

export function baremeDefaut() {
  const simple = Object.fromEntries(BAREME_ACTIONS.map((a) => [a, a === "Déposer" ? 15 : 10]));
  return {
    "WC chimique": { "Déposer": 20, "Retirer": 15, "Nettoyer": 10, "Chargement": 15, "Déchargement": 5 },
    "WC handicapé": { "Nettoyer": 25, "Déposer": 30, "Retirer": 10, "Chargement": 20, "Déchargement": 10 },
    "WC Luxe": Object.fromEntries(BAREME_ACTIONS.map((a) => [a, null])),
    "Urinoir": { ...simple },
    "Lave-main": { ...simple },
  };
}

export function normaliserBareme(valeur) {
  const out = baremeDefaut();
  if (valeur && typeof valeur === "object") {
    for (const p of BAREME_PRODUITS) {
      const src = valeur[p];
      if (!src || typeof src !== "object") continue;
      for (const a of BAREME_ACTIONS) {
        if (!(a in src)) continue;
        const n = parseInt(src[a], 10);
        out[p][a] = Number.isFinite(n) && n > 0 ? n : null;
      }
    }
  }
  return out;
}

/** Durée au barème, ou null si le produit / l'action est hors barème. */
export function autoDuree(bareme, action, produit, quantite) {
  const base = bareme?.[String(produit).trim()]?.[String(action).trim()];
  if (base == null || base === "") return null;
  const q = Math.max(1, parseInt(quantite, 10) || 1);
  return Number(base) * q;
}

// ═════════════════════════════════════════════════════════════════════════════
// Parc & stock
// ═════════════════════════════════════════════════════════════════════════════
export const PRODUITS_HORS_STOCK = new Set(["WC client"]);
export const ARTICLES_STOCK = ["WC chimique + Lave-main", "WC chimique + Urinoir", "WC chimique",
  "WC handicapé", "WC Luxe", "Lave-main", "Urinoir"];

const MVT = { "Déposer": -1, "Retirer": 1, "Nettoyer": 0, "Chargement": 0, "Déchargement": 0 };
const MVT_ETENDU = { ...MVT, "Chargement": 1, "Déchargement": -1 };

export function articleKey(produit, option = "") {
  const p = String(produit || "").trim();
  const o = String(option || "").trim();
  if (!p || PRODUITS_HORS_STOCK.has(p)) return "";
  return p === "WC chimique" && o ? `WC chimique + ${o}` : p;
}

const RE_WC = /\bw[cl]\b/;

export function normalizeArticle(label) {
  const raw = String(label ?? "").trim();
  let n = normTxt(raw);
  if (!n) return "";
  n = n.replace(/^\d+\s*[x×]?\s*/, "");
  const hasWc = RE_WC.test(n);
  if (n.includes("pmr") || n.includes("handicap")) return "WC handicapé";
  if (n.includes("luxe")) return "WC Luxe";
  if (hasWc && n.includes("lave")) return "WC chimique + Lave-main";
  if (hasWc && n.includes("urinoir")) return "WC chimique + Urinoir";
  if (n.includes("lave") && n.includes("main")) return "Lave-main";
  if (n.includes("urinoir")) return "Urinoir";
  if (hasWc) return "WC chimique";
  return raw;
}

function normalizeCouleurLibre(label) {
  const c = couleursArret([label]);
  if (c.length) return c[0];
  const t = String(label ?? "").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : "";
}

export function stockDefaut() {
  return [
    ["WC chimique + Lave-main", "Vert", 3, 1], ["WC chimique + Lave-main", "Jaune", 1, 4],
    ["WC chimique + Lave-main", "Rose", 3, 1], ["WC chimique + Lave-main", "Bleu", 1, 3],
    ["WC chimique + Lave-main", "Orange", 0, 1], ["WC chimique + Urinoir", "Jaune", 0, 2],
    ["WC chimique + Urinoir", "Orange", 0, 2], ["WC handicapé", "Vert", 0, 1],
    ["WC Luxe", "Crème", 0, 2], ["Lave-main", "Jaune", 0, 5], ["Urinoir", "Vert", 0, 4],
  ].map(([article, couleur, installes, en_stock]) => ({ article, couleur, installes, en_stock }));
}

const ordreArticle = (a) => { const i = ARTICLES_STOCK.indexOf(a); return i < 0 ? 999 : i; };
const ordreCouleur = (c) => { const i = COULEURS_PRODUITS.indexOf(c); return i < 0 ? 999 : i; };
export function trierStock(rows) {
  return rows.sort((x, y) => ordreArticle(x.article) - ordreArticle(y.article)
    || x.article.localeCompare(y.article) || ordreCouleur(x.couleur) - ordreCouleur(y.couleur)
    || x.couleur.localeCompare(y.couleur));
}

/** Nettoie, normalise, agrège les doublons (article, couleur) et trie. */
export function cleanStock(rows) {
  const agg = new Map();
  for (const r of rows || []) {
    const article = normalizeArticle(r.article);
    if (!article) continue;
    const couleur = normalizeCouleurLibre(r.couleur);
    const k = article + "\u0000" + couleur;
    const cur = agg.get(k) || { article, couleur, installes: 0, en_stock: 0 };
    cur.installes += Math.max(0, parseInt(r.installes, 10) || 0);
    cur.en_stock += Math.max(0, parseInt(r.en_stock, 10) || 0);
    agg.set(k, cur);
  }
  return trierStock([...agg.values()]);
}

/** Mouvements de stock générés par les arrêts : [{article, couleur, sorties, retours, net}] */
export function besoinsTournee(stops, inclureManutentions = false) {
  const bareme = inclureManutentions ? MVT_ETENDU : MVT;
  const agg = new Map();
  for (const s of stops || []) {
    if (!String(s["Adresse"] || "").trim()) continue;
    const article = articleKey(s["Produit"], s["Option"]);
    if (!article) continue;
    const sens = bareme[String(s["Action"] || "").trim()] || 0;
    if (!sens) continue;
    const q = Math.max(1, parseInt(s["Quantité"], 10) || 1);
    const couleur = couleursTexte(s["Couleur"]);
    const k = article + "\u0000" + couleur;
    const cur = agg.get(k) || { article, couleur, sorties: 0, retours: 0 };
    if (sens < 0) cur.sorties += q; else cur.retours += q;
    agg.set(k, cur);
  }
  return trierStock([...agg.values()].map((b) => ({ ...b, net: b.retours - b.sorties })));
}

function dispo(stock, article, couleur) {
  const sel = couleursArret(couleur);
  return stock.filter((r) => r.article === article && (!couleur || sel.includes(r.couleur)))
    .reduce((n, r) => n + r.en_stock, 0);
}

/** Confronte les sorties au stock disponible. */
export function controleDisponibilite(stockRows, besoins) {
  const stock = cleanStock(stockRows);
  return besoins.filter((b) => b.sorties > 0).map((b) => {
    const disponible = dispo(stock, b.article, b.couleur);
    const manque = Math.max(0, b.sorties - disponible);
    const statut = manque > 0 ? "rupture" : disponible === b.sorties ? "juste" : "ok";
    return { article: b.article, couleur: b.couleur || "Toutes couleurs", besoin: b.sorties,
      disponible, manque, statut };
  });
}

/** Applique les mouvements de la tournée au parc (allocation gloutonne sur les couleurs). */
export function projeterStock(stockRows, besoins) {
  const stock = cleanStock(stockRows).map((r) => ({ ...r }));
  const idx = (a, c) => stock.find((r) => r.article === a && r.couleur === c);
  for (const b of besoins || []) {
    for (const [qte, sens] of [[b.sorties, -1], [b.retours, 1]]) {
      if (qte <= 0) continue;
      const selection = couleursArret(b.couleur);
      let cibles;
      if (selection.length === 1) {
        cibles = [[selection[0], qte]];
      } else {
        let sub = stock.filter((r) => r.article === b.article && (!selection.length || selection.includes(r.couleur)));
        sub = [...sub].sort((x, y) => (sens > 0 ? x.en_stock - y.en_stock : y.en_stock - x.en_stock));
        cibles = [];
        let reste = qte;
        for (const l of sub) {
          if (reste <= 0) break;
          const part = Math.max(0, sens < 0 ? Math.min(reste, l.en_stock) : reste);
          if (part > 0) { cibles.push([l.couleur, part]); reste -= part; }
        }
        if (reste > 0) cibles.push([sub[0]?.couleur ?? (selection[0] || ""), reste]);
      }
      for (const [c, part] of cibles) {
        let r = idx(b.article, c);
        if (!r) { r = { article: b.article, couleur: c, installes: 0, en_stock: 0 }; stock.push(r); }
        r.en_stock = Math.max(0, r.en_stock + sens * part);
        r.installes = Math.max(0, r.installes - sens * part);
      }
    }
  }
  return cleanStock(stock);
}

/** Mouvements enrichis du stock avant tournée (récap matériel des exports). */
export function besoinsRecords(stops, stockRows, inclureManutentions = false) {
  const stock = cleanStock(stockRows);
  return besoinsTournee(stops, inclureManutentions).map((b) => {
    const d = dispo(stock, b.article, b.couleur);
    return { ...b, stockAvant: `${d} (${b.couleur || "toutes couleurs"})`,
      manque: Math.max(0, b.sorties - d) };
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// Normalisation des saisies (import Excel)
// ═════════════════════════════════════════════════════════════════════════════
export function normalizeAction(v) {
  const n = normTxt(v);
  if (!n) return ["Nettoyer", false];
  for (const a of ACTIONS_CATALOGUE) if (normTxt(a) === n) return [a, true];
  for (const a of [...ACTIONS_CATALOGUE].sort((x, y) => y.length - x.length)) {
    const na = normTxt(a);
    if (n.includes(na) || na.includes(n)) return [a, true];
  }
  return ["Nettoyer", false];
}

export function normalizeProduit(v) {
  const n = normTxt(v);
  if (!n) return ["WC chimique", false];
  for (const p of PRODUITS_CATALOGUE) if (normTxt(p) === n) return [p, true];
  if (n.includes("client")) return ["WC client", true];
  if (n.includes("pmr") || n.includes("handicap")) return ["WC handicapé", true];
  if (n.includes("luxe")) return ["WC Luxe", true];
  if (n.includes("lave") && n.includes("main") && !RE_WC.test(n)) return ["Lave-main", true];
  if (n.includes("urinoir") && !RE_WC.test(n)) return ["Urinoir", true];
  if (RE_WC.test(n) || n.includes("chimique")) return ["WC chimique", true];
  return ["WC chimique", false];
}

export function normalizeOption(v) {
  const n = normTxt(v);
  if (!n || ["-", "—", "aucune", "aucun", "nan"].includes(n)) return ["", true];
  if (n.includes("lave")) return ["Lave-main", true];
  if (n.includes("urinoir")) return ["Urinoir", true];
  return ["", false];
}

/** Cellule Excel (Date, fraction de journée, texte libre) → "HH:MM" ou "". */
export function hhmmFromCell(v) {
  if (v == null || v === "") return "";
  if (v instanceof Date) {
    return `${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}`;
  }
  if (typeof v === "number") {
    if (v >= 0 && v < 1) {
      const t = Math.round(v * 24 * 60);
      return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
    }
    if (v >= 0 && v <= 24) return `${String(Math.floor(v)).padStart(2, "0")}:00`;
    return "";
  }
  const s = String(v).trim();
  if (!s || ["nan", "-", "—"].includes(normTxt(s))) return "";
  let m = s.match(/^(\d{1,2})\s*[:hH.]\s*(\d{0,2})$/);
  if (!m) m = s.match(/^(\d{2})(\d{2})$/);
  if (m) {
    const h = parseInt(m[1], 10), mi = parseInt(m[2] || "0", 10);
    if (h <= 23 && mi <= 59) return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
  }
  return "";
}

// ═════════════════════════════════════════════════════════════════════════════
// Arrêts
// ═════════════════════════════════════════════════════════════════════════════
export function nouvelArret(bareme, partiel = {}) {
  const s = { "Client": "", "Suppr": false, "Action": "Nettoyer", "Produit": "WC chimique",
    "Option": "Lave-main", "Couleur": "", "Quantité": 1, "Nom du client": "", "Adresse": "",
    "Durée (min)": 30, "Pas avant": "", "Pas après": "", "Observations": "", ...partiel };
  if (!("Durée (min)" in partiel)) s["Durée (min)"] = autoDuree(bareme, s["Action"], s["Produit"], s["Quantité"]) ?? 30;
  return s;
}

/** Ligne propre (types, option vidée hors WC chimique). */
export function normaliserArret(s) {
  const out = { ...nouvelArret(null, {}), ...s };
  out["Quantité"] = Math.min(20, Math.max(1, parseInt(out["Quantité"], 10) || 1));
  out["Durée (min)"] = Math.min(480, Math.max(1, parseInt(out["Durée (min)"], 10) || 30));
  out["Couleur"] = couleursTexte(out["Couleur"]);
  for (const k of ["Client", "Nom du client", "Adresse", "Pas avant", "Pas après", "Observations"]) {
    out[k] = String(out[k] ?? "");
  }
  if (out["Produit"] !== "WC chimique") out["Option"] = "";
  out["Suppr"] = !!out["Suppr"];
  return out;
}

export function qtyLabel(s) {
  const produit = String(s["Produit"] || "").trim();
  const option = String(s["Option"] || "").trim();
  const couleur = String(s["Couleur"] || "").trim();
  const q = parseInt(s["Quantité"], 10) || 1;
  if (!produit) return `${q} × ?`;
  let label = `${q} × ${produit}`;
  if (produit === "WC chimique" && option) label += ` + ${q} × ${option}`;
  return label;
}

export const parseHhmm = (s) => {
  const m = String(s || "").trim().match(/^(\d{1,2}):(\d{2})/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
};
export const fmtMin = (min) => {
  if (min == null || !Number.isFinite(min)) return "";
  const t = Math.floor(min);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};
export const fmtDuree = (min) => `${Math.floor(min / 60)}h${String(Math.floor(min % 60)).padStart(2, "0")}`;

// ═════════════════════════════════════════════════════════════════════════════
// Textes des documents
// ═════════════════════════════════════════════════════════════════════════════
export const ACTION_CONSIGNES = {
  "Nettoyer": [
    "Vidanger intégralement la cuve des eaux usées.",
    "Remplir le réservoir de chasse avec de l'eau propre en ajoutant une dose de produit sanitaire bleu.",
    "Remplir le réservoir d'eau propre destiné exclusivement au lave-mains.",
    "Nettoyer et désinfecter l'ensemble des surfaces intérieures à l'aide d'un spray désinfectant, puis rincer à l'eau claire.",
    "Contrôler et réapprovisionner les consommables : papier hygiénique, gel désinfectant et savon.",
    "Vérifier le bon état général de l'équipement (porte, serrure, plancher, cuves et accessoires).",
    "Signaler toute anomalie, dégradation ou dysfonctionnement constaté sur la fiche de tournée.",
  ],
  "Déposer": [
    "Positionner le WC sur l'emplacement désigné par le client, en dehors des zones de passage et de tout obstacle, sur un sol stable et plan.",
    "Vérifier la stabilité et l'aplomb de l'équipement.",
    "Remplir le réservoir de chasse avec de l'eau propre en ajoutant une dose de produit sanitaire bleu.",
    "Remplir le réservoir d'eau propre destiné exclusivement au lave-mains.",
    "Nettoyer et désinfecter l'ensemble des surfaces intérieures à l'aide d'un spray désinfectant, puis rincer à l'eau claire si nécessaire.",
    "Réapprovisionner les consommables : papier hygiénique, gel désinfectant et savon.",
    "Informer le client de la mise en service de l'équipement et, en cas de première installation, lui remettre les consignes d'utilisation.",
    "Prendre une photo une fois installé.",
  ],
  "Retirer": [
    "Vidanger intégralement toutes les cuves avant l'enlèvement, y compris lorsqu'elles sont seulement partiellement remplies.",
    "Vérifier la propreté de la zone d'intervention et s'assurer qu'aucune trace ou salissure ne subsiste après le retrait de l'équipement.",
    "Contrôler l'état général du WC au moment du chargement et consigner toute dégradation, anomalie ou pièce manquante sur la fiche de tournée.",
  ],
};

export const PIECES_ETAT_LIEUX = [
  ["Porte & fermeture", [["PR034", "Poignée de porte (couleur noire)"], ["PR036", "Support du verrou"]]],
  ["Cuvette & sanitaire", [["CO002", "Lunette + cuvette des WC (couleur noire)"], ["PR008", "Cylindre porte-papier hygiénique"]]],
  ["Lave-mains & robinetterie", [["CO013", "Distributeur de savon"], ["CO090", "Coussin de la pompe à pied"],
    ["PR023", "Embout du robinet"], ["PR042", "Mousseur pour robinet"],
    ["PR041", "Embout et filtre pour mousseur"], ["PR043", "Joint robinet"]]],
  ["Structure & mobilité", [["CO001", "Roue 200 DBU N/G 20x58"]]],
];

export const ETAT_LIEUX_INTRO = "Fiche à compléter par l'opérateur lors du contrôle de l'équipement. "
  + "Pour chaque pièce, cochez « Bon état » si elle est présente et fonctionnelle. "
  + "En cas de pièce usée, défectueuse ou manquante, cochez « À remplacer », "
  + "indiquez la quantité à commander et précisez la nature du défaut dans la "
  + "colonne Observations. La fiche datée et signée atteste de l'état constaté "
  + "au moment de l'intervention.";

export const ETAT_LIEUX_INTRO_GENERAL = "Fiche unique de contrôle des pièces pour l'ensemble de la tournée. "
  + "À compléter par l'opérateur : cochez « Bon état » pour chaque pièce présente "
  + "et fonctionnelle, « À remplacer » en cas d'usure, de défaut ou d'absence, en "
  + "indiquant la quantité à commander. Précisez le point d'intervention concerné "
  + "dans la colonne Observations si nécessaire. La fiche datée et signée atteste "
  + "de l'état constaté lors de la tournée.";

export function prestationParts(stop) {
  const q = parseInt(stop.qty_num, 10) || 1;
  const produit = String(stop.produit || "").trim();
  const option = String(stop.option || "").trim();
  const couleur = String(stop.couleur || "").trim();
  let pl = produit ? `${q} × ${produit}` : "—";
  if (produit && couleur) pl += `  (couleur : ${couleur})`;
  return [pl, option ? `${q} × ${option}` : "—"];
}

// ═════════════════════════════════════════════════════════════════════════════
// Couleur automatique selon le stock réel
// ═════════════════════════════════════════════════════════════════════════════
/**
 * Pour chaque arrêt dont la couleur est vide, propose la ou les couleurs à utiliser :
 * - sortie de matériel (Déposer, et Déchargement si les manutentions comptent) :
 *   couleurs les mieux dotées au dépôt (stock « En stock ») ;
 * - retour (Retirer, et Chargement) : couleurs les plus installées chez les clients.
 * Les couleurs choisies à la main sont réservées en premier. Renvoie un tableau de
 * chaînes (« Vert, Bleu ») aligné sur `stops` ; "" quand aucune proposition.
 */
export function allouerCouleurs(stops, stockRows, inclureManutentions = false) {
  const bareme = inclureManutentions ? MVT_ETENDU : MVT;
  const stock = cleanStock(stockRows).map((r) => ({ ...r }));
  const prendre = (article, couleurs, q, champ) => {
    let reste = q;
    const choisies = [];
    const lignes = stock.filter((r) => r.article === article && (!couleurs || couleurs.includes(r.couleur)) && r.couleur)
      .sort((a, b) => b[champ] - a[champ] || ordreCouleur(a.couleur) - ordreCouleur(b.couleur));
    for (const l of lignes) {
      if (reste <= 0) break;
      const part = Math.min(reste, l[champ]);
      if (part > 0) { l[champ] -= part; reste -= part; choisies.push(l.couleur); }
    }
    // Stock insuffisant : on propose la couleur la plus courante pour cet article.
    if (!choisies.length && lignes.length) choisies.push(lignes[0].couleur);
    return choisies;
  };
  const sensDe = (s) => bareme[String(s["Action"] || "").trim()] || 0;
  const champDe = (sens) => (sens < 0 ? "en_stock" : "installes");
  const ok = (s) => String(s["Adresse"] || "").trim() && articleKey(s["Produit"], s["Option"]);
  // 1) réservation des couleurs saisies à la main
  for (const s of stops) {
    const sens = sensDe(s);
    if (!ok(s) || !sens || !String(s["Couleur"] || "").trim()) continue;
    prendre(articleKey(s["Produit"], s["Option"]), couleursArret(s["Couleur"]), Math.max(1, parseInt(s["Quantité"], 10) || 1), champDe(sens));
  }
  // 2) proposition automatique pour les cellules vides
  return stops.map((s) => {
    const sens = sensDe(s);
    if (!ok(s) || !sens || String(s["Couleur"] || "").trim()) return "";
    return couleursTexte(prendre(articleKey(s["Produit"], s["Option"]), null, Math.max(1, parseInt(s["Quantité"], 10) || 1), champDe(sens)));
  });
}
