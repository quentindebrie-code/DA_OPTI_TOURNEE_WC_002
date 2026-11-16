// Classeurs Excel : modèle / export / import de la saisie, stock du parc,
// feuille de tournée (avec récap matériel et fiches d'état des lieux).
// Mise en forme identique à la version Streamlit (openpyxl → ExcelJS).

import { loadExcel } from "./libs.js?v=202611162123";
import { COULEURS_PRODUITS, PRODUITS_CATALOGUE, normTxt, couleursTexte, fmtDate } from "./util.js?v=202611162123";
import { ACTIONS_CATALOGUE, OPTIONS_CATALOGUE, STOPS_COLUMNS, ARTICLES_STOCK, PAUSE_DEJEUNER_MIN,
  ACTION_BG, PIECES_ETAT_LIEUX, ETAT_LIEUX_INTRO, ETAT_LIEUX_INTRO_GENERAL, cleanStock,
  normalizeAction, normalizeProduit, normalizeOption, hhmmFromCell, fmtMin, fmtDuree, prestationParts } from "./metier.js?v=202611162123";
import { pauseSlot } from "./optim.js?v=202611162123";

// ── Styles ───────────────────────────────────────────────────────────────────
const argb = (hex) => "FF" + hex.replace("#", "").toUpperCase();
const fill = (hex) => ({ type: "pattern", pattern: "solid", fgColor: { argb: argb(hex) } });
const thin = { style: "thin", color: { argb: "FFCCCCCC" } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const HDR_FILL = fill("0A6D25");
const HDR_FONT = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
const CENTER = { horizontal: "center", vertical: "middle", wrapText: true };
const LEFT = { horizontal: "left", vertical: "middle", wrapText: true };

function writeRow(ws, r, values) {
  values.forEach((v, i) => { if (v !== undefined && v !== null) ws.getCell(r, i + 1).value = v; });
  return r;
}
function styleRange(ws, r, c1, c2, style) {
  for (let c = c1; c <= c2; c++) Object.assign(ws.getCell(r, c), style);
}
function header(ws, r, labels, height = 20) {
  writeRow(ws, r, labels);
  styleRange(ws, r, 1, labels.length, { fill: HDR_FILL, font: HDR_FONT, alignment: CENTER, border: BORDER });
  ws.getRow(r).height = height;
}
function title(ws, r, text, lastCol, size = 15) {
  ws.mergeCells(r, 1, r, lastCol);
  const c = ws.getCell(r, 1);
  c.value = text;
  c.font = { bold: true, size, color: { argb: "FF0A6D25" } };
  c.alignment = CENTER;
  ws.getRow(r).height = 28;
}
const widths = (ws, list) => list.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

async function newWorkbook() {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Optimiseur de Tournées";
  wb.created = new Date();
  return wb;
}
const buffer = (wb) => wb.xlsx.writeBuffer();

// ── Lecture : valeurs brutes d'une feuille ───────────────────────────────────
function cellValue(v) {
  if (v == null) return "";
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if (v.richText) return v.richText.map((t) => t.text).join("");
    if ("result" in v) return cellValue(v.result);
    if (v.text != null) return v.text;
    if (v.error) return "";
  }
  return v;
}

async function readWorkbook(file) {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  const ext = (file.name || "").split(".").pop().toLowerCase();
  if (["xls", "csv", "ods"].includes(ext)) throw new Error(`Format .${ext} non pris en charge : dans Excel, choisissez Fichier > Enregistrer sous > Classeur Excel (.xlsx), puis importez ce fichier.`);
  try { await wb.xlsx.load(await file.arrayBuffer()); }
  catch { throw new Error("Ce fichier n'a pas pu être lu. Vérifiez qu'il s'agit bien d'un classeur Excel (.xlsx) non protégé."); }
  return wb.worksheets.map((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const vals = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => { vals[c - 1] = cellValue(cell.value); });
      rows[n - 1] = Array.from(vals, (v) => (v === undefined ? "" : v));
    });
    return { name: ws.name, rows: Array.from(rows, (r) => r || []) };
  });
}

