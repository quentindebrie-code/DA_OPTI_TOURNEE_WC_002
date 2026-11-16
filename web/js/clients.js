// Onglet « Base client » : liste, recherche, fiche avec points de livraison.
// Équivalent de la section « with tab_clients » de tournees.py.

import { PRODUITS_CATALOGUE, OPTIONS_WC, COULEURS_PRODUITS, esc, normTxt,
  couleursArret, couleursTexte, uid, geocode, toast, confirmer } from "./util.js";

const NEW = "__new__";

export function initClients(root, ctx) {
  let selected = null;   // null | NEW | id client
  let draft = null;      // { ...champs client, points: [{ uid, id, ...champs point }] }
  let dirty = false;
  let saving = false;

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h2>📇 Base client</h2>
        <p class="muted">Fiches clients réutilisées par la colonne <b>Client</b> de la saisie des arrêts.</p>
      </div>
      <div class="metrics">
        <div class="metric"><b data-m="clients">–</b><span>Clients</span></div>
        <div class="metric"><b data-m="points">–</b><span>Points de livraison</span></div>
      </div>
      <div class="head-actions">
        <button class="btn btn-primary" data-act="new">➕ Nouveau client</button>
        <button class="btn" data-act="refresh" title="Recharge la base (modifications faites par un collègue)">🔄 Actualiser</button>
      </div>
    </div>
    <div class="split">
      <aside class="card list-pane">
        <input type="search" class="search" placeholder="🔎 Nom, ville, adresse…" aria-label="Rechercher un client">
        <div class="client-list" role="list"></div>
      </aside>
      <div class="hub"></div>
    </div>
    <details class="card all-points">
      <summary>📋 Tous les points de livraison</summary>
      <div class="table-wrap"></div>
    </details>`;

  const $ = (s) => root.querySelector(s);
  const listEl = $(".client-list");
  const hubEl = $(".hub");
  const search = $(".search");

  // ── Liste ──────────────────────────────────────────────────────────────────
  function renderList() {
    const clients = ctx.clients;
    const q = normTxt(search.value);
    $("[data-m=clients]").textContent = clients.length;
    $("[data-m=points]").textContent = clients.reduce((n, c) => n + (c.points?.length || 0), 0);
    const filtres = clients.filter((c) => !q || normTxt([c.nom, c.contact,
      ...(c.points || []).map((p) => `${p.libelle} ${p.adresse}`)].join(" ")).includes(q));
    if (!clients.length) {
      listEl.innerHTML = `<p class="empty">Aucun client pour le moment.<br>Cliquez sur <b>➕ Nouveau client</b> pour créer la première fiche.</p>`;
    } else if (!filtres.length) {
      listEl.innerHTML = `<p class="empty">Aucun client ne correspond à la recherche.</p>`;
    } else {
      listEl.innerHTML = filtres.map((c) => {
        const n = c.points?.length || 0;
        const opt = c.option_produit ? ` + ${c.option_produit}` : "";
        return `<button class="client-item${c.id === selected ? " active" : ""}" data-id="${esc(c.id)}" role="listitem">
          <b>${esc(c.nom)}</b><span>${esc(c.produit)}${esc(opt)} · ${n} point${n > 1 ? "s" : ""}</span></button>`;
      }).join("");
    }
    renderAllPoints();
  }

  function renderAllPoints() {
    const rows = ctx.clients.flatMap((c) => (c.points || []).map((p) => `<tr>
      <td>${esc(c.nom)}</td><td>${esc(p.libelle)}</td><td>${esc(p.adresse)}</td>
      <td>${esc(c.produit)}${c.option_produit ? " + " + esc(c.option_produit) : ""}</td>
      <td class="num">${esc(c.quantite)}</td><td>${esc(c.couleurs)}</td>
      <td>${esc(p.pas_avant || c.pas_avant)}</td><td>${esc(p.pas_apres || c.pas_apres)}</td>
      <td>${esc(p.observations)}</td></tr>`));
    root.querySelector(".all-points summary").textContent = `📋 Tous les points de livraison (${rows.length})`;
    root.querySelector(".all-points .table-wrap").innerHTML = rows.length ? `<table class="table">
      <thead><tr><th>Client</th><th>Point</th><th>Adresse</th><th>Produit</th><th>Qté</th>
      <th>Couleurs</th><th>Pas avant</th><th>Pas après</th><th>Observation</th></tr></thead>
      <tbody>${rows.join("")}</tbody></table>` : `<p class="empty">Aucun point de livraison.</p>`;
  }

  listEl.addEventListener("click", async (e) => {
    const b = e.target.closest(".client-item");
    if (b && b.dataset.id !== selected && await canLeave()) open(ctx.clients.find((c) => c.id === b.dataset.id));
  });
  search.addEventListener("input", renderList);
  $("[data-act=new]").addEventListener("click", async () => { if (await canLeave()) open(null); });
  $("[data-act=refresh]").addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    await ctx.refreshClients();
    e.currentTarget.disabled = false;
    toast("Base client actualisée");
  });

  // ── Fiche ──────────────────────────────────────────────────────────────────
  async function canLeave() {
    return !dirty || confirmer("Modifications non enregistrées",
      "Les modifications de la fiche en cours seront perdues.", "Abandonner");
  }

  function newPoint(p = {}) {
    return { uid: uid(), id: p.id || null, libelle: p.libelle || "", adresse: p.adresse || "",
      pas_avant: p.pas_avant || "", pas_apres: p.pas_apres || "", observations: p.observations || "" };
  }

  function open(client) {
    const c = client || {};
    selected = client ? client.id : NEW;
    draft = {
      nom: c.nom || "", contact: c.contact || "", telephone: c.telephone || "", email: c.email || "",
      notes: c.notes || "",
      produit: PRODUITS_CATALOGUE.includes(c.produit) ? c.produit : "WC chimique",
      option_produit: client ? (c.option_produit || "") : "Lave-main",
      quantite: Number(c.quantite) || 1,
      couleurs: couleursArret(c.couleurs || ""),
      pas_avant: c.pas_avant || "", pas_apres: c.pas_apres || "",
      points: (c.points?.length ? c.points : [{}]).map(newPoint),
    };
    dirty = false;
    renderHub();
    renderList();
  }

  function close() {
    selected = null; draft = null; dirty = false;
    renderHub(); renderList();
  }

  const field = (label, name, attrs = "") =>
    `<label>${label}<input data-f="${name}" value="${esc(draft[name])}" ${attrs}></label>`;

  function renderHub() {
    if (!draft) {
      hubEl.innerHTML = `<div class="card placeholder">
        <h3>👈 Sélectionnez un client</h3>
        <p>Chaque fiche regroupe :</p>
        <ol><li><b>Identité</b> — nom, contact, téléphone</li>
        <li><b>Prestation habituelle</b> — produit, option, quantité, couleurs et fenêtre d'intervention par défaut</li>
        <li><b>Points de livraison</b> — une ou plusieurs adresses, chacune avec sa fenêtre et son observation</li></ol></div>`;
      return;
    }
    const isNew = selected === NEW;
    hubEl.innerHTML = `
      <form class="fiche" novalidate>
        <h3 class="fiche-title">${isNew ? "🆕" : "🏢"} <span>${esc(draft.nom || "Nouveau client")}</span></h3>
        <fieldset class="card">
          <legend>① Identité</legend>
          <div class="grid2">
            ${field("Nom du client *", "nom", 'placeholder="ex : SARL Martin BTP" required')}
            ${field("Contact sur place", "contact", 'placeholder="ex : M. Durand"')}
            ${field("📞 Téléphone", "telephone", 'type="tel"')}
            ${field("✉️ E-mail", "email", 'type="email"')}
          </div>
          <label>Notes internes<textarea data-f="notes" rows="2"
            placeholder="Facturation, particularités du client… (non reprises dans la tournée)">${esc(draft.notes)}</textarea></label>
        </fieldset>

        <fieldset class="card">
          <legend>② Prestation habituelle</legend>
          <p class="muted small">Reprise automatiquement à chaque sélection du client dans la saisie (modifiable ligne par ligne).</p>
          <div class="grid3">
            <label>Produit<select data-f="produit">${PRODUITS_CATALOGUE.map((p) =>
              `<option${p === draft.produit ? " selected" : ""}>${esc(p)}</option>`).join("")}</select></label>
            <label>Option<select data-f="option_produit" title="Réservée au WC chimique">${OPTIONS_WC.map((o) =>
              `<option value="${esc(o)}"${o === draft.option_produit ? " selected" : ""}>${esc(o || "— Aucune —")}</option>`).join("")}</select></label>
            <label>Quantité<input data-f="quantite" type="number" min="1" max="20" step="1" value="${draft.quantite}"></label>
          </div>
          <div class="label">🎨 Couleurs acceptées <span class="muted small">(aucune = toutes couleurs)</span></div>
          <div class="chips" role="group" aria-label="Couleurs acceptées">${COULEURS_PRODUITS.map((c) =>
            `<label class="chip"><input type="checkbox" data-couleur="${esc(c)}"${draft.couleurs.includes(c) ? " checked" : ""}>${esc(c)}</label>`).join("")}</div>
          <p class="warn" data-warn-option hidden>🚽 Un WC chimique doit être accompagné d'un <b>Lave-main</b> ou d'un <b>Urinoir</b> (art. R4228-7).</p>
          <div class="label">⏰ Fenêtre d'intervention par défaut</div>
          <div class="grid3 align-end">
            ${field("Pas avant", "pas_avant", 'type="time" step="300"')}
            ${field("Pas après", "pas_apres", 'type="time" step="300"')}
            <p class="muted small">S'applique à tous les points, sauf s'ils ont leur propre fenêtre. Vide = aucune contrainte.</p>
          </div>
        </fieldset>

        <fieldset class="card">
          <legend>③ Points de livraison (<span data-nb-points></span>)</legend>
          <p class="muted small">Un même client peut être livré à plusieurs adresses (chantiers, sites, événements).</p>
          <div class="points"></div>
          <button type="button" class="btn btn-block" data-act="add-point">➕ Ajouter un point de livraison</button>
        </fieldset>

        <div class="form-error" role="alert" hidden></div>
        <div class="row fiche-actions">
          <button type="submit" class="btn btn-primary">💾 Enregistrer la fiche</button>
          <button type="button" class="btn" data-act="close">${isNew ? "✖ Annuler" : "✖ Fermer"}</button>
          ${isNew ? "" : `<button type="button" class="btn" data-act="map">🗺️ Voir sur la carte</button>
          <button type="button" class="btn btn-danger-ghost" data-act="delete">🗑️ Supprimer</button>`}
        </div>
      </form>`;
    renderPoints();
    syncOption();
  }

  function renderPoints() {
    const box = hubEl.querySelector(".points");
    const pts = draft.points;
    hubEl.querySelector("[data-nb-points]").textContent = pts.length;
    box.innerHTML = pts.map((p, i) => `
      <div class="point card-inner" data-uid="${p.uid}">
        <div class="point-row1">
          <label>Point n°${i + 1} — libellé<input data-p="libelle" value="${esc(p.libelle)}" placeholder="ex : Chantier Gaillac"></label>
          <label>📍 Adresse complète *<input data-p="adresse" value="${esc(p.adresse)}" placeholder="ex : Place d'Hautpoul 81600 Gaillac"></label>
          <button type="button" class="btn btn-icon" data-act="del-point" title="Retirer ce point de livraison"
            aria-label="Retirer le point n°${i + 1}"${pts.length <= 1 ? " disabled" : ""}>🗑️</button>
        </div>
        <div class="point-row2">
          <label>Pas avant<input data-p="pas_avant" type="time" step="300" value="${esc(p.pas_avant)}"
            title="Vide = fenêtre du client (${esc(draft.pas_avant || "aucune")})"></label>
          <label>Pas après<input data-p="pas_apres" type="time" step="300" value="${esc(p.pas_apres)}"
            title="Vide = fenêtre du client (${esc(draft.pas_apres || "aucune")})"></label>
          <label>📝 Observation<input data-p="observations" value="${esc(p.observations)}" placeholder="Code portail, accès, contact…"></label>
        </div>
        <div class="row geo">
          <button type="button" class="btn btn-sm" data-act="geo"${p.adresse.trim() ? "" : " disabled"}>📍 Vérifier l'adresse</button>
          <span class="geo-res small"></span>
        </div>
      </div>`).join("");
  }

  function syncOption() {
    const isWc = draft.produit === "WC chimique";
    const sel = hubEl.querySelector("[data-f=option_produit]");
    sel.disabled = !isWc;
    hubEl.querySelector("[data-warn-option]").hidden = !(isWc && !draft.option_produit);
  }

  // Saisie : délégation d'événements sur toute la fiche.
  hubEl.addEventListener("input", (e) => {
    if (!draft) return;
    const t = e.target;
    if (t.dataset.f) {
      draft[t.dataset.f] = t.value;
      if (t.dataset.f === "nom") hubEl.querySelector(".fiche-title span").textContent = t.value || "Nouveau client";
      if (t.dataset.f === "produit" || t.dataset.f === "option_produit") syncOption();
    } else if (t.dataset.p) {
      const card = t.closest(".point");
      const p = draft.points.find((x) => x.uid === card.dataset.uid);
      p[t.dataset.p] = t.value;
      if (t.dataset.p === "adresse") {
        card.querySelector("[data-act=geo]").disabled = !t.value.trim();
        card.querySelector(".geo-res").textContent = "";
      }
    } else if (t.dataset.couleur) {
      draft.couleurs = [...hubEl.querySelectorAll("[data-couleur]:checked")].map((x) => x.dataset.couleur);
    }
    dirty = true;
  });

  hubEl.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || !draft) return;
    const act = b.dataset.act;
    if (act === "add-point") {
      draft.points.push(newPoint());
      dirty = true;
      renderPoints();
      hubEl.querySelector(".point:last-child [data-p=libelle]").focus();
    } else if (act === "del-point") {
      const u = b.closest(".point").dataset.uid;
      draft.points = draft.points.filter((p) => p.uid !== u);
      dirty = true;
      renderPoints();
    } else if (act === "geo") {
      const card = b.closest(".point");
      const res = card.querySelector(".geo-res");
      const addr = draft.points.find((x) => x.uid === card.dataset.uid).adresse.trim();
      res.className = "geo-res small muted";
      res.textContent = "Géocodage…";
      try {
        const g = await geocode(addr);
        if (g) {
          res.className = "geo-res small ok";
          res.textContent = `✅ ${g.label} (${g.lat.toFixed(5)}, ${g.lon.toFixed(5)})`
            + (g.score < 0.6 ? " — correspondance approximative, vérifiez" : "");
        } else {
          res.className = "geo-res small err";
          res.textContent = "⚠️ Adresse introuvable : précisez la rue, le code postal et la ville.";
        }
      } catch (err) {
        res.className = "geo-res small err";
        res.textContent = "⚠️ " + err.message;
      }
    } else if (act === "close") {
      if (await canLeave()) close();
    } else if (act === "map") {
      if (await canLeave()) ctx.goto("carte", { clientId: selected });
    } else if (act === "delete") {
      const n = draft.points.length;
      if (!await confirmer(`Supprimer « ${draft.nom} » ?`,
        `La fiche et ses ${n} point(s) de livraison seront supprimés définitivement. Les tournées déjà saisies ne sont pas modifiées.`,
        "Supprimer")) return;
      try {
        await ctx.store.deleteClient(selected);
        toast(`Fiche « ${draft.nom} » supprimée`);
        dirty = false;
        selected = null; draft = null;
        await ctx.refreshClients();
        renderHub();
      } catch (err) { toast(err.message, "err"); }
    }
  });

  function collect() {
    const erreurs = [];
    const client = {
      id: selected === NEW ? null : selected,
      nom: draft.nom.trim(), contact: draft.contact.trim(), telephone: draft.telephone.trim(),
      email: draft.email.trim(), notes: draft.notes.trim(), produit: draft.produit,
      option_produit: draft.produit === "WC chimique" ? draft.option_produit || "" : "",
      quantite: Math.min(20, Math.max(1, parseInt(draft.quantite, 10) || 1)),
      couleurs: couleursTexte(draft.couleurs),
      pas_avant: draft.pas_avant, pas_apres: draft.pas_apres,
    };
    if (!client.nom) erreurs.push("Le nom du client est obligatoire.");
    if (client.pas_avant && client.pas_apres && client.pas_avant >= client.pas_apres) {
      erreurs.push("Fenêtre par défaut : « Pas avant » doit précéder « Pas après ».");
    }
    const points = [];
    draft.points.forEach((p, i) => {
      const pt = { id: p.id, libelle: p.libelle.trim(), adresse: p.adresse.trim(),
        pas_avant: p.pas_avant, pas_apres: p.pas_apres, observations: p.observations.trim() };
      if (![pt.libelle, pt.adresse, pt.pas_avant, pt.pas_apres, pt.observations].some(Boolean)) return;
      if (!pt.adresse) erreurs.push(`Point de livraison n°${i + 1} : l'adresse est obligatoire.`);
      if (pt.pas_avant && pt.pas_apres && pt.pas_avant >= pt.pas_apres) {
        erreurs.push(`Point de livraison n°${i + 1} : « Pas avant » doit précéder « Pas après ».`);
      }
      points.push(pt);
    });
    if (!points.length) erreurs.push("Renseignez au moins un point de livraison (adresse).");
    return { client, points, erreurs };
  }

  hubEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (saving) return;
    const errBox = hubEl.querySelector(".form-error");
    const { client, points, erreurs } = collect();
    errBox.hidden = !erreurs.length;
    errBox.innerHTML = erreurs.map((x) => `• ${esc(x)}`).join("<br>");
    if (erreurs.length) return;
    const btn = hubEl.querySelector("[type=submit]");
    saving = true;
    btn.disabled = true;
    btn.textContent = "Enregistrement…";
    try {
      const id = await ctx.store.saveClient(client, points);
      dirty = false;
      await ctx.refreshClients();
      const saved = ctx.clients.find((c) => c.id === id);
      saved ? open(saved) : close();
      toast(`✅ Fiche « ${client.nom} » enregistrée`);
    } catch (err) {
      errBox.hidden = false;
      errBox.textContent = "❌ " + err.message;
      btn.disabled = false;
      btn.textContent = "💾 Enregistrer la fiche";
    } finally {
      saving = false;
    }
  });

  window.addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });

  ctx.onClients(() => {
    // Un collègue a pu supprimer la fiche ouverte : on la referme si elle n'existe plus.
    if (selected && selected !== NEW && !dirty && !ctx.clients.some((c) => c.id === selected)) {
      selected = null; draft = null; renderHub();
    }
    renderList();
  });
  renderHub();

  return {
    async show(arg) {
      if (arg?.clientId && arg.clientId !== selected && await canLeave()) {
        open(ctx.clients.find((c) => c.id === arg.clientId));
      }
    },
  };
}
