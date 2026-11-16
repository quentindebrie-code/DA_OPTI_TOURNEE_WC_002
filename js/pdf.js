// Feuille de tournée PDF (jsPDF + AutoTable) : récapitulatif, arrêts, matériel,
// carte avec fond OpenStreetMap, consignes, annotations, fiches d'état des lieux.

import { loadPdf } from "./libs.js";
import { fmtDate, ACTION_COLORS } from "./util.js";
import { PAUSE_DEJEUNER_MIN, ACTION_BG, ACTION_CONSIGNES, PIECES_ETAT_LIEUX, ETAT_LIEUX_INTRO,
  ETAT_LIEUX_INTRO_GENERAL, fmtMin, fmtDuree, prestationParts } from "./metier.js";
import { pauseSlot } from "./optim.js";

const BLUE = [31, 78, 121];
const GRID = [204, 204, 204];
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.replace("#", "").padStart(6, "0").slice(i - 1, i + 1), 16));

// Les polices standard du PDF ne couvrent que le latin-1 : on remplace le reste.
const MAP_CHARS = { "–": "-", "—": "-", "−": "-", "’": "'", "‘": "'", "“": '"', "”": '"', "…": "...",
  "œ": "oe", "Œ": "OE", "€": "EUR", "≥": ">=", "≤": "<=", "→": "->", "•": "-", " ": " ", " ": " " };
export const t = (s) => String(s ?? "").replace(/[^\u0000-ÿ]/gu, (c) => MAP_CHARS[c] ?? "");

// ── Carte : tuiles OpenStreetMap + tracé, rendue sur un canvas ───────────────
const lon2x = (lon, z) => ((lon + 180) / 360) * 256 * 2 ** z;
const lat2y = (lat, z) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * 2 ** z;
};

function tile(z, x, y) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const timer = setTimeout(() => resolve(null), 8000);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  });
}