/** Trouve la ligne d'en-tête (parmi les 15 premières) qui identifie le plus de colonnes. */
function trouverEntete(rows, role, valide) {
  let best = null;
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const cand = {};
    (rows[i] || []).forEach((v, j) => {
      const brut = String(v ?? "").trim();
      if (brut.length > 40) return;
      const r = role(normTxt(brut));
      if (r && !(r in cand)) cand[r] = j;
    });
    if (valide(cand) && (!best || Object.keys(cand).length > Object.keys(best[1]).length)) best = [i, cand];
  }
  return best;
}

// ═════════════════════════════════════════════════════════════════════════════
// Saisie des arrêts
// ═════════════════════════════════════════════════════════════════════════════
export async function exportStopsExcel(stops, tourDate, driver) {
  const wb = await newWorkbook();
  const ws = wb.addWorksheet("Tournée", { views: [{ state: "frozen", ySplit: 4 }] });
  const wn = wb.addWorksheet("Notice");
  const wl = wb.addWorksheet("Listes");
  wl.state = "hidden";
  const listes = [["Action", ACTIONS_CATALOGUE], ["Produit", PRODUITS_CATALOGUE],
    ["Option", OPTIONS_CATALOGUE], ["Couleur", COULEURS_PRODUITS]];
  listes.forEach(([t, vals], c) => {
    wl.getCell(1, c + 1).value = t;
    wl.getCell(1, c + 1).font = { bold: true };
    vals.forEach((v, i) => { wl.getCell(i + 2, c + 1).value = v; });
  });

  const nc = STOPS_COLUMNS.length;
  title(ws, 1, "SAISIE DE TOURNÉE - DELDOSSI ASSAINISSEMENT", nc);
  const sous = [];
  if (tourDate) sous.push(`Date : ${fmtDate(tourDate)}`);
  if (driver) sous.push(`Chauffeur : ${driver}`);
  sous.push("Seule la colonne « Adresse » est obligatoire.");
  ws.mergeCells(2, 1, 2, nc);
  ws.getCell(2, 1).value = sous.join(" · ");
  ws.getCell(2, 1).font = { italic: true, size: 9, color: { argb: "FF666666" } };
  ws.getCell(2, 1).alignment = CENTER;
  header(ws, 4, STOPS_COLUMNS, 30);

  const lignes = (stops || []).map((s) => STOPS_COLUMNS.map((c) => (c === "Couleur" ? couleursTexte(s[c]) : s[c] ?? "")));
  lignes.forEach((l, i) => writeRow(ws, 5 + i, l));
  const first = 5, last = 4 + Math.max(lignes.length + 40, 40);
  const col = (nom) => STOPS_COLUMNS.indexOf(nom) + 1;
  const letter = (c) => String.fromCharCode(64 + c);
  for (let r = first; r <= last; r++) {
    for (let c = 1; c <= nc; c++) {
      const cell = ws.getCell(r, c);
      cell.border = BORDER;
      cell.alignment = ["Nom du client", "Adresse", "Observations"].includes(STOPS_COLUMNS[c - 1]) ? LEFT : CENTER;
    }
    ws.getCell(r, col("Adresse")).fill = fill("FFF3CD");
    listes.forEach(([nom, vals], k) => {
      ws.getCell(r, col(nom)).dataValidation = { type: "list", allowBlank: true,
        formulae: [`Listes!$${letter(k + 1)}$2:$${letter(k + 1)}$${vals.length + 1}`],
        showErrorMessage: true, errorTitle: "Saisie invalide",
        error: "Valeur non autorisée. Sélectionnez une entrée dans la liste déroulante." };
    });
    for (const [nom, mini, maxi] of [["Quantité", 1, 20], ["Durée (min)", 1, 480]]) {
      ws.getCell(r, col(nom)).dataValidation = { type: "whole", operator: "between", allowBlank: true,
        formulae: [mini, maxi], showErrorMessage: true, errorTitle: "Valeur hors limites",
        error: `Saisissez un nombre entier entre ${mini} et ${maxi}.` };
    }
  }
  widths(ws, [15, 16, 13, 11, 9, 24, 46, 12, 11, 11, 34]);

  // Notice
  wn.mergeCells("A1:C1");
  wn.getCell("A1").value = "NOTICE DE SAISIE – TOURNÉE";
  wn.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF0A6D25" } };
  header(wn, 3, ["Colonne", "Statut", "Explication"]);
  const notice = [
    ["Adresse", "OBLIGATOIRE", "Adresse complète avec code postal et ville. Ex : Place d'Hautpoul 81600 Gaillac. Une ligne sans adresse est ignorée à l'import."],
    ["Action", "Liste déroulante", "Nettoyer · Déposer · Retirer · Chargement · Déchargement. Par défaut : Nettoyer."],
    ["Produit", "Liste déroulante", "WC chimique · WC handicapé · WC Luxe · Lave-main · Urinoir · WC client. Par défaut : WC chimique."],
    ["Option", "Liste déroulante", "Lave-main ou Urinoir. Ne s'applique qu'au WC chimique : la valeur est automatiquement vidée pour les autres produits."],
    ["Couleur", "Facultatif", "Une ou plusieurs couleurs acceptées, séparées par une virgule (ex. Vert, Bleu). La quantité reste le total de la ligne. Laissée vide, la disponibilité est contrôlée toutes couleurs confondues."],
    ["Quantité", "Entier 1 à 20", "Nombre d'unités concernées. Par défaut : 1."],
    ["Nom du client", "Facultatif", "Nom du client ou du site d'intervention."],
    ["Durée (min)", "Entier 1 à 480", "Durée d'intervention sur place. Recalculée automatiquement à l'import selon le barème de l'application ; conservée telle quelle pour les produits hors barème."],
    ["Pas avant", "Format HH:MM", "Heure d'arrivée au plus tôt. Ex : 09:00. Laisser vide si aucune contrainte."],
    ["Pas après", "Format HH:MM", "Heure d'arrivée au plus tard. Ex : 11:30. Laisser vide si aucune contrainte."],
    ["Observations", "Facultatif", "Code portail, contact sur place, consignes particulières…"],
  ];
  notice.forEach((l, i) => {
    const r = writeRow(wn, 4 + i, l);
    styleRange(wn, r, 1, 3, { border: BORDER, alignment: LEFT });
    wn.getCell(r, 1).font = { bold: true };
    if (l[1] === "OBLIGATOIRE") { wn.getCell(r, 2).fill = fill("FFF3CD"); wn.getCell(r, 2).font = { bold: true, color: { argb: "FFB26A00" } }; }
  });
  let r = 4 + notice.length + 1;
  wn.getCell(r, 1).value = "EXEMPLE";
  wn.getCell(r, 1).font = { bold: true, size: 12, color: { argb: "FF0A6D25" } };
  r++;
  wn.mergeCells(r, 1, r, 3);
  wn.getCell(r, 1).value = "Déposer | WC chimique | Lave-main | Vert | 2 | Mairie de Gaillac | Place d'Hautpoul 81600 Gaillac | 40 | 09:00 | (vide) | Code portail 1234";
  wn.getCell(r, 1).font = { italic: true, size: 9, color: { argb: "FF555555" } };
  r += 2;
  wn.mergeCells(r, 1, r, 3);
  wn.getCell(r, 1).value = "L'ordre des lignes n'a aucune importance : l'application recalcule l'itinéraire optimal.";
  wn.getCell(r, 1).font = { italic: true, size: 9, color: { argb: "FF555555" } };
  widths(wn, [20, 18, 88]);
  return buffer(wb);
}

