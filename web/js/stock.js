// Écran « Stock » : état du parc, tableau article × couleur, correction des quantités,
// impact de la tournée en cours (couleurs automatiques comprises).

import { icon } from "./icons.js?v=202611162123";
import { COULEURS_PRODUITS, PASTILLE, esc, toast, confirmer, fmtDateHeure, moveInk, withBusy } from "./util.js?v=202611162123";
import { ARTICLES_STOCK, stockDefaut, cleanStock, besoinsTournee, controleDisponibilite, projeterStock } from "./metier.js?v=202611162123";
import { S, on, emit, saveStock, stopsEffectifs } from "./state.js?v=202611162123";
import { telecharger, XLSX_MIME } from "./libs.js?v=202611162123";

const STATUT = { rupture: ["x-circle", "Rupture"], juste: ["alert", "Juste"], ok: ["check-circle", "Disponible"] };
const past = (c) => (c ? `<i class="pastille" style="--pc:${PASTILLE[c] || "#ccc"}"></i>${esc(c)}` : "Au choix");

export function initStock(root) {
  let metrique = "en_stock";
  let filtreCouleurs = null, filtreArticles = null;
  let draft = null, edition = false;

  const jour = () => new Date().toLocaleDateString("fr-FR");
  const fichierJour = () => jour().replaceAll("/", "-");

  function render() {
    const stock = S.stock;
    const ti = stock.reduce((n, r) => n + r.installes, 0), ts = stock.reduce((n, r) => n + r.en_stock, 0);
    const rupt = stock.filter((r) => r.en_stock === 0).length;
    const couleurs = [...COULEURS_PRODUITS.filter((c) => stock.some((r) => r.couleur === c)),
      ...[...new Set(stock.map((r) => r.couleur))].filter((c) => c && !COULEURS_PRODUITS.includes(c)).sort()];
    if (stock.some((r) => !r.couleur)) couleurs.push("");
    const articles = [...ARTICLES_STOCK.filter((a) => stock.some((r) => r.article === a)),
      ...[...new Set(stock.map((r) => r.article))].filter((a) => !ARTICLES_STOCK.includes(a)).sort()];
    const fc = (filtreCouleurs || couleurs).filter((c) => couleurs.includes(c));
    const fa = (filtreArticles || articles).filter((a) => articles.includes(a));
    draft ||= stock.map((r) => ({ ...r }));

    root.innerHTML = `
      <div class="page-head">
        <div><span class="eyebrow">Parc de matériel</span><h1>Stock</h1>
          <p>${S.stockError ? "Non synchronisé : les changements restent sur cet appareil." : S.stockMaj ? `Mis à jour le ${esc(fmtDateHeure(S.stockMaj))}` : "Relevé de référence, à mettre à jour"}</p></div>
        <div class="head-actions">
          <label class="btn btn-file">${icon("upload")}<span>Importer</span><input type="file" accept=".xlsx,.xlsm,.xls,.csv" data-act="import" aria-label="Importer le fichier de stock"></label>
          <button class="btn" data-act="export">${icon("download")}<span>Exporter</span></button>
        </div>
      </div>

      <div class="stats" style="margin-bottom:16px">
        <div class="stat glass"><b>${ti + ts}</b><span>unités au total</span></div>
        <div class="stat glass"><b>${ts}</b><span>au dépôt</span></div>
        <div class="stat glass"><b>${ti}</b><span>chez les clients</span></div>
        <div class="stat glass"><b>${rupt}</b><span>référence${rupt > 1 ? "s" : ""} en rupture</span></div>
      </div>

      <section class="glass impact"></section>

      <section class="glass">
        <div class="card-title">${icon("layers")}<span>Par produit et couleur</span>
          <div class="seg push" role="group" aria-label="Donnée affichée"><span class="ink"></span>${[["en_stock", "Dépôt"], ["installes", "Clients"], ["total", "Total"]].map(([k, l]) =>
            `<button data-metric="${k}" aria-pressed="${k === metrique}">${l}</button>`).join("")}</div></div>
        <div class="filter-bar">
          <div class="filter-row"><b>Couleurs</b>${couleurs.map((c) => `<label class="chip"><input type="checkbox" data-fc="${esc(c)}"${fc.includes(c) ? " checked" : ""}>${past(c)}</label>`).join("")}
            <button class="btn-link" data-all="c">${fc.length === couleurs.length ? "Aucune" : "Toutes"}</button></div>
          <div class="filter-row"><b>Articles</b>${articles.map((a) => `<label class="chip"><input type="checkbox" data-fa="${esc(a)}"${fa.includes(a) ? " checked" : ""}>${esc(a)}</label>`).join("")}
            <button class="btn-link" data-all="a">${fa.length === articles.length ? "Aucun" : "Tous"}</button></div>
          ${metrique === "en_stock" ? `<label class="seuil">Alerte à partir de <b>${S.seuilAlerte}</b><input type="range" min="0" max="5" value="${S.seuilAlerte}" data-act="seuil" aria-label="Seuil d'alerte"></label>` : ""}
        </div>
        <div class="table-wrap">${matrice(stock, fa, fc)}</div>
      </section>

      <section class="glass">
        <div class="card-title">${icon("edit")}<span>Corriger les quantités</span>
          ${edition ? "" : `<button class="btn btn-sm push" data-act="edit">${icon("edit")}<span>Modifier</span></button>`}</div>
        ${edition ? editeur() : `<p class="small muted">Ajustez le stock si le relevé a évolué depuis le dernier import.</p>`}
      </section>

      <details class="glass">
        <summary class="row" style="list-style:none;cursor:pointer"><b>Règles et outils</b>${icon("chevron-down", "chev")}</summary>
        <div class="details-body stack" style="margin-top:12px">
          <label class="switch"><input type="checkbox" data-act="manut"${S.stockManutentions ? " checked" : ""}><span>Compter Chargement et Déchargement comme des mouvements
            <span class="hint">Chargement = retour au dépôt, Déchargement = dépose sur site</span></span></label>
          <p class="small muted">Déposer : une unité quitte le dépôt. Retirer : elle revient. Nettoyer : aucun mouvement. Sans couleur imposée, l'outil choisit la couleur la mieux disponible.</p>
          <div class="row"><button class="btn btn-sm" data-act="template">${icon("sheet")}<span>Modèle vierge</span></button>
            <button class="btn btn-sm btn-danger-ghost" data-act="restore" style="margin-left:auto">${icon("undo")}<span>Revenir au relevé de référence</span></button></div>
        </div>
      </details>`;
    renderImpact();
    requestAnimationFrame(() => moveInk(root.querySelector(".seg"), root.querySelector(`[data-metric="${metrique}"]`)));
  }

  function matrice(stock, articles, couleurs) {
    if (!articles.length || !couleurs.length) return `<p class="empty">Aucune référence pour ces filtres.</p>`;
    const totCol = couleurs.map(() => 0);
    let totGen = 0;
    const lignes = articles.map((a) => {
      let tl = 0;
      const tds = couleurs.map((c, j) => {
        const sub = stock.filter((r) => r.article === a && r.couleur === c);
        const v = sub.reduce((n, r) => n + (metrique === "total" ? r.installes + r.en_stock : r[metrique]), 0);
        tl += v; totCol[j] += v;
        if (metrique === "en_stock" && sub.length && v === 0) return `<td class="num m-rupt" title="Rupture">${icon("x-circle")}0</td>`;
        if (metrique === "en_stock" && sub.length && v <= S.seuilAlerte) return `<td class="num m-tens" title="Stock bas">${icon("alert")}${v}</td>`;
        return `<td class="num${v === 0 ? " m-zero" : ""}">${v !== 0 || sub.length ? v : "·"}</td>`;
      }).join("");
      totGen += tl;
      return `<tr><th>${esc(a)}</th>${tds}<td class="num"><b>${tl}</b></td></tr>`;
    }).join("");
    return `<table class="table matrice"><thead><tr><th>Article</th>${couleurs.map((c) => `<th class="num">${past(c)}</th>`).join("")}<th class="num">Total</th></tr></thead>
      <tbody>${lignes}<tr class="m-total"><th>Total</th>${totCol.map((v) => `<td class="num">${v}</td>`).join("")}<td class="num">${totGen}</td></tr></tbody></table>`;
  }

  function editeur() {
    return `<div class="table-wrap"><table class="table">
      <thead><tr><th>Article</th><th>Couleur</th><th class="num">Clients</th><th class="num">Dépôt</th><th></th></tr></thead>
      <tbody>${draft.map((r, i) => `<tr data-i="${i}">
        <td><select data-f="article" style="min-width:190px">${[...new Set([...ARTICLES_STOCK, r.article])].map((a) => `<option${a === r.article ? " selected" : ""}>${esc(a)}</option>`).join("")}</select></td>
        <td><select data-f="couleur">${[...new Set(["", ...COULEURS_PRODUITS, r.couleur])].map((c) => `<option value="${esc(c)}"${c === r.couleur ? " selected" : ""}>${esc(c || "Sans")}</option>`).join("")}</select></td>
        <td class="num"><input type="number" min="0" max="999" inputmode="numeric" style="width:5.5rem" data-f="installes" value="${r.installes}"></td>
        <td class="num"><input type="number" min="0" max="999" inputmode="numeric" style="width:5.5rem" data-f="en_stock" value="${r.en_stock}"></td>
        <td><button class="btn btn-sm btn-icon btn-danger-ghost" data-act="del-row" aria-label="Retirer la ligne">${icon("trash")}</button></td></tr>`).join("")}</tbody>
    </table></div>
    <div class="row" style="margin-top:12px"><button class="btn btn-sm" data-act="add-row">${icon("plus")}<span>Ajouter une ligne</span></button>
      <span style="margin-left:auto" class="row"><button class="btn btn-sm btn-ghost" data-act="cancel">Annuler</button>
      <button class="btn btn-sm btn-primary" data-act="apply">${icon("save")}<span>Enregistrer</span></button></span></div>`;
  }

  function renderImpact() {
    const box = root.querySelector(".impact");
    if (!box) return;
    const bes = besoinsTournee(stopsEffectifs(), S.stockManutentions);
    if (!bes.length) {
      box.innerHTML = `<div class="card-title">${icon("route")}<span>Tournée en cours</span></div>
        <p class="small muted">Aucun matériel à sortir ni à rapporter pour l'instant.</p>`;
      return;
    }
    const ctl = controleDisponibilite(S.stock, bes);
    const manq = ctl.filter((x) => x.manque > 0).length;
    const proj = projeterStock(S.stock, bes);
    const avant = new Map(S.stock.map((r) => [r.article + "|" + r.couleur, r.en_stock]));
    const diff = proj.map((r) => ({ ...r, avant: avant.get(r.article + "|" + r.couleur) || 0 })).filter((r) => r.en_stock !== r.avant);
    box.innerHTML = `<div class="card-title">${icon("route")}<span>Tournée en cours</span>
        <span class="badge ${manq ? "badge-err" : ""} push">${manq ? `${manq} rupture${manq > 1 ? "s" : ""}` : "Matériel disponible"}</span></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Article</th><th>Couleur</th><th class="num">À charger</th><th class="num">À rapporter</th><th class="num">Dépôt après</th><th>État</th></tr></thead>
      <tbody>${bes.map((b) => {
        const c = ctl.find((x) => x.article === b.article && (x.couleur === b.couleur || (!b.couleur && x.couleur === "Toutes couleurs")));
        const apres = proj.filter((r) => r.article === b.article && (!b.couleur || b.couleur.split(", ").includes(r.couleur))).reduce((n, r) => n + r.en_stock, 0);
        const st = c ? STATUT[c.statut] : ["check-circle", "Retour"];
        return `<tr><td>${esc(b.article)}</td><td>${b.couleur ? b.couleur.split(", ").map(past).join(" ") : "Au choix"}</td><td class="num">${b.sorties}</td><td class="num">${b.retours}</td>
          <td class="num">${apres}</td><td><span class="badge ${c?.statut === "rupture" ? "badge-err" : c?.statut === "juste" ? "badge-warn" : ""}">${icon(st[0])}${st[1]}</span></td></tr>`;
      }).join("")}</tbody></table></div>
      ${diff.length ? `<div class="row" style="margin-top:12px"><button class="btn btn-sm" data-act="export-proj">${icon("download")}<span>Exporter le stock après tournée</span></button></div>` : ""}`;
  }

  // ── Événements ─────────────────────────────────────────────────────────────
  root.addEventListener("change", async (e) => {
    const el = e.target;
    if (el.dataset.act === "import") {
      const file = el.files[0];
      el.value = "";
      if (!file) return;
      try {
        const { parseStockExcel } = await import("./xlsx.js?v=202611162123");
        const { rows, message } = await parseStockExcel(file);
        const avant = structuredClone(S.stock);
        draft = null;
        await saveStock(rows, null);
        toast(message, "ok", { action: { label: "Annuler", run: () => saveStock(avant, "Stock rétabli") } });
      } catch (err) { toast(err.message, "err"); }
    } else if (el.dataset.act === "manut") {
      S.stockManutentions = el.checked; emit("stock"); emit("params");
    } else if (el.dataset.act === "seuil") {
      S.seuilAlerte = Number(el.value); emit("params"); render();
    } else if (el.dataset.fc !== undefined || el.dataset.fa !== undefined) {
      filtreCouleurs = [...root.querySelectorAll("[data-fc]:checked")].map((x) => x.dataset.fc);
      filtreArticles = [...root.querySelectorAll("[data-fa]:checked")].map((x) => x.dataset.fa);
      render();
    } else if (el.dataset.f) {
      const r = draft[Number(el.closest("tr").dataset.i)];
      r[el.dataset.f] = el.type === "number" ? Math.max(0, parseInt(el.value, 10) || 0) : el.value;
    }
  });
  root.addEventListener("input", (e) => { if (e.target.dataset.act === "seuil") e.target.previousElementSibling.textContent = e.target.value; });
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act], [data-metric], [data-all]");
    if (!b || b.tagName === "INPUT") return;
    if (b.dataset.metric) { metrique = b.dataset.metric; render(); return; }
    if (b.dataset.all) {
      const sel = b.dataset.all === "c" ? "[data-fc]" : "[data-fa]";
      const boxes = [...root.querySelectorAll(sel)];
      const tous = boxes.every((x) => x.checked);
      if (b.dataset.all === "c") filtreCouleurs = tous ? [] : null; else filtreArticles = tous ? [] : null;
      render();
      return;
    }
    const act = b.dataset.act;
    try {
      const { exportStockExcel } = await import("./xlsx.js?v=202611162123");
      if (act === "export") telecharger(await exportStockExcel(S.stock, null, jour()), `Stock_${fichierJour()}.xlsx`, XLSX_MIME);
      else if (act === "template") telecharger(await exportStockExcel(cleanStock(stockDefaut()).map((r) => ({ ...r, installes: 0, en_stock: 0 })), null, jour()), "Modele_stock.xlsx", XLSX_MIME);
      else if (act === "export-proj") telecharger(await exportStockExcel(S.stock, projeterStock(S.stock, besoinsTournee(stopsEffectifs(), S.stockManutentions)), jour()), `Stock_apres_tournee_${fichierJour()}.xlsx`, XLSX_MIME);
      else if (act === "restore") {
        if (!await confirmer("Revenir au relevé de référence ?", "Le stock actuel sera remplacé.", "Remplacer")) return;
        const avant = structuredClone(S.stock);
        draft = null;
        await saveStock(stockDefaut(), null);
        toast("Relevé de référence rétabli", "ok", { action: { label: "Annuler", run: () => saveStock(avant, "Stock rétabli") } });
      } else if (act === "edit") { edition = true; draft = S.stock.map((r) => ({ ...r })); render(); root.querySelector("[data-f]")?.focus(); }
      else if (act === "add-row") { draft.push({ article: ARTICLES_STOCK[0], couleur: "", installes: 0, en_stock: 0 }); render(); }
      else if (act === "del-row") { draft.splice(Number(b.closest("tr").dataset.i), 1); render(); }
      else if (act === "cancel") { draft = null; edition = false; render(); }
      else if (act === "apply") {
        const avant = structuredClone(S.stock);
        await withBusy(b, "Enregistrement…", () => saveStock(draft, null));
        draft = null; edition = false;
        toast("Stock enregistré", "ok", { action: { label: "Annuler", run: () => saveStock(avant, "Stock rétabli") } });
      }
    } catch (err) { toast(err.message, "err"); }
  });

  on("stock", () => { if (!edition) draft = null; if (!root.hidden) render(); });
  on("stops", () => { if (!root.hidden) renderImpact(); });
  return { show() { render(); } };
}
