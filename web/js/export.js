// Onglet « Export » : feuille de tournée Excel et PDF de la tournée active
// (ordre manuel prioritaire sur l'ordre optimisé).

import { esc, toast, fmtDate } from "./util.js";
import { PAUSE_DEJEUNER_MIN, fmtMin } from "./metier.js";
import { S, on, activeResult, resultatObsolete } from "./state.js";
import { exportTourneeExcel } from "./xlsx.js";
import { exportTourneePdf } from "./pdf.js";
import { telecharger, XLSX_MIME } from "./libs.js";

export function initExport(root) {
  function render() {
    const r = activeResult();
    if (!r) {
      root.innerHTML = `<div class="card placeholder"><h3>📤 Rien à exporter pour l'instant</h3>
        <p>Optimisez d'abord une tournée dans l'onglet <a href="#saisie">📋 Saisie</a>.</p></div>`;
      return;
    }
    const n = r.stops_ordered.length;
    root.innerHTML = `
      <div class="page-head"><div><h2>📤 Exporter la feuille de tournée</h2>
        <p class="muted">Tournée du ${esc(fmtDate(S.params.tourDate))}${S.params.driver ? " · " + esc(S.params.driver) : ""} · ${n} arrêt(s)</p></div></div>
      ${resultatObsolete() ? `<p class="note warn">⚠️ La saisie a changé depuis l'optimisation : les documents reprennent la dernière tournée optimisée. <a href="#saisie">Relancer l'optimisation</a></p>` : ""}
      ${r.is_manual ? `<p class="note ok">✏️ <b>Ordre manuel pris en compte</b> : les documents reprennent l'ordre défini par glisser-déposer, avec horaires, distance et carburant recalculés.</p>`
        : `<p class="small muted">🤖 Ordre optimisé automatiquement. Pour exporter un autre ordre, réorganisez les arrêts dans l'onglet <a href="#tournee">Tournée optimisée</a>.</p>`}
      ${r.is_manual && !r.recalc_ok ? `<p class="note warn">⚠️ Le service d'itinéraire n'a pas répondu lors du dernier réordonnancement : la distance et la durée sont celles de l'ordre optimisé.</p>` : ""}
      <ul class="small muted plain">
        <li>${r.pause_dejeuner ? `🍽️ Les documents incluent la pause déjeuner de ${PAUSE_DEJEUNER_MIN} min.` : "⛔ Documents générés sans pause déjeuner."}</li>
        <li>${r.etat_lieux_par_arret ? `📋 ${n} fiche(s) « État des lieux » (une par arrêt), pré-remplies et à signer.` : "🗂️ Une seule fiche « État des lieux » généraliste pour toute la tournée."}</li>
      </ul>
      <div class="grid-2 gap">
        <section class="card">
          <h3>📊 Excel (.xlsx)</h3>
          <p>Feuille de route mise en forme (codes couleur, heures de passage, case ✓ Fait), récapitulatif matériel et feuille « État des lieux ».</p>
          <button class="btn btn-primary btn-block" data-act="xlsx">⬇️ Télécharger Excel</button>
        </section>
        <section class="card">
          <h3>📄 PDF</h3>
          <p>Document imprimable pour le chauffeur : tableau coloré, matériel à charger, carte de la tournée, consignes et fiches d'état des lieux.</p>
          <button class="btn btn-primary btn-block" data-act="pdf">⬇️ Télécharger PDF</button>
        </section>
      </div>
      <details class="card">
        <summary>🔎 Vérifier l'ordre qui sera exporté</summary>
        <div class="table-wrap"><table class="table"><thead><tr><th class="num">Ordre</th><th>Action</th><th>Client</th><th>Adresse</th><th>Arrivée</th></tr></thead>
        <tbody>${r.stops_ordered.map((s) => `<tr><td class="num">${s.order_num}</td><td>${esc(s.action)}</td><td>${esc(s.client)}</td>
          <td>${esc(s.address)}</td><td>${fmtMin(s.arrival_min) || "—"}${s.violated ? " ⚠️" : ""}</td></tr>`).join("")}</tbody></table></div>
      </details>`;
  }

  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const r = activeResult();
    const suffix = r.is_manual ? "_ordre-manuel" : "";
    const date = fmtDate(S.params.tourDate).replaceAll("/", "-");
    const label = b.textContent;
    b.disabled = true;
    b.textContent = "⏳ Génération…";
    try {
      if (b.dataset.act === "xlsx") {
        telecharger(await exportTourneeExcel(r, S.params.tourDate, S.params.driver), `Tournee_WC_${date}${suffix}.xlsx`, XLSX_MIME);
      } else {
        telecharger(await exportTourneePdf(r, S.params.tourDate, S.params.driver), `Tournee_WC_${date}${suffix}.pdf`, "application/pdf");
      }
    } catch (err) {
      console.error(err);
      toast("Export impossible : " + err.message, "err");
    } finally {
      b.disabled = false;
      b.textContent = label;
    }
  });

  on("result", () => { if (!root.hidden) render(); });
  on("params", () => { if (!root.hidden) render(); });
  return { show: render };
}