function roleArret(n) {
  if (!n) return null;
  if (n.includes("adresse") || n === "lieu" || n === "site") return "Adresse";
  if (n.includes("action") || n.includes("prestation") || n.includes("intervention")) return "Action";
  if (n.includes("option")) return "Option";
  if (n.includes("couleur") || n.includes("coloris")) return "Couleur";
  if (n.includes("produit") || n.includes("materiel") || n.includes("equipement") || n.includes("article")) return "Produit";
  if (n.startsWith("qte") || n.includes("quantite") || n === "nb" || n.includes("nombre")) return "Quantité";
  if (n.includes("client") || n.includes("nom") || n.includes("societe")) return "Nom du client";
  if (n.includes("duree") || n.includes("temps")) return "Durée (min)";
  if (n.includes("avant") || n.includes("au plus tot") || n.includes("ouverture")) return "Pas avant";
  if (n.includes("apres") || n.includes("au plus tard") || n.includes("fermeture")) return "Pas après";
  if (n.includes("observation") || n.includes("remarque") || n.includes("commentaire") || n.includes("note")) return "Observations";
  return null;
}

/** Lit un classeur de tournée. Retourne { stops, message, avertissements }. */
export async function parseStopsExcel(file) {
  const sheets = await readWorkbook(file);
  const prio = (s) => (/tourn|arret|saisie/.test(normTxt(s.name)) ? 0 : 1);
  let trouve = null;
  for (const sh of [...sheets].sort((a, b) => prio(a) - prio(b))) {
    if (["listes", "notice"].includes(normTxt(sh.name)) || !sh.rows.length) continue;
    const h = trouverEntete(sh.rows, roleArret, (c) => "Adresse" in c);
    if (h) { trouve = [sh, ...h]; break; }
  }
  if (!trouve) {
    throw new Error("Colonne « Adresse » introuvable. Le classeur doit comporter une ligne d'en-tête contenant au minimum une colonne « Adresse ». Utilisez le modèle vierge pour garantir la compatibilité.");
  }
  const [sh, hr, map] = trouve;
  const cell = (row, nom, d = "") => (nom in map ? (row[map[nom]] ?? d) : d);
  const entier = (v, d, mi, ma) => {
    const n = Math.round(parseFloat(String(v).replace(",", ".")));
    return Number.isFinite(n) ? Math.max(mi, Math.min(ma, n)) : d;
  };
  const inconnus = { act: new Set(), prod: new Set(), opt: new Set(), h: new Set() };
  const stops = [];
  for (const row of sh.rows.slice(hr + 1)) {
    const adresse = String(cell(row, "Adresse")).trim();
    if (!adresse || ["nan", "total", "-", "—"].includes(normTxt(adresse))) continue;
    const ab = cell(row, "Action"), pb = cell(row, "Produit"), ob = cell(row, "Option");
    const [action, okA] = normalizeAction(ab);
    const [produit, okP] = normalizeProduit(pb);
    const [option, okO] = normalizeOption(ob);
    if (!okA && String(ab).trim()) inconnus.act.add(String(ab).trim());
    if (!okP && String(pb).trim()) inconnus.prod.add(String(pb).trim());
    if (!okO && String(ob).trim()) inconnus.opt.add(String(ob).trim());
    const pavB = cell(row, "Pas avant"), papB = cell(row, "Pas après");
    const pav = hhmmFromCell(pavB), pap = hhmmFromCell(papB);
    for (const [b, c] of [[pavB, pav], [papB, pap]]) if (String(b).trim() && !c) inconnus.h.add(String(b).trim());
    stops.push({ "Client": "", "Suppr": false, "Action": action, "Produit": produit,
      "Option": produit === "WC chimique" ? option : "", "Couleur": couleursTexte(cell(row, "Couleur")),
      "Quantité": entier(cell(row, "Quantité", 1), 1, 1, 20), "Nom du client": String(cell(row, "Nom du client")).trim(),
      "Adresse": adresse, "Durée (min)": entier(cell(row, "Durée (min)", 30), 30, 1, 480),
      "Pas avant": pav, "Pas après": pap, "Observations": String(cell(row, "Observations")).trim() });
  }
  if (!stops.length) throw new Error(`Aucun arrêt exploitable dans l'onglet « ${sh.name} » : toutes les lignes sont sans adresse.`);
  const av = [];
  const manquantes = STOPS_COLUMNS.filter((c) => !(c in map));
  if (manquantes.length) av.push("Colonnes absentes du fichier, valeurs par défaut appliquées : " + manquantes.join(", "));
  if (inconnus.act.size) av.push("Action non reconnue (remplacée par « Nettoyer ») : " + [...inconnus.act].join(", "));
  if (inconnus.prod.size) av.push("Produit non reconnu (remplacé par « WC chimique ») : " + [...inconnus.prod].join(", "));
  if (inconnus.opt.size) av.push("Option non reconnue (vidée) : " + [...inconnus.opt].join(", "));
  if (inconnus.h.size) av.push("Horaire illisible (ignoré, format attendu HH:MM) : " + [...inconnus.h].join(", "));
  return { stops, message: `${stops.length} arrêt(s) importé(s) depuis l'onglet « ${sh.name} ».`, avertissements: av };
}

