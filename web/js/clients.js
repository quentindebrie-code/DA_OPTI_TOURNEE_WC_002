// Écran « Clients » : fiches (liste + fiche détaillée) et carte des points de livraison.

import { icon } from "./icons.js?v=202611162100";
import { PRODUITS_CATALOGUE, OPTIONS_WC, COULEURS_PRODUITS, PASTILLE, esc, normTxt, couleursArret, couleursTexte,
  uid, geocode, toast, confirmer, moveInk, withBusy } from "./util.js?v=202611162100";
import { loadLeaflet } from "./libs.js?v=202611162100";

const NEW = "__new__";

export function initClients(root, ctx) {
  let mode = "fiches";
  let selected = null, draft = null, dirty = false;
  let L = null, map = null, layer = null, focusClient = null, mapSeq = 0;

  root.innerHTML = `
    <div class="page-head">
      <div><span class="eyebrow">Base client</span><h1>Clients</h1><p data-m></p></div>
      <div class="head-actions">
        <div class="seg" role="group" aria-label="Affichage"><span class="ink"></span>
          <button data-mode="fiches" aria-pressed="true">${icon("list")} Fiches</button>
          <button data-mode="carte" aria-pressed="false">${icon("map")} Carte</button></div>
        <button class="btn btn-primary" data-act="new">${icon("plus")}<span>Nouveau client</span></button>
      </div>
    </div>
    <div data-zone="fiches" class="clients-layout">
      <section class="glass list-card">
        <div class="search">${icon("search")}<input type="search" placeholder="Nom, ville, adresse" aria-label="Rechercher un client"></div>
        <div class="client-list" role="list"></div>
      </section>
      <div class="hub"></div>
    </div>
    <section data-zone="carte" class="glass clients-map" hidden><div id="clients-map" class="map" aria-label="Carte des clients"></div></section>`;

  const $ = (s) => root.querySelector(s);
  const listEl = $(".client-list"), hubEl = $(".hub"), search = $(".search input");
  const layout = $('[data-zone="fiches"]');

  // ── Liste ──────────────────────────────────────────────────────────────────
  function renderList() {
    const clients = ctx.clients;
    const pts = clients.reduce((n, c) => n + (c.points?.length || 0), 0);
    $("[data-m]").textContent = `${clients.length} client${clients.length > 1 ? "s" : ""} · ${pts} adresse${pts > 1 ? "s" : ""} de livraison`;
    const q = normTxt(search.value);
    const vis = clients.filter((c) => !q || normTxt([c.nom, c.contact, ...(c.points || []).map((p) => `${p.libelle} ${p.adresse}`)].join(" ")).includes(q));
    listEl.innerHTML = !clients.length ? `<p class="empty">Aucun client pour l'instant.</p>`
      : !vis.length ? `<p class="empty">Aucun résultat.</p>`
        : vis.map((c) => {
          const n = c.points?.length || 0;
          const ville = (c.points?.[0]?.adresse || "").match(/\d{5}\s+(.+)$/)?.[1] || "";
          return `<button class="client-item${c.id === selected ? " active" : ""}" data-id="${esc(c.id)}" role="listitem">
            <span class="avatar" aria-hidden="true">${esc((c.nom || "?").trim().charAt(0).toUpperCase())}</span>
            <span class="grow"><b>${esc(c.nom)}</b><small>${esc(c.produit)}${c.option_produit ? " + " + esc(c.option_produit) : ""} · ${n} adresse${n > 1 ? "s" : ""}${ville ? " · " + esc(ville) : ""}</small></span></button>`;
        }).join("");
  }
  search.addEventListener("input", renderList);
  listEl.addEventListener("click", async (e) => {
    const b = e.target.closest(".client-item");
    if (b && b.dataset.id !== selected && await canLeave()) open(ctx.clients.find((c) => c.id === b.dataset.id));
  });

  // ── Fiche ──────────────────────────────────────────────────────────────────
  async function canLeave() {
    return !dirty || confirmer("Modifications non enregistrées", "Les changements de cette fiche seront perdus.", "Quitter sans enregistrer");
  }
  const newPoint = (p = {}) => ({ uid: uid(), id: p.id || null, libelle: p.libelle || "", adresse: p.adresse || "",
    pas_avant: p.pas_avant || "", pas_apres: p.pas_apres || "", observations: p.observations || "" });

  function open(client) {
    const c = client || {};
    selected = client ? client.id : NEW;
    draft = { nom: c.nom || "", contact: c.contact || "", telephone: c.telephone || "", email: c.email || "", notes: c.notes || "",
      produit: PRODUITS_CATALOGUE.includes(c.produit) ? c.produit : "WC chimique",
      option_produit: client ? (c.option_produit || "") : "Lave-main", quantite: Number(c.quantite) || 1,
      couleurs: couleursArret(c.couleurs || ""), pas_avant: c.pas_avant || "", pas_apres: c.pas_apres || "",
      points: (c.points?.length ? c.points : [{}]).map(newPoint) };
    dirty = false;
    renderHub();
    renderList();
    layout.classList.add("has-fiche");
    if (innerWidth < 900) scrollTo({ top: 0, behavior: "smooth" });
  }
  function close() { selected = null; draft = null; dirty = false; layout.classList.remove("has-fiche"); renderHub(); renderList(); }

  const field = (label, name, attrs = "") => `<label>${label}<input data-f="${name}" value="${esc(draft[name])}" ${attrs}></label>`;

  function renderHub() {
    if (!draft) {
      hubEl.innerHTML = `<section class="glass empty-stops">${icon("clients", "i-hero")}<h2>Sélectionnez un client</h2>
        <p class="muted">Ses adresses et sa prestation habituelle rempliront automatiquement vos tournées.</p>
        <div class="row"><button class="btn btn-primary" data-act="new">${icon("plus")}<span>Nouveau client</span></button></div></section>`;
      return;
    }
    const isNew = selected === NEW;
    hubEl.innerHTML = `<form class="fiche" novalidate>
      <div class="row"><button type="button" class="btn btn-ghost btn-sm" data-act="back">${icon("arrow-left")}<span>Liste</span></button>
        <h2 class="fiche-title" style="margin:0;flex:1">${esc(draft.nom || "Nouveau client")}</h2></div>
      <fieldset class="glass"><legend>${icon("user")}Identité</legend>
        <div class="stack">
          <div class="grid-2">${field("Nom du client", "nom", 'required placeholder="ex. SARL Martin BTP" autocomplete="organization"')}
            ${field("Contact sur place", "contact", 'placeholder="ex. M. Durand"')}
            ${field("Téléphone", "telephone", 'type="tel" autocomplete="tel"')}${field("E-mail", "email", 'type="email" autocomplete="email"')}</div>
          <label>Notes internes<textarea data-f="notes" rows="2" placeholder="Facturation, particularités">${esc(draft.notes)}</textarea></label>
        </div></fieldset>
      <fieldset class="glass"><legend>${icon("stock")}Prestation habituelle</legend>
        <div class="stack">
          <div class="grid-3">
            <label>Produit<select data-f="produit">${PRODUITS_CATALOGUE.map((p) => `<option${p === draft.produit ? " selected" : ""}>${esc(p)}</option>`).join("")}</select></label>
            <label>Option<select data-f="option_produit">${OPTIONS_WC.map((o) => `<option value="${esc(o)}"${o === draft.option_produit ? " selected" : ""}>${esc(o || "Aucune")}</option>`).join("")}</select></label>
            <label>Quantité<input data-f="quantite" type="number" min="1" max="20" inputmode="numeric" value="${draft.quantite}"></label>
          </div>
          <p class="note warn" data-warn-option hidden>${icon("alert")}<span>Un WC chimique doit avoir un lave-main ou un urinoir (art. R4228-7).</span></p>
          <div><div class="label">Couleurs acceptées <span class="small">(aucune = au choix selon le stock)</span></div>
            <div class="chips" role="group" aria-label="Couleurs acceptées">${COULEURS_PRODUITS.map((c) =>
              `<label class="chip"><input type="checkbox" data-couleur="${esc(c)}"${draft.couleurs.includes(c) ? " checked" : ""}><i class="pastille" style="--pc:${PASTILLE[c]}"></i>${esc(c)}</label>`).join("")}</div></div>
          <div class="grid-2">${field("Pas avant", "pas_avant", 'type="time" step="300"')}${field("Pas après", "pas_apres", 'type="time" step="300"')}</div>
        </div></fieldset>
      <fieldset class="glass"><legend>${icon("pin")}Adresses de livraison</legend>
        <div class="points"></div>
        <button type="button" class="btn btn-block" data-act="add-point">${icon("plus")}<span>Ajouter une adresse</span></button></fieldset>
      <div class="fiche-actions">
        <button type="submit" class="btn btn-primary">${icon("save")}<span>Enregistrer</span></button>
        ${isNew ? "" : `<button type="button" class="btn" data-act="map">${icon("map")}<span>Carte</span></button>`}
        <button type="button" class="btn btn-ghost" data-act="close">${isNew ? "Annuler" : "Fermer"}</button>
        ${isNew ? "" : `<button type="button" class="btn btn-danger-ghost" data-act="delete" style="margin-left:auto">${icon("trash")}<span>Supprimer</span></button>`}
      </div></form>`;
    renderPoints();
    syncOption();
  }

  function renderPoints() {
    const box = hubEl.querySelector(".points");
    const pts = draft.points;
    box.innerHTML = pts.map((p, i) => `<div class="point" data-uid="${p.uid}">
      <label>Libellé<input data-p="libelle" value="${esc(p.libelle)}" placeholder="ex. Chantier Gaillac"></label>
      <label>Adresse<input data-p="adresse" value="${esc(p.adresse)}" placeholder="Rue, code postal, ville" autocomplete="street-address"></label>
      <div class="grid-2 wide"><label>Pas avant<input data-p="pas_avant" type="time" step="300" value="${esc(p.pas_avant)}"></label>
        <label>Pas après<input data-p="pas_apres" type="time" step="300" value="${esc(p.pas_apres)}"></label></div>
      <label class="wide">Observations<input data-p="observations" value="${esc(p.observations)}" placeholder="Code portail, accès, contact"></label>
      <div class="row wide"><button type="button" class="btn btn-sm" data-act="geo"${p.adresse.trim() ? "" : " disabled"}>${icon("pin")}<span>Vérifier l'adresse</span></button>
        <span class="geo-res small"></span>
        <button type="button" class="btn btn-sm btn-danger-ghost" data-act="del-point" style="margin-left:auto"${pts.length <= 1 ? " disabled" : ""} aria-label="Retirer l'adresse ${i + 1}">${icon("trash")}</button></div>
    </div>`).join("");
  }
  function syncOption() {
    const isWc = draft.produit === "WC chimique";
    hubEl.querySelector("[data-f=option_produit]").disabled = !isWc;
    hubEl.querySelector("[data-warn-option]").hidden = !(isWc && !draft.option_produit);
  }

  hubEl.addEventListener("input", (e) => {
    if (!draft) return;
    const t = e.target;
    t.removeAttribute("aria-invalid");
    t.closest("label")?.querySelector(".field-error")?.remove();
    if (t.dataset.f) {
      draft[t.dataset.f] = t.value;
      if (t.dataset.f === "nom") hubEl.querySelector(".fiche-title").textContent = t.value || "Nouveau client";
      if (t.dataset.f === "produit" || t.dataset.f === "option_produit") syncOption();
    } else if (t.dataset.p) {
      const card = t.closest(".point");
      draft.points.find((x) => x.uid === card.dataset.uid)[t.dataset.p] = t.value;
      if (t.dataset.p === "adresse") { card.querySelector("[data-act=geo]").disabled = !t.value.trim(); card.querySelector(".geo-res").textContent = ""; }
    } else if (t.dataset.couleur) {
      draft.couleurs = [...hubEl.querySelectorAll("[data-couleur]:checked")].map((x) => x.dataset.couleur);
    }
    dirty = true;
  });

  root.addEventListener("click", async (e) => {
    const seg = e.target.closest("[data-mode]");
    if (seg) return setMode(seg.dataset.mode);
    const pop = e.target.closest("[data-open-client]");
    if (pop) { setMode("fiches"); return open(ctx.clients.find((c) => c.id === pop.dataset.openClient)); }
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    if (act === "new") { if (await canLeave()) { setMode("fiches"); open(null); setTimeout(() => hubEl.querySelector("[data-f=nom]")?.focus(), 350); } }
    else if (act === "back" || act === "close") { if (await canLeave()) close(); }
    else if (act === "add-point") {
      draft.points.push(newPoint()); dirty = true; renderPoints();
      hubEl.querySelector(".point:last-child [data-p=libelle]")?.focus();
    } else if (act === "del-point") {
      const card = b.closest(".point");
      card.style.animation = "row-out .25s var(--ease) both";
      setTimeout(() => { draft.points = draft.points.filter((p) => p.uid !== card.dataset.uid); dirty = true; renderPoints(); }, 240);
    } else if (act === "geo") {
      const card = b.closest(".point");
      const res = card.querySelector(".geo-res");
      const addr = draft.points.find((x) => x.uid === card.dataset.uid).adresse.trim();
      await withBusy(b, "Recherche…", async () => {
        try {
          const g = await geocode(addr);
          res.className = `geo-res small ${g ? "ok" : "err"}`;
          res.textContent = g ? `Trouvée : ${g.label}${g.score < .6 ? " (à vérifier)" : ""}` : "Introuvable : précisez la commune ou le code postal.";
        } catch { res.className = "geo-res small err"; res.textContent = "Vérification impossible pour le moment."; }
      });
    } else if (act === "map") {
      if (await canLeave()) { focusClient = selected; setMode("carte"); }
    } else if (act === "delete") {
      if (!await confirmer(`Supprimer « ${draft.nom} » ?`, "La fiche et ses adresses seront supprimées. Les tournées déjà saisies ne changent pas.", "Supprimer")) return;
      try {
        await ctx.store.deleteClient(selected);
        toast(`« ${draft.nom} » supprimé`);
        dirty = false; close();
        await ctx.refreshClients();
      } catch (err) { toast(err.message, "err"); }
    }
  });

  function erreurChamp(el, msg) {
    el.setAttribute("aria-invalid", "true");
    const p = document.createElement("p");
    p.className = "field-error";
    p.textContent = msg;
    el.closest("label").appendChild(p);
  }

  hubEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    hubEl.querySelectorAll(".field-error").forEach((x) => x.remove());
    const errs = [];
    if (!draft.nom.trim()) errs.push([hubEl.querySelector("[data-f=nom]"), "Le nom est obligatoire."]);
    if (draft.pas_avant && draft.pas_apres && draft.pas_avant >= draft.pas_apres) errs.push([hubEl.querySelector("[data-f=pas_apres]"), "Doit être après « Pas avant »."]);
    const points = [];
    draft.points.forEach((p) => {
      const pt = { id: p.id, libelle: p.libelle.trim(), adresse: p.adresse.trim(), pas_avant: p.pas_avant, pas_apres: p.pas_apres, observations: p.observations.trim() };
      if (![pt.libelle, pt.adresse, pt.pas_avant, pt.pas_apres, pt.observations].some(Boolean)) return;
      const card = hubEl.querySelector(`.point[data-uid="${p.uid}"]`);
      if (!pt.adresse) errs.push([card.querySelector("[data-p=adresse]"), "L'adresse est obligatoire."]);
      if (pt.pas_avant && pt.pas_apres && pt.pas_avant >= pt.pas_apres) errs.push([card.querySelector("[data-p=pas_apres]"), "Doit être après « Pas avant »."]);
      points.push(pt);
    });
    if (!points.length) errs.push([hubEl.querySelector("[data-p=adresse]"), "Ajoutez au moins une adresse."]);
    if (errs.length) {
      errs.forEach(([el, m]) => erreurChamp(el, m));
      errs[0][0].focus();
      errs[0][0].scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const client = { id: selected === NEW ? null : selected, nom: draft.nom.trim(), contact: draft.contact.trim(), telephone: draft.telephone.trim(),
      email: draft.email.trim(), notes: draft.notes.trim(), produit: draft.produit,
      option_produit: draft.produit === "WC chimique" ? draft.option_produit || "" : "",
      quantite: Math.min(20, Math.max(1, parseInt(draft.quantite, 10) || 1)), couleurs: couleursTexte(draft.couleurs),
      pas_avant: draft.pas_avant, pas_apres: draft.pas_apres };
    await withBusy(hubEl.querySelector("[type=submit]"), "Enregistrement…", async () => {
      try {
        const id = await ctx.store.saveClient(client, points);
        dirty = false;
        await ctx.refreshClients();
        const saved = ctx.clients.find((c) => c.id === id);
        saved ? open(saved) : close();
        toast(`Fiche « ${client.nom} » enregistrée`);
      } catch (err) { toast("Enregistrement impossible : " + err.message, "err"); }
    });
  });
  addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });

  // ── Carte des clients ──────────────────────────────────────────────────────
  function setMode(m) {
    mode = m;
    root.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mode === m));
    moveInk(root.querySelector(".seg"), root.querySelector(`[data-mode="${m}"]`));
    $('[data-zone="fiches"]').hidden = m !== "fiches";
    $('[data-zone="carte"]').hidden = m !== "carte";
    if (m === "carte") dessinerCarte();
  }

  async function dessinerCarte() {
    const seq = ++mapSeq;
    try { L = L || await loadLeaflet(); } catch { $("#clients-map").innerHTML = `<p class="empty">Carte indisponible hors connexion.</p>`; return; }
    if (!map) {
      map = L.map($("#clients-map"), { zoomControl: false }).setView([43.75, 1.68], 9);
      L.control.zoom({ position: "topright" }).addTo(map);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
      layer = L.layerGroup().addTo(map);
    }
    map.invalidateSize();
    layer.clearLayers();
    const clients = focusClient ? ctx.clients.filter((c) => c.id === focusClient) : ctx.clients;
    focusClient = null;
    const items = clients.flatMap((c) => (c.points || []).filter((p) => p.adresse).map((p) => ({ c, p })));
    const status = document.createElement("div");
    status.className = "map-status";
    status.textContent = `Placement de ${items.length} adresse${items.length > 1 ? "s" : ""}…`;
    $('[data-zone="carte"]').appendChild(status);
    const pts = [];
    let i = 0;
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (i < items.length) {
        const { c, p } = items[i++];
        let g = null;
        try { g = await geocode(p.adresse); } catch { /* ignorée */ }
        if (!g || seq !== mapSeq) continue;
        L.marker([g.lat, g.lon], { icon: L.divIcon({ className: "", iconSize: [22, 22], iconAnchor: [11, 11], html: '<div class="pin pin-small" style="--c:#038D29"></div>' }) })
          .bindPopup(`<b>${esc(c.nom)}</b>${p.libelle ? "<br>" + esc(p.libelle) : ""}<br>${esc(p.adresse)}<br><button class="btn btn-sm" data-open-client="${esc(c.id)}" style="margin-top:6px">Ouvrir la fiche</button>`)
          .bindTooltip(c.nom).addTo(layer);
        pts.push([g.lat, g.lon]);
      }
    }));
    status.remove();
    if (seq === mapSeq && pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 14 });
  }
  $("#clients-map").addEventListener("click", (e) => {
    const b = e.target.closest("[data-open-client]");
    if (b) { setMode("fiches"); open(ctx.clients.find((c) => c.id === b.dataset.openClient)); }
  });

  ctx.onClients(() => {
    if (selected && selected !== NEW && !dirty && !ctx.clients.some((c) => c.id === selected)) close();
    renderList();
    if (mode === "carte" && !root.hidden) dessinerCarte();
  });
  renderHub();
  renderList();

  return {
    async show(arg) {
      requestAnimationFrame(() => moveInk(root.querySelector(".seg"), root.querySelector(`[data-mode="${mode}"]`)));
      if (arg?.carte) setMode("carte");
      else if (arg?.clientId && arg.clientId !== selected && await canLeave()) { setMode("fiches"); open(ctx.clients.find((c) => c.id === arg.clientId)); }
      else if (mode === "carte") map?.invalidateSize();
    },
  };
}
