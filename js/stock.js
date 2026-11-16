// Onglet « Stock & disponibilité » : import / export Excel, indicateurs, matrice
// article × couleur, détail modifiable, confrontation avec la tournée en cours.

import { COULEURS_PRODUITS, esc, toast, confirmer, fmtDateHeure } from "./util.js";
import { ARTICLES_STOCK, stockDefaut, cleanStock, besoinsTournee, controleDisponibilite, projeterStock } from "./metier.js";
import { S, on, emit, saveStock } from "./state.js";
import { parseStockExcel, exportStockExcel } from "./xlsx.js";
import { telecharger, XLSX_MIME } from "./libs.js";
import { pastilles } from "./tournee.js";

const STATUT = { rupture: "🔴 Rupture", juste: "🟠 Juste suffisant", ok: "🟢 Disponible" };

export function initStock(root, ctx) {
  let metrique = "en_stock";
  let filtreCouleurs = null, filtreArticles = null;   // null = tout
  let draft = null;      // lignes en cours d'édition (détail modifiable)

  const today = () => new Date().toLocaleDateString("fr-FR");
  const fileDate = () => today().replaceAll("/", "-");

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

    const source = S.stockError
      ? `<p class="note err">☁️ Stock non synchronisé : ${esc(S.stockError)}</p>`
      : S.stockMaj
        ? `<p class="note ok">☁️ Stock ${ctx.store.persistent ? "enregistré dans Supabase" : "enregistré dans ce navigateur (démo)"} — mis à jour le ${esc(fmtDateHeure(S.stockMaj))}. Chaque import ou modification est sauvegardé.</p>`
        : `<p class="note warn">⚠️ Aucun stock enregistré : les valeurs affichées sont celles du relevé de référence de l'exploitation. Importez le fichier du jour.</p>`;

    root.innerHTML = `
      <div class="page-head"><div><h2>📦 Stock & disponibilité</h2>
        <p class="muted">Parc de matériel : installé chez les clients ou disponible au dépôt.</p></div></div>

      <section class="card">
        <h3>1️⃣ Source des données</h3>
        ${source}
        <div class="row">
          <label class="btn btn-primary btn-file">📥 Importer le fichier de stock<input type="file" accept=".xlsx,.xlsm" data-act="import" hidden></label>
          <button class="btn" data-act="export">⬇️ Exporter le stock actuel</button>
          <button class="btn" data-act="template">📄 Modèle vierge</button>
          <button class="btn btn-danger-ghost" data-act="restore">♻️ Restaurer le relevé de référence</button>
        </div>
        <p class="small muted">Le fichier doit contenir les colonnes Article, Couleur, Installés, En stock. Le fichier exporté est directement réimportable.</p>
      </section>

      <section class="card">
        <h3>2️⃣ Vue d'ensemble du parc</h3>
        <div class="kpis">
          <div class="kpi"><span>🏗️ Parc total</span><b>${ti + ts}</b></div>
          <div class="kpi"><span>📦 En stock</span><b>${ts}</b></div>
          <div class="kpi"><span>🏠 Installés</span><b>${ti}</b></div>
          <div class="kpi"><span>📈 Taux d'usage</span><b>${ti + ts ? Math.round((ti / (ti + ts)) * 100) : 0} %</b></div>
          <div class="kpi"><span>🔴 Réf. en rupture</span><b>${rupt}</b><small>sur ${stock.length} réf.</small></div>
        </div>
      </section>

      <section class="card">
        <h3>3️⃣ Parc par produit et couleur</h3>
        <div class="filters">
          <div class="seg seg-3" role="tablist" aria-label="Donnée affichée">${[["en_stock", "En stock"], ["installes", "Installés"], ["total", "Parc total"]].map(([k, l]) =>
            `<button role="tab" data-metric="${k}" aria-selected="${k === metrique}">${l}</button>`).join("")}</div>
          <label class="seuil">Seuil d'alerte : <b>${S.seuilAlerte}</b><input type="range" min="0" max="5" value="${S.seuilAlerte}" data-act="seuil"></label>
        </div>
        <div class="chips" aria-label="Filtrer par couleur">${couleurs.map((c) =>
          `<label class="chip"><input type="checkbox" data-fc="${esc(c)}"${fc.includes(c) ? " checked" : ""}>${c ? pastilles(c) : "Sans couleur"}</label>`).join("")}</div>
        <div class="chips" aria-label="Filtrer par article">${articles.map((a) =>
          `<label class="chip"><input type="checkbox" data-fa="${esc(a)}"${fa.includes(a) ? " checked" : ""}>${esc(a)}</label>`).join("")}</div>
        <div class="table-wrap">${matrice(stock, fa, fc)}</div>
        <p class="small muted">${metrique === "en_stock" ? "🟢 disponible · 🟠 tension (≤ seuil) · 🔴 rupture · " : ""}« · » : couleur non référencée pour cet article.</p>
      </section>

      <section class="card">
        <h3>4️⃣ Détail modifiable</h3>
        <p class="small muted">Ajustez les quantités si le relevé a évolué. Les doublons (même article, même couleur) sont fusionnés à l'enregistrement.</p>
        <div class="table-wrap"><table class="table stock-edit">
          <thead><tr><th>Article</th><th>🎨 Couleur</th><th class="num">🏠 Installés</th><th class="num">📦 En stock</th><th class="num">Σ Parc</th><th></th></tr></thead>
          <tbody>${draft.map((r, i) => `<tr data-i="${i}">
            <td><select data-f="article">${[...new Set([...ARTICLES_STOCK, r.article])].map((a) => `<option${a === r.article ? " selected" : ""}>${esc(a)}</option>`).join("")}</select></td>
            <td><select data-f="couleur">${[...new Set(["", ...COULEURS_PRODUITS, r.couleur])].map((c) => `<option value="${esc(c)}"${c === r.couleur ? " selected" : ""}>${esc(c || "—")}</option>`).join("")}</select></td>
            <td class="num"><input type="number" min="0" max="999" class="w-num" data-f="installes" value="${r.installes}"></td>
            <td class="num"><input type="number" min="0" max="999" class="w-num" data-f="en_stock" value="${r.en_stock}"></td>
            <td class="num" data-total>${r.installes + r.en_stock}</td>
            <td><button class="btn btn-icon btn-sm" data-act="del-row" aria-label="Supprimer la ligne">🗑️</button></td></tr>`).join("")}</tbody>
        </table></div>
        <div class="row">
          <button class="btn btn-sm" data-act="add-row">➕ Ajouter une ligne</button>
          <button class="btn btn-primary btn-sm" data-act="apply">💾 Enregistrer les modifications</button>
          <button class="btn btn-sm" data-act="cancel">Annuler</button>
        </div>
      </section>

      <section class="card confrontation"></section>

      <details class="card">
        <summary>📘 Règles de gestion appliquées</summary>
        <p><b>Constitution des références</b> — La référence article est déduite du couple Produit / Option : un WC chimique avec l'option Lave-main correspond à l'article « WC chimique + Lave-main ». Le produit WC client appartient au client et n'est jamais décompté.</p>
        <p><b>Mouvements de stock</b> — Déposer : −1 en stock, +1 installé · Retirer : +1 en stock, −1 installé · Nettoyer : aucun mouvement · Chargement / Déchargement : neutres par défaut, configurables ci-dessus.</p>
        <p><b>Couleurs</b> — Facultatives. Plusieurs choix possibles sur une même ligne : la disponibilité est contrôlée sur leur stock cumulé. Sans sélection, elle est contrôlée toutes couleurs confondues.</p>
        <p><b>Persistance</b> — Le stock est enregistré dans Supabase à chaque import ou modification et rechargé à l'ouverture. L'export Excel reste disponible comme sauvegarde.</p>
      </details>`;
    renderConfrontation();
  }

  function valeur(rows, a, c) {
    const sub = rows.filter((r) => r.article === a && r.couleur === c);
    const v = sub.reduce((n, r) => n + (metrique === "total" ? r.installes + r.en_stock : r[metrique]), 0);
    return [v, sub.length > 0];
  }

  function matrice(stock, articles, couleurs) {
    if (!articles.length || !couleurs.length) return `<p class="empty">Aucune référence ne correspond aux filtres.</p>`;
    const totCol = couleurs.map(() => 0);
    let totGen = 0;
    const lignes = articles.map((a) => {
      let tl = 0;
      const tds = couleurs.map((c, j) => {
        const [v, existe] = valeur(stock, a, c);
        tl += v; totCol[j] += v;
        let cls = v === 0 ? "m-zero" : "m-val";
        if (metrique === "en_stock" && existe) cls = v === 0 ? "m-rupt" : v <= S.seuilAlerte ? "m-tens" : "m-ok";
        return `<td class="num ${cls}">${v !== 0 || existe ? v : "·"}</td>`;
      }).join("");
      totGen += tl;
      return `<tr><th>${esc(a)}</th>${tds}<td class="num m-tot">${tl}</td></tr>`;
    }).join("");
    return `<table class="table matrice"><thead><tr><th>Article</th>${couleurs.map((c) => `<th class="num">${c ? pastilles(c) : "—"}</th>`).join("")}<th class="num">Total</th></tr></thead>
      <tbody>${lignes}<tr class="m-total"><th>TOTAL</th>${totCol.map((v) => `<td class="num">${v}</td>`).join("")}<td class="num m-grand">${totGen}</td></tr></tbody></table>`;
  }

  function renderConfrontation() {
    const box = root.querySelector(".confrontation");
    if (!box) return;
    const bes = besoinsTournee(S.stops, S.stockManutentions);
    const ctl = controleDisponibilite(S.stock, bes);
    let html = `<h3>5️⃣ Disponibilité pour la tournée en cours</h3>
      <label class="switch"><input type="checkbox" data-act="manut"${S.stockManutentions ? " checked" : ""}>
        <span>Comptabiliser Chargement / Déchargement comme mouvements de stock</span></label>
      <p class="small muted">Désactivé : seules Déposer (sortie) et Retirer (retour) génèrent un mouvement. Activé : Chargement = retour au dépôt, Déchargement = dépose sur site.</p>`;
    if (!bes.length) {
      html += `<p class="note info">ℹ️ Aucun mouvement de matériel n'est généré par la saisie actuelle (onglet <a href="#saisie">Saisie</a>). Ajoutez des arrêts Déposer ou Retirer avec une adresse.</p>`;
    } else {
      const nManq = ctl.filter((x) => x.manque > 0).length;
      html += nManq ? `<p class="note err">🔴 <b>${nManq} référence(s) en rupture</b> pour cette tournée.</p>`
        : ctl.length ? `<p class="note ok">🟢 <b>Toutes les sorties de matériel sont couvertes par le stock.</b></p>` : "";
      html += `<div class="grid-2 gap">
        <div><h4>📤 Mouvements générés par la tournée</h4><div class="table-wrap"><table class="table">
          <thead><tr><th>Article</th><th>Couleur</th><th class="num">📤 À charger</th><th class="num">📥 À rapporter</th><th class="num">Δ Stock</th></tr></thead>
          <tbody>${bes.map((b) => `<tr><td>${esc(b.article)}</td><td>${b.couleur ? pastilles(b.couleur) : "Indifférente"}</td>
            <td class="num">${b.sorties}</td><td class="num">${b.retours}</td><td class="num">${b.net > 0 ? "+" : ""}${b.net}</td></tr>`).join("")}</tbody></table></div></div>
        <div><h4>✅ Contrôle de disponibilité</h4>${ctl.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Article</th><th>Couleur</th><th class="num">Besoin</th><th class="num">Dispo.</th><th class="num">Manque</th><th>Statut</th></tr></thead>
          <tbody>${ctl.map((x) => `<tr><td>${esc(x.article)}</td><td>${esc(x.couleur)}</td><td class="num">${x.besoin}</td>
            <td class="num">${x.disponible}</td><td class="num">${x.manque}</td><td>${STATUT[x.statut]}</td></tr>`).join("")}</tbody></table></div>`
          : `<p class="small muted">Aucune sortie à contrôler (la tournée ne génère que des retours).</p>`}</div>
      </div>`;
      const proj = projeterStock(S.stock, bes);
      const avant = new Map(S.stock.map((r) => [r.article + "|" + r.couleur, r.en_stock]));
      const diff = proj.map((r) => ({ ...r, avant: avant.get(r.article + "|" + r.couleur) || 0 })).filter((r) => r.en_stock !== r.avant);
      html += `<h4>🔮 Parc projeté après exécution de la tournée</h4>
        <p class="small muted">Simulation des mouvements ci-dessus. Les besoins sans couleur imposée sont imputés sur la couleur la mieux dotée.</p>
        ${diff.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Article</th><th>Couleur</th><th class="num">Avant</th><th class="num">Après</th><th class="num">Δ</th></tr></thead>
          <tbody>${diff.map((r) => `<tr><td>${esc(r.article)}</td><td>${r.couleur ? pastilles(r.couleur) : "—"}</td><td class="num">${r.avant}</td>
            <td class="num">${r.en_stock}</td><td class="num">${r.en_stock - r.avant > 0 ? "+" : ""}${r.en_stock - r.avant}</td></tr>`).join("")}</tbody></table></div>`
          : `<p class="small muted">Aucune variation de stock à l'issue de cette tournée.</p>`}
        <button class="btn" data-act="export-proj">⬇️ Exporter le parc projeté (fin de tournée)</button>`;
    }
    box.innerHTML = html;
  }

  // ── Événements ─────────────────────────────────────────────────────────────
  root.addEventListener("change", async (e) => {
    const el = e.target;
    if (el.dataset.act === "import") {
      const file = el.files[0];
      el.value = "";
      if (!file) return;
      try {
        const { rows, message } = await parseStockExcel(file);
        draft = null;
        await saveStock(rows, `✅ ${message}`);
      } catch (err) { toast("❌ " + err.message, "err"); }
    } else if (el.dataset.act === "seuil") {
      S.seuilAlerte = Number(el.value);
      emit("params");
      render();
    } else if (el.dataset.act === "manut") {
      S.stockManutentions = el.checked;
      emit("stock"); emit("params");
    } else if (el.dataset.fc !== undefined || el.dataset.fa !== undefined) {
      filtreCouleurs = [...root.querySelectorAll("[data-fc]:checked")].map((x) => x.dataset.fc);
      filtreArticles = [...root.querySelectorAll("[data-fa]:checked")].map((x) => x.dataset.fa);
      render();
    } else if (el.dataset.f) {
      const tr = el.closest("tr");
      const r = draft[Number(tr.dataset.i)];
      r[el.dataset.f] = el.type === "number" ? Math.max(0, parseInt(el.value, 10) || 0) : el.value;
      tr.querySelector("[data-total]").textContent = r.installes + r.en_stock;
    }
  });
  root.addEventListener("input", (e) => {
    if (e.target.dataset.act === "seuil") e.target.previousElementSibling.textContent = e.target.value;
  });
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act], [data-metric]");
    if (!b) return;
    if (b.dataset.metric) { metrique = b.dataset.metric; render(); return; }
    const act = b.dataset.act;
    try {
      if (act === "export") telecharger(await exportStockExcel(S.stock, null, today()), `Stock_parc_${fileDate()}.xlsx`, XLSX_MIME);
      else if (act === "template") telecharger(await exportStockExcel(cleanStock(stockDefaut()).map((r) => ({ ...r, installes: 0, en_stock: 0 })), null, today()), "Modele_stock_parc.xlsx", XLSX_MIME);
      else if (act === "export-proj") {
        const proj = projeterStock(S.stock, besoinsTournee(S.stops, S.stockManutentions));
        telecharger(await exportStockExcel(S.stock, proj, today()), `Stock_parc_projete_${fileDate()}.xlsx`, XLSX_MIME);
      } else if (act === "restore") {
        if (!await confirmer("Restaurer le relevé de référence ?", "Le stock actuel sera remplacé par le relevé de référence de l'exploitation et enregistré.", "Restaurer")) return;
        draft = null;
        await saveStock(stockDefaut(), "Relevé de référence restauré");
      } else if (act === "add-row") {
        draft.push({ article: ARTICLES_STOCK[0], couleur: "", installes: 0, en_stock: 0 });
        render();
      } else if (act === "del-row") {
        draft.splice(Number(b.closest("tr").dataset.i), 1);
        render();
      } else if (act === "apply") {
        const rows = draft;
        draft = null;
        await saveStock(rows, "✅ Stock enregistré");
      } else if (act === "cancel") { draft = null; render(); }
    } catch (err) { toast(err.message, "err"); }
  });

  on("stock", () => { draft = null; if (!root.hidden) render(); });
  on("stops", () => { if (!root.hidden) renderConfrontation(); });

  return { show() { render(); } };
}