// ═════════════════════════════════════════════════════════════════════════════
// Stock du parc
// ═════════════════════════════════════════════════════════════════════════════
function roleStock(n) {
  if (!n) return null;
  if (n.includes("article") || n.includes("produit") || n.includes("reference") || n.includes("designation")) return "article";
  if (n.includes("couleur") || n.includes("coloris")) return "couleur";
  if (n.includes("install") || n.includes("pose") || n.includes("chez le client") || n.includes("parc client")) return "installes";
  if (n.includes("stock") || n.includes("dispo") || n.includes("depot")) return "en_stock";
  return null;
}

export async function parseStockExcel(file) {
  const sheets = await readWorkbook(file);
  const sh = sheets.find((s) => /stock|parc/.test(normTxt(s.name))) || sheets[0];
  if (!sh || !sh.rows.length) throw new Error("Le classeur est vide.");
  // Première ligne qui convient (comme la version Streamlit)
  let h = null;
  for (let i = 0; i < Math.min(15, sh.rows.length) && !h; i++) {
    const t = trouverEntete([sh.rows[i]], roleStock, (c) => "article" in c && ("installes" in c || "en_stock" in c));
    if (t) h = [i, t[1]];
  }
  if (!h) {
    throw new Error(`En-tête introuvable dans l'onglet « ${sh.name} ». Le fichier doit comporter une ligne d'en-tête avec au minimum une colonne « Article » et une colonne « Installés » ou « En stock ».`);
  }
  const [hr, map] = h;
  const exclus = new Set(["total", "totaux", "total general", "somme", "note", "nan"]);
  const rows = sh.rows.slice(hr + 1)
    .map((r) => ({ article: r[map.article] ?? "", couleur: "couleur" in map ? r[map.couleur] ?? "" : "",
      installes: "installes" in map ? r[map.installes] : 0, en_stock: "en_stock" in map ? r[map.en_stock] : 0 }))
    .filter((r) => { const n = normTxt(r.article); return !exclus.has(n) && !n.startsWith("note :"); });
  const clean = cleanStock(rows);
  if (!clean.length) throw new Error(`Aucune ligne exploitable dans l'onglet « ${sh.name} ».`);
  return { rows: clean, message: `${clean.length} référence(s) importée(s) depuis l'onglet « ${sh.name} ».` };
}