export async function renderMapImage(res, W = 1400, H = 960) {
  const pts = [res.depot_coords, res.depot_retour_coords, ...res.stops_ordered.map((s) => [s.lat, s.lon]),
    ...(res.geometry || [])].filter((p) => p && Number.isFinite(p[0]));
  const lats = pts.map((p) => p[0]), lons = pts.map((p) => p[1]);
  const [minLa, maxLa, minLo, maxLo] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
  let z = 16;
  for (; z > 3; z--) {
    if (lon2x(maxLo, z) - lon2x(minLo, z) <= W * 0.86 && lat2y(minLa, z) - lat2y(maxLa, z) <= H * 0.86) break;
  }
  const cx = (lon2x(minLo, z) + lon2x(maxLo, z)) / 2, cy = (lat2y(minLa, z) + lat2y(maxLa, z)) / 2;
  const x0 = cx - W / 2, y0 = cy - H / 2;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext("2d");
  g.fillStyle = "#f0efe7";
  g.fillRect(0, 0, W, H);

  const jobs = [];
  const n = 2 ** z;
  for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + W) / 256); tx++) {
    for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + H) / 256); ty++) {
      if (ty < 0 || ty >= n) continue;
      jobs.push(tile(z, ((tx % n) + n) % n, ty).then((img) => img && g.drawImage(img, tx * 256 - x0, ty * 256 - y0)));
    }
  }
  await Promise.all(jobs);
  const P = ([la, lo]) => [lon2x(lo, z) - x0, lat2y(la, z) - y0];

  if (res.geometry?.length > 1) {
    g.lineJoin = g.lineCap = "round";
    for (const [w, c] of [[9, "rgba(255,255,255,0.9)"], [5, "#1f4e79"]]) {
      g.beginPath();
      res.geometry.forEach((p, i) => { const [x, y] = P(p); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.strokeStyle = c; g.lineWidth = w; g.stroke();
    }
  }
  const square = (p, label, color) => {
    const [x, y] = P(p);
    g.fillStyle = color; g.strokeStyle = "#fff"; g.lineWidth = 3;
    g.beginPath(); g.rect(x - 16, y - 16, 32, 32); g.fill(); g.stroke();
    g.fillStyle = "#fff"; g.font = "bold 18px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(label, x, y + 1);
  };
  const same = res.depot_retour_coords[0] === res.depot_coords[0] && res.depot_retour_coords[1] === res.depot_coords[1];
  if (!same) square(res.depot_retour_coords, "R", "#b91c1c");
  square(res.depot_coords, same ? "D" : "D", "#b45309");
  for (const s of res.stops_ordered) {
    const [x, y] = P([s.lat, s.lon]);
    g.fillStyle = ACTION_COLORS[s.action] || "#555"; g.strokeStyle = "#fff"; g.lineWidth = 3;
    g.beginPath(); g.arc(x, y, 15, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = "#fff"; g.font = "bold 15px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(String(s.order_num), x, y + 1);
  }
  g.font = "13px sans-serif"; g.textAlign = "right"; g.textBaseline = "bottom";
  g.fillStyle = "rgba(255,255,255,0.85)"; g.fillRect(W - 190, H - 22, 190, 22);
  g.fillStyle = "#333"; g.fillText("© OpenStreetMap contributors", W - 6, H - 5);
  return canvas.toDataURL("image/jpeg", 0.85);
}

// ── Construction du document ────────────────────────────────────────────────
function checkbox(doc, x, y, s = 3.4) {
  doc.setDrawColor(85); doc.setLineWidth(0.25); doc.setFillColor(255, 255, 255);
  doc.rect(x, y, s, s, "FD");
}

function hr(doc, y) {
  doc.setDrawColor(...BLUE); doc.setLineWidth(0.4); doc.line(8, y, 202, y);
}

function sectionTitle(doc, y, text, size = 12) {
  if (y > 270) { doc.addPage(); y = 14; }
  hr(doc, y); y += 6;
  doc.setFont("helvetica", "bold"); doc.setFontSize(size); doc.setTextColor(...BLUE);
  doc.text(t(text), 8, y);
  doc.setTextColor(0);
  return y + 3;
}

function etatLieuxPage(doc, o) {
  doc.addPage();
  const date = fmtDate(o.tourDate);
  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(...BLUE);
  doc.text(t(`ÉTAT DES LIEUX – CONTRÔLE DES PIÈCES${o.general ? " (FICHE TOURNÉE)" : ""}`), 105, 16, { align: "center" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(120);
  const sous = o.general ? `Tournée du ${date}${o.nbArrets != null ? ` - ${o.nbArrets} arrêt(s)` : ""}`
    : o.index ? `Fiche ${o.index} / ${o.total} - ${date}` : date;
  doc.text(t(sous), 105, 22, { align: "center" });
  hr(doc, 25);
  doc.setTextColor(0);

  const L = (s) => ({ content: t(s), styles: { fontStyle: "bold" } });
  const body = o.general
    ? [[L("Opérateur :"), t(o.driver || "—"), L("Date :"), date],
      [L("Points d'intervention :"), { content: t(o.nbArrets != null ? `${o.nbArrets} arrêt(s)` : "—"), colSpan: 3 }],
      [{ content: t(`Dépôt de départ :  ${o.depot || "—"}`), colSpan: 4 }],
      [{ content: t("Client / site :  (à compléter sur le terrain)"), colSpan: 4 }]]
    : [[L("Opérateur :"), t(o.driver || "—"), L("Nature de l'intervention :"), t(o.action || "—")],
      [L("Client / site :"), t(o.client || "—"), L("Produit :"), t(o.produit || "—")],
      [{ content: t(`Option :  ${o.option || "—"}`), colSpan: 4 }],
      [{ content: t(`Adresse d'intervention :  ${o.address || "—"}`), colSpan: 4 }]];
  doc.autoTable({ startY: 28, body, theme: "grid", margin: { left: 8, right: 8 },
    styles: { fontSize: 9, cellPadding: 1.6, lineColor: [229, 229, 229], lineWidth: 0.2 },
    columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: 57 }, 2: { cellWidth: 42 }, 3: { cellWidth: 55 } } });
  let y = doc.lastAutoTable.finalY + 5;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(85);
  const intro = doc.splitTextToSize(t(o.general ? ETAT_LIEUX_INTRO_GENERAL : ETAT_LIEUX_INTRO), 194);
  doc.text(intro, 8, y);
  y += intro.length * 4 + 2;
  doc.setTextColor(0);

  const rows = [];
  for (const [zone, pieces] of PIECES_ETAT_LIEUX) {
    rows.push([{ content: t(zone), colSpan: 6, styles: { fillColor: [220, 230, 241], fontStyle: "bold", textColor: BLUE } }]);
    for (const [ref, desig] of pieces) rows.push([{ content: ref, styles: { fontStyle: "bold" } }, t(desig), "", "", "", ""]);
  }
  doc.autoTable({ startY: y, head: [[t("N° Article"), t("Désignation"), t("Bon état"), t("À remplacer"), t("Qté à commander"), "Observations"]],
    body: rows, theme: "grid", margin: { left: 8, right: 8 },
    styles: { fontSize: 9, cellPadding: 1.8, lineColor: GRID, lineWidth: 0.2, valign: "middle", minCellHeight: 7 },
    headStyles: { fillColor: BLUE, textColor: 255, halign: "center", fontSize: 8.5 },
    columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 62 }, 2: { cellWidth: 16 }, 3: { cellWidth: 20 }, 4: { cellWidth: 22 }, 5: { cellWidth: 54 } },
    didDrawCell: (d) => {
      if (d.section === "body" && (d.column.index === 2 || d.column.index === 3) && d.row.raw.length === 6) {
        checkbox(doc, d.cell.x + d.cell.width / 2 - 1.7, d.cell.y + d.cell.height / 2 - 1.7);
      }
    } });
  y = doc.lastAutoTable.finalY + 6;
  if (y > 235) { doc.addPage(); y = 14; }
  y = sectionTitle(doc, y, "Synthèse du contrôle");
  const opts = [["Conforme", "Conforme avec réserves", "Non conforme"], null, ["Oui", "Non"]];
  doc.autoTable({ startY: y + 1, theme: "grid", margin: { left: 8, right: 8 },
    body: [[t("État général de l'équipement :"), ""], [t("Nombre de pièces à remplacer :"), ""], [t("Équipement remis en service :"), ""]],
    styles: { fontSize: 9, cellPadding: 2.4, lineColor: GRID, lineWidth: 0.2, valign: "middle", minCellHeight: 8 },
    columnStyles: { 0: { cellWidth: 62, fontStyle: "bold" }, 1: { cellWidth: 132 } },
    didDrawCell: (d) => {
      const list = opts[d.row.index];
      if (d.section !== "body" || d.column.index !== 1 || !list) return;
      let x = d.cell.x + 2;
      const cy = d.cell.y + d.cell.height / 2;
      doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      for (const lab of list) {
        checkbox(doc, x, cy - 1.7);
        doc.text(t(lab), x + 5, cy + 1.2);
        x += 9 + doc.getTextWidth(t(lab));
      }
    } });
  y = doc.lastAutoTable.finalY + 8;
  if (y > 260) { doc.addPage(); y = 14; }
  doc.setDrawColor(...GRID); doc.setLineWidth(0.25);
  doc.rect(8, y, 97, 26); doc.rect(105, y, 97, 26);
  doc.setFont("helvetica", "bold"); doc.setFontSize(9);
  doc.text(t(`Date du contrôle : ${date}`), 10, y + 5);
  doc.text(t("Signature de l'opérateur :"), 107, y + 5);
}

