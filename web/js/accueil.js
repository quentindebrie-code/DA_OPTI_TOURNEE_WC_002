// Accueil : reprise de la tournée en cours, progression, chiffres du mois, raccourcis.

import { icon } from "./icons.js?v=202611161929";
import { esc, fmtDate, toast } from "./util.js?v=202611161929";
import { S, on, stopsValides, resultatObsolete, loadTournee } from "./state.js?v=202611161929";

export function initAccueil(root, ctx) {
  let tournees = null;

  const salut = () => {
    const h = new Date().getHours();
    return h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir";
  };

  /** Étapes de la tournée en cours, calculées sur l'état réel. */
  function etapes() {
    const n = stopsValides().length;
    const optim = !!S.result && !resultatObsolete();
    const imprimee = optim && !!S.tournee.pdfAt;
    const list = [
      { t: "Arrêts saisis", done: n > 0 },
      { t: "Tournée optimisée", done: optim },
      { t: "Feuille de route", done: imprimee },
    ];
    const cur = list.findIndex((e) => !e.done);
    return { list, cur, n, pct: Math.round((list.filter((e) => e.done).length / list.length) * 100) };
  }

  const NEWS_KEY = "nouveautes-2026-11";
  const nouveautes = () => { try { return !localStorage.getItem(NEWS_KEY); } catch { return false; } };

  function stats() {
    const now = new Date();
    const mois = (tournees || []).filter((t) => {
      const d = new Date((t.tour_date || t.updated_at || "").slice(0, 10) + "T00:00:00");
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    const km = mois.reduce((a, t) => a + (Number(t.stats?.km_gagnes) > 0 ? Number(t.stats.km_gagnes) : 0), 0);
    return { nb: mois.length, arrets: mois.reduce((a, t) => a + (t.nb_arrets || 0), 0), km };
  }

  function render() {
    const e = etapes();
    const st = stats();
    const ruptures = S.stock.filter((r) => r.en_stock === 0).length;
    const T = S.tournee;
    const action = e.cur === 0 ? { href: "#saisie", label: "Ajouter des arrêts" }
      : e.cur === 1 ? { href: "#saisie", label: "Optimiser la tournée" }
        : e.cur === 2 ? { href: "#tournee", label: "Imprimer la feuille de route" }
          : { href: "#tournee", label: "Voir la tournée" };
    root.innerHTML = `
      <div class="accueil-grid">
        <div class="stack">
          <section class="glass hero">
            <span class="glow" aria-hidden="true"></span>
            <div><span class="eyebrow">${esc(new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }))}</span>
              <h1>${salut()}</h1>
              <p class="muted">${e.n ? "Votre tournée vous attend." : "Prêt pour une nouvelle tournée ?"}</p></div>
            <div class="inset resume">
              <div class="ring" style="--p:${e.pct}" role="img" aria-label="Avancement ${e.pct} %"><span>${e.pct}%</span></div>
              <div>
                <b>${esc(T.nom || "Nouvelle tournée")}</b>
                <div class="small muted">${esc(fmtDate(S.params.tourDate))}${S.params.driver ? " · " + esc(S.params.driver) : ""} · ${e.n} arrêt${e.n > 1 ? "s" : ""}</div>
                <div class="steps" style="margin-top:8px">${e.list.map((x, i) =>
                  `<span class="step ${x.done ? "done" : i === e.cur ? "current" : ""}"><span class="n">${x.done ? icon("check") : i + 1}</span>${esc(x.t)}</span>`).join("")}</div>
              </div>
              <a class="btn btn-primary" href="${action.href}">${esc(action.label)} ${icon("arrow-right")}</a>
            </div>
          </section>

          <section class="glass">
            <div class="card-title">${icon("trend")}<span>Ce mois-ci</span></div>
            <div class="stats">
              <div class="stat"><b data-count="${st.nb}">${tournees ? st.nb : "–"}</b><span>tournées</span></div>
              <div class="stat"><b data-count="${st.arrets}">${tournees ? st.arrets : "–"}</b><span>arrêts</span></div>
              <div class="stat"><b data-count="${Math.round(st.km)}">${tournees ? Math.round(st.km) : "–"}</b><span>km économisés</span></div>
              <div class="stat"><b>${ruptures}</b><span>référence${ruptures > 1 ? "s" : ""} en rupture</span></div>
            </div>
          </section>
        </div>

        <div class="stack">
          ${nouveautes() ? `<section class="glass news">
            <div class="card-title">${icon("info")}<span>Nouvelle présentation</span>
              <button class="btn btn-ghost btn-icon btn-sm push" data-news-close aria-label="Masquer ce message">${icon("x")}</button></div>
            <p class="small">L'export PDF et Excel se trouve maintenant dans <a href="#tournee">Tournée</a>, la carte des clients dans <a href="#clients">Clients</a>. La couleur des cabines se choisit seule selon le stock si vous la laissez vide.</p>
          </section>` : ""}
          <section class="glass">
            <div class="card-title">${icon("folder")}<span>Dernières tournées</span></div>
            <div class="list-tour">${tournees == null ? `<p class="empty">Chargement…</p>`
              : tournees.length ? tournees.slice(0, 4).map((t) => `
                <button data-open="${esc(t.id)}">${icon("route")}<span class="grow"><b>${esc(t.nom)}</b>
                  <span class="meta">${esc(fmtDate(t.tour_date))} · ${t.nb_arrets} arrêt${t.nb_arrets > 1 ? "s" : ""}${t.chauffeur ? " · " + esc(t.chauffeur) : ""}</span></span>${icon("arrow-right")}</button>`).join("")
              : `<p class="empty">Aucune tournée enregistrée pour l'instant.</p>`}</div>
          </section>
        </div>
      </div>`;
    animerCompteurs();
  }

  function animerCompteurs() {
    root.querySelectorAll("[data-count]").forEach((el) => {
      const fin = Number(el.dataset.count);
      if (!fin || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const t0 = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - t0) / 900);
        el.textContent = Math.round(fin * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  root.addEventListener("click", async (e) => {
    if (e.target.closest("[data-news-close]")) {
      try { localStorage.setItem(NEWS_KEY, "1"); } catch { /* sans stockage, le message reste */ }
      const card = root.querySelector(".news");
      card?.classList.add("leaving");
      setTimeout(render, 260);
      return;
    }
    const b = e.target.closest("[data-open]");
    if (!b) return;
    try {
      await loadTournee(b.dataset.open);
      toast("Tournée ouverte");
      ctx.goto("saisie");
    } catch (err) { toast(err.message, "err"); }
  });

  async function charger() {
    try { tournees = await ctx.store.listTournees(); } catch { tournees = []; }
    if (!root.hidden) render();
  }
  ["tournee", "result", "stock"].forEach((ev) => on(ev, () => { if (!root.hidden) render(); }));
  ctx.onClients(() => { if (!root.hidden) render(); });

  return { show() { render(); charger(); } };
}