export async function exportStockExcel(stock, projete = null, majDate = "") {
  const wb = await newWorkbook();
  const table = (ws, rows, titre) => {
    title(ws, 1, titre, 5, 14);
    let r = 2;
    if (majDate) {
      ws.mergeCells(2, 1, 2, 5);
      ws.getCell(2, 1).value = `État au ${majDate}`;
      ws.getCell(2, 1).font = { italic: true, size: 9, color: { argb: "FF666666" } };
      r = 3;
    }
    r++;
    header(ws, r, ["Article", "Couleur", "Installés", "En stock", "Parc total"]);
    for (const x of rows) {
      r++;
      writeRow(ws, r, [x.article, x.couleur, x.installes, x.en_stock, x.installes + x.en_stock]);
      for (let c = 1; c <= 5; c++) Object.assign(ws.getCell(r, c), { border: BORDER, alignment: c <= 2 ? LEFT : CENTER });
      if (x.en_stock === 0) { ws.getCell(r, 4).fill = fill("F8D7DA"); ws.getCell(r, 4).font = { bold: true, color: { argb: "FFB00020" } }; }
      else if (x.en_stock <= 1) ws.getCell(r, 4).fill = fill("FFF3CD");
    }
    r++;
    const ti = rows.reduce((n, x) => n + x.installes, 0), ts = rows.reduce((n, x) => n + x.en_stock, 0);
    writeRow(ws, r, ["TOTAL", "", ti, ts, ti + ts]);
    styleRange(ws, r, 1, 5, { font: { bold: true }, border: BORDER, fill: fill("D2FFE1") });
    for (let c = 1; c <= 5; c++) ws.getCell(r, c).alignment = c <= 2 ? LEFT : CENTER;
    widths(ws, [30, 14, 12, 12, 12]);
  };
  table(wb.addWorksheet("Stock"), stock, "PARC & STOCK – DELDOSSI ASSAINISSEMENT");

  const ws2 = wb.addWorksheet("Synthèse");
  const couleurs = COULEURS_PRODUITS.filter((c) => stock.some((x) => x.couleur === c));
  const cols = couleurs.length ? couleurs : [""];
  title(ws2, 1, "MATRICE STOCK DISPONIBLE – ARTICLE × COULEUR", Math.max(2, cols.length + 2), 14);
  header(ws2, 3, ["Article", ...cols, "Total"]);
  let r = 3;
  for (const a of ARTICLES_STOCK.filter((a) => stock.some((x) => x.article === a))) {
    r++;
    const vals = cols.map((c) => stock.filter((x) => x.article === a && x.couleur === c).reduce((n, x) => n + x.en_stock, 0));
    writeRow(ws2, r, [a, ...vals, vals.reduce((n, v) => n + v, 0)]);
    for (let c = 1; c <= cols.length + 2; c++) {
      const cell = ws2.getCell(r, c);
      cell.border = BORDER;
      cell.alignment = c === 1 ? LEFT : CENTER;
      if (c > 1 && c <= cols.length + 1 && cell.value === 0) cell.font = { color: { argb: "FFBBBBBB" } };
    }
  }
  ws2.getColumn(1).width = 30;
  for (let c = 2; c <= cols.length + 2; c++) ws2.getColumn(c).width = 12;

  if (projete?.length) table(wb.addWorksheet("Stock projeté"), projete, "PARC & STOCK PROJETÉ APRÈS TOURNÉE");
  return buffer(wb);
}