export async function exportTourneePdf(res, tourDate, driver) {
  const JsPDF = await loadPdf();
  const doc = new JsPDF({ unit: "mm", format: "a4" });
  const pause = res.pause_dejeuner;
  const stops = res.stops_ordered;

  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(...BLUE);
  doc.text(t(`FEUILLE DE TOURNÉE – ${fmtDate(tourDate)}`), 105, 15, { align: "center" });
  hr(doc, 18);
  doc.setTextColor(0);

  const recap = [
    ["Chauffeur :", driver || "—"], ["Dépôt de départ :", res.depot_depart_addr], ["Dépôt de retour :", res.depot_retour_addr],
    ["Ordre des arrêts :", res.is_manual ? "Ordre personnalisé manuellement (prioritaire sur l'optimisation)" : "Ordre optimisé automatiquement"],
    ["Distance totale :", `${res.distance_km.toFixed(1)} km`], ["Durée de trajet :", fmtDuree(res.duration_min)],
    ["Carburant estimé :", `${res.fuel_liters.toFixed(1)} L  (${res.fuel_cost.toFixed(2)} €)`],
    ["Départ / retour dépôt :", `${fmtMin(res.depart_min)} → ${fmtMin(res.return_min)}`],
    ["Pause déjeuner :", pause ? `${PAUSE_DEJEUNER_MIN} min incluse` : "Non comptée"],
    ["Économie optimisation :", `-${res.km_saved.toFixed(1)} km  /  -${Math.round(res.time_saved_min)} min`],
  ];
  if (res.is_manual && !res.recalc_ok) recap.push(["Kilométrage :", "Service d'itinéraire indisponible : distance et durée sont celles de l'ordre optimisé. L'ordre des arrêts ci-dessous est l'ordre manuel."]);
  doc.autoTable({ startY: 21, body: recap.map(([a, b]) => [t(a), t(b)]), theme: "plain", margin: { left: 8, right: 8 },
    styles: { fontSize: 9.5, cellPadding: 1.4 }, alternateRowStyles: { fillColor: [245, 245, 245] },
    columnStyles: { 0: { cellWidth: 55, fontStyle: "bold" }, 1: { cellWidth: 139 } } });

  const depotRow = (label, addr, arr, dep) => [{ content: "", styles: {} }, { content: t(label), styles: { fontStyle: "bold" } },
    "", "", "", "", "", { content: t(addr), styles: { fontStyle: "bold" } }, "", "", "", t(arr), t(dep), ""]
    .map((c) => (typeof c === "object" ? { ...c, styles: { ...c.styles, fillColor: [255, 243, 205] } } : { content: c, styles: { fillColor: [255, 243, 205] } }));
  const body = [depotRow("Dépôt départ", res.depot_depart_addr, "", fmtMin(res.depart_min))];
  stops.forEach((s, i) => {
    body.push([String(s.order_num),
      { content: t(s.action), styles: { fillColor: rgb(ACTION_BG[s.action] || "#F0F0F0"), fontStyle: "bold", textColor: BLUE } },
      t(s.produit), t(s.option), { content: t(s.couleur || "—"), styles: s.couleur ? { fontStyle: "bold", textColor: BLUE } : {} },
      String(s.qty_num), t(s.client), t(s.address), String(s.duration_min || ""), fmtMin(s.tw_early), fmtMin(s.tw_late),
      { content: fmtMin(s.arrival_min), styles: s.violated ? { textColor: [220, 53, 69], fontStyle: "bold" } : {} },
      fmtMin(s.departure_min), t(s.observations)]);
    if (pause && i === res.pause_idx) {
      const [ps, pe] = pauseSlot(stops, i);
      const st = { fillColor: [255, 249, 196], textColor: [121, 85, 72], fontStyle: "bold" };
      body.push(["", { content: t("Pause déjeuner"), colSpan: 7 }, String(PAUSE_DEJEUNER_MIN), "", "", ps, pe,
        t(`Créneau : ${ps ? ps + " - " + pe : PAUSE_DEJEUNER_MIN + " min"}`)]
        .map((c) => (typeof c === "object" ? { ...c, styles: st } : { content: c, styles: st })));
    }
  });
  body.push(depotRow("Dépôt retour", res.depot_retour_addr, fmtMin(res.return_min), ""));
  doc.autoTable({ startY: doc.lastAutoTable.finalY + 6, margin: { left: 8, right: 8 }, theme: "grid",
    head: [["N°", "Action", "Produit", "Option", "Coul.", t("Qté"), "Client", "Adresse", "Min", "Pav.", "Pap.", "Arr.", t("Dép."), "Obs."]],
    body, styles: { fontSize: 7.2, cellPadding: 1.1, lineColor: GRID, lineWidth: 0.2, valign: "top", overflow: "linebreak" },
    headStyles: { fillColor: BLUE, textColor: 255, halign: "center", fontStyle: "bold" },
    alternateRowStyles: { fillColor: [249, 249, 249] },
    columnStyles: { 0: { cellWidth: 7, halign: "center" }, 1: { cellWidth: 21 }, 2: { cellWidth: 20 }, 3: { cellWidth: 14 },
      4: { cellWidth: 14 }, 5: { cellWidth: 7, halign: "center" }, 6: { cellWidth: 16 }, 7: { cellWidth: 28 },
      8: { cellWidth: 9, halign: "center" }, 9: { cellWidth: 10, halign: "center" }, 10: { cellWidth: 10, halign: "center" },
      11: { cellWidth: 10, halign: "center" }, 12: { cellWidth: 10, halign: "center" }, 13: { cellWidth: 18 } } });
  let y = doc.lastAutoTable.finalY + 6;

  const bes = res.besoins_records || [];
  if (bes.length) {
    y = sectionTitle(doc, y, "Matériel à charger au départ du dépôt");
    doc.autoTable({ startY: y + 1, margin: { left: 8, right: 8 }, theme: "grid",
      head: [["Article", "Couleur", t("À charger"), t("À rapporter"), "Variation", "Stock avant tournée"]],
      body: bes.map((b) => [t(b.article), t(b.couleur || "Indifférente"), String(b.sorties), String(b.retours),
        (b.net > 0 ? "+" : "") + b.net, t(b.stockAvant)].map((c) => (b.manque ? { content: c, styles: { fillColor: [248, 215, 218] } } : c))),
      styles: { fontSize: 8.5, cellPadding: 1.4, lineColor: GRID, lineWidth: 0.2, halign: "center" },
      headStyles: { fillColor: BLUE, textColor: 255 },
      columnStyles: { 0: { cellWidth: 52, halign: "left" }, 1: { cellWidth: 26, halign: "left" }, 2: { cellWidth: 22 },
        3: { cellWidth: 24 }, 4: { cellWidth: 22 }, 5: { cellWidth: 48 } } });
    y = doc.lastAutoTable.finalY + 4;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(102);
    doc.text(t("Les lignes surlignées en rouge signalent un stock insuffisant au moment de la préparation de la tournée."), 8, y);
    doc.setTextColor(0);
    y += 6;
  }

  // Carte
  if (y > 150) { doc.addPage(); y = 14; }
  y = sectionTitle(doc, y, "Carte de la tournée");
  try {
    const img = await renderMapImage(res);
    doc.addImage(img, "JPEG", 17.5, y + 1, 175, 120);
  } catch (e) {
    doc.setFontSize(9); doc.text(t("(Carte non disponible : " + e.message + ")"), 8, y + 6);
  }
  y += 127;

  // Consignes
  const vues = [...new Set(stops.map((s) => s.action))];
  const consignes = Object.entries(ACTION_CONSIGNES).filter(([a]) => vues.includes(a));
  if (consignes.length) {
    if (y > 240) { doc.addPage(); y = 14; }
    y = sectionTitle(doc, y, "Consignes par type d'intervention");
    for (const [action, lignes] of consignes) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      const txt = doc.splitTextToSize(t(lignes.join(" ")), 190);
      if (y + 9 + txt.length * 4 > 285) { doc.addPage(); y = 14; }
      doc.setFillColor(...rgb(ACTION_COLORS[action] || "#555555"));
      doc.rect(8, y + 1, 194, 6.5, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(255);
      doc.text(t(action), 11, y + 5.6);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(0);
      doc.text(txt, 10, y + 12);
      y += 12 + txt.length * 4 + 2;
    }
  }

  // Annotations
  if (y > 190) { doc.addPage(); y = 14; }
  y = sectionTitle(doc, y, "Annotations / Observations", 11);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(120);
  doc.text(t("À remplir par le chauffeur durant ou à l'issue de la tournée :"), 8, y + 2);
  doc.setTextColor(0); doc.setDrawColor(...GRID); doc.setLineWidth(0.25);
  for (let i = 0; i < 8; i++) doc.rect(8, y + 4 + i * 10, 194, 10);

  // États des lieux
  if (res.etat_lieux_par_arret && stops.length) {
    stops.forEach((s, i) => {
      const [pl, ol] = prestationParts(s);
      etatLieuxPage(doc, { tourDate, driver, client: s.client, address: s.address, action: s.action,
        produit: pl, option: ol, index: i + 1, total: stops.length });
    });
  } else {
    etatLieuxPage(doc, { general: true, tourDate, driver, nbArrets: stops.length, depot: res.depot_depart_addr });
  }

  // Pied de page sur chaque page
  const n = doc.getNumberOfPages();
  const gen = new Date().toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  for (let p = 1; p <= n; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(140);
    doc.text(t(`Généré le ${gen} - Optimiseur de Tournées`), 8, 292);
    doc.text(`${p} / ${n}`, 202, 292, { align: "right" });
  }
  return doc.output("blob");
}