// ═════════════════════════════════════════════════════════════════════════════
// Feuille de tournée
// ═════════════════════════════════════════════════════════════════════════════
function etatLieuxBlock(ws, r, o) {
  const date = fmtDate(o.tourDate);
  r++;
  title(ws, r, `ÉTAT DES LIEUX – CONTRÔLE DES PIÈCES${o.general ? " (FICHE TOURNÉE)" : ""} – ${date}`, 6);
  const ent = o.general
    ? [["Opérateur", o.driver || "—"], ["Date de la tournée", date], ["Dépôt de départ", o.depot || "—"],
      ["Points d'intervention", o.nbArrets != null ? `${o.nbArrets} arrêt(s)` : "—"], ["Client / site", "(à compléter sur le terrain)"]]
    : [["Opérateur", o.driver || "—"], ["Client / site", o.client || "—"], ["Adresse d'intervention", o.address || "—"],
      ["Nature de l'intervention", o.action || "—"], ["Produit", o.produit || "—"], ["Option", o.option || "—"]];
  for (const [l, v] of ent) {
    r++;
    writeRow(ws, r, [l + " :", v]);
    ws.getCell(r, 1).font = { bold: true };
    ws.mergeCells(r, 2, r, 6);
    ws.getCell(r, 2).alignment = LEFT;
  }
  r++;
  ws.mergeCells(r, 1, r, 6);
  ws.getCell(r, 1).value = o.general ? ETAT_LIEUX_INTRO_GENERAL : ETAT_LIEUX_INTRO;
  ws.getCell(r, 1).font = { italic: true, size: 9, color: { argb: "FF555555" } };
  ws.getCell(r, 1).alignment = { horizontal: "left", vertical: "top", wrapText: true };
  ws.getRow(r).height = 46;
  r += 2;
  header(ws, r, ["N° Article", "Désignation", "Bon état", "À remplacer", "Qté à commander", "Observations"], 22);
  for (const [zone, pieces] of PIECES_ETAT_LIEUX) {
    r++;
    ws.mergeCells(r, 1, r, 6);
    Object.assign(ws.getCell(r, 1), { value: zone, fill: fill("D2FFE1"), border: BORDER,
      font: { bold: true, color: { argb: "FF0A6D25" }, size: 10 }, alignment: { horizontal: "left", vertical: "middle" } });
    for (const [ref, desig] of pieces) {
      r++;
      writeRow(ws, r, [ref, desig, "☐", "☐", "", ""]);
      for (let c = 1; c <= 6; c++) {
        const cell = ws.getCell(r, c);
        cell.border = BORDER;
        cell.alignment = c === 2 || c === 6 ? LEFT : CENTER;
        if (c === 3 || c === 4) cell.font = { size: 13 };
        if (c === 1) cell.font = { bold: true };
      }
      ws.getRow(r).height = 20;
    }
  }
  r += 2;
  ws.mergeCells(r, 1, r, 6);
  Object.assign(ws.getCell(r, 1), { value: "SYNTHÈSE DU CONTRÔLE", fill: HDR_FILL, font: HDR_FONT });
  for (const l of ["État général de l'équipement (Conforme / Réserves / Non conforme) :",
    "Nombre de pièces à remplacer :", "Équipement remis en service (Oui / Non) :"]) {
    r++;
    ws.getCell(r, 1).value = l;
    for (let c = 1; c <= 6; c++) ws.getCell(r, c).border = BORDER;
    ws.mergeCells(r, 1, r, 4);
    ws.mergeCells(r, 5, r, 6);
    ws.getCell(r, 1).font = { bold: true };
    ws.getCell(r, 1).alignment = LEFT;
    ws.getRow(r).height = 20;
  }
  r += 2;
  writeRow(ws, r, ["Date du contrôle :", date, "", "Signature de l'opérateur :"]);
  ws.getCell(r, 1).font = { bold: true };
  ws.getCell(r, 4).font = { bold: true };
  ws.getRow(r).height = 40;
  return r;
}

export async function exportTourneeExcel(res, tourDate, driver) {
  const wb = await newWorkbook();
  const ws = wb.addWorksheet("Feuille de tournée", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const pause = res.pause_dejeuner;
  title(ws, 1, `FEUILLE DE TOURNÉE – ${fmtDate(tourDate)}`, 15);
  const recap = [
    ["Chauffeur", driver || "—"], ["Dépôt de départ", res.depot_depart_addr], ["Dépôt de retour", res.depot_retour_addr],
    ["Ordre des arrêts", res.is_manual ? "Ordre personnalisé" : "Ordre optimisé"],
    ["Distance totale", `${res.distance_km.toFixed(1)} km`], ["Durée estimée", fmtDuree(res.duration_min)],
    ["Carburant estimé", `${res.fuel_liters.toFixed(1)} L  (${res.fuel_cost.toFixed(2)} €)`],
    ["Pause déjeuner", pause ? `${PAUSE_DEJEUNER_MIN} min incluse` : "Non comptée"],
    ["Optimisation", res.km_saved == null || res.is_manual ? "—" : res.km_saved >= 0
      ? `${res.km_saved.toFixed(1).replace(".", ",")} km économisés par rapport à l'ordre de saisie`
      : `${Math.abs(res.km_saved).toFixed(1).replace(".", ",")} km de plus, pour tenir les créneaux`],
  ];
  if (res.is_manual && !res.recalc_ok) recap.push(["Kilométrage", "Distance de l'ordre optimisé (trajet non recalculé)."]);
  let r = 1;
  for (const [l, v] of recap) {
    r++;
    ws.getCell(r, 1).value = l + " :";
    ws.getCell(r, 1).font = { bold: true };
    ws.getCell(r, 2).value = v;
    ws.mergeCells(r, 2, r, 15);
    ws.getCell(r, 2).alignment = LEFT;
  }
  r += 2;
  header(ws, r, ["Ordre", "Action", "Produit", "Option", "Couleur", "Qté", "Nom du client", "Adresse", "Durée (min)",
    "Pas avant", "Pas après", "Arrivée", "Départ", "Observations", "Fait"]);
  const stops = res.stops_ordered;
  stops.forEach((s, i) => {
    r++;
    writeRow(ws, r, [s.order_num, s.action, s.produit, s.option, s.couleur || "—", s.qty_num, s.client, s.address,
      s.duration_min, fmtMin(s.tw_early), fmtMin(s.tw_late), fmtMin(s.arrival_min), fmtMin(s.departure_min), s.observations, ""]);
    for (let c = 1; c <= 15; c++) {
      const cell = ws.getCell(r, c);
      cell.border = BORDER;
      cell.alignment = c === 8 || c === 14 ? LEFT : CENTER;
    }
    if (s.violated) ws.getCell(r, 12).font = { bold: true, color: { argb: "FFDC3545" } };
    if (s.couleur) ws.getCell(r, 5).font = { bold: true, color: { argb: "FF0A6D25" } };
    ws.getCell(r, 2).fill = fill(ACTION_BG[s.action] || "#F0F0F0");
    if (pause && i === res.pause_idx) {
      const [ps, pe] = pauseSlot(stops, i);
      r++;
      writeRow(ws, r, ["", `PAUSE DÉJEUNER — ${PAUSE_DEJEUNER_MIN} min`, "", "", "", "", "", "", PAUSE_DEJEUNER_MIN,
        "", "", ps, pe, `Créneau : ${ps ? ps + " – " + pe : PAUSE_DEJEUNER_MIN + " min"}`, ""]);
      for (let c = 1; c <= 15; c++) Object.assign(ws.getCell(r, c), { fill: fill("FFF9C4"), border: BORDER,
        font: { bold: true, color: { argb: "FF795548" } }, alignment: c === 14 ? LEFT : CENTER });
      ws.mergeCells(r, 2, r, 7);
    }
  });
  r++;
  writeRow(ws, r, ["", "Retour dépôt", "", "", "", "", "", res.depot_retour_addr, "", "", "", fmtMin(res.return_min), "", "", ""]);
  for (let c = 1; c <= 15; c++) Object.assign(ws.getCell(r, c), { fill: fill("FFF3CD"), font: { bold: true },
    border: BORDER, alignment: c === 8 || c === 14 ? LEFT : CENTER });
  widths(ws, [8, 14, 16, 14, 10, 6, 22, 44, 12, 12, 12, 12, 12, 30, 8]);

  const bes = res.besoins_records || [];
  if (bes.length) {
    const wm = wb.addWorksheet("Récap matériel");
    title(wm, 1, `RÉCAP MATÉRIEL – TOURNÉE DU ${fmtDate(tourDate)}`, 6, 14);
    header(wm, 3, ["Article", "Couleur", "À charger au dépôt", "À rapporter au dépôt", "Variation nette", "Stock avant tournée"], 22);
    let rr = 3;
    for (const b of bes) {
      rr++;
      writeRow(wm, rr, [b.article, b.couleur || "Indifférente", b.sorties, b.retours, b.net, b.stockAvant]);
      for (let c = 1; c <= 6; c++) {
        const cell = wm.getCell(rr, c);
        cell.border = BORDER;
        cell.alignment = c <= 2 ? LEFT : CENTER;
        if (b.manque) cell.fill = fill("F8D7DA");
      }
      if (b.manque) wm.getCell(rr, 3).font = { bold: true, color: { argb: "FFB00020" } };
    }
    rr += 2;
    wm.mergeCells(rr, 1, rr, 6);
    wm.getCell(rr, 1).value = "Note : « À charger » correspond aux actions Déposer (et Déchargement si les manutentions sont comptabilisées). « À rapporter » correspond aux actions Retirer.";
    wm.getCell(rr, 1).font = { italic: true, size: 9, color: { argb: "FF666666" } };
    wm.getCell(rr, 1).alignment = { wrapText: true, vertical: "top" };
    wm.getRow(rr).height = 30;
    widths(wm, [30, 16, 20, 22, 16, 20]);
  }

  const we = wb.addWorksheet("État des lieux", { pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  widths(we, [16, 42, 13, 15, 16, 40]);
  if (!res.etat_lieux_par_arret || !stops.length) {
    etatLieuxBlock(we, 0, { general: true, tourDate, driver, nbArrets: stops.length, depot: res.depot_depart_addr });
  } else {
    let er = 0;
    stops.forEach((s, i) => {
      const [pl, ol] = prestationParts(s);
      er = etatLieuxBlock(we, er, { tourDate, driver, client: s.client, address: s.address, action: s.action, produit: pl, option: ol });
      if (i < stops.length - 1) { we.getRow(er).addPageBreak(); er++; }
    });
  }
  return buffer(wb);
}
