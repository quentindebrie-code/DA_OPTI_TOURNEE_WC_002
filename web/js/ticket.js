// Demandes d'assistance : enregistrées dans Supabase (table « tickets ») et envoyées
// par e-mail au support via FormSubmit (service gratuit, sans serveur).

import { icon } from "./icons.js?v=202611162100";
import { esc, ouvrirDialog, closeDialog, toast, withBusy } from "./util.js?v=202611162100";

export const SUPPORT_EMAIL = "quentin.d@hympyr.fr";
const SUJETS = ["Signaler un problème", "Proposer une amélioration", "Poser une question", "Mot de passe oublié", "Autre demande"];

/** sb : client Supabase (facultatif) ; email : adresse connue de l'utilisateur. */
export function ouvrirTicket({ sb = null, email = "", sujet = SUJETS[0], page = "" } = {}) {
  const dlg = ouvrirDialog(`
    <div class="dlg-head">${icon("support", "i-lg")}<h2>Contacter l'assistance</h2>
      <button class="btn btn-ghost btn-icon btn-sm" data-close aria-label="Fermer">${icon("x")}</button></div>
    <form class="stack" novalidate>
      <label>Motif<select name="sujet">${SUJETS.map((s) => `<option${s === sujet ? " selected" : ""}>${esc(s)}</option>`).join("")}</select></label>
      <label>Votre e-mail<input type="email" name="email" autocomplete="email" value="${esc(email)}" required></label>
      <label>Message<textarea name="message" rows="5" placeholder="Décrivez votre demande"></textarea></label>
      <p class="note err" role="alert" hidden></p>
      <div class="dlg-actions">
        <button type="button" class="btn" data-close>Annuler</button>
        <button type="submit" class="btn btn-primary">${icon("send")}<span>Envoyer</span></button>
      </div>
    </form>`);
  const form = dlg.querySelector("form");
  const err = dlg.querySelector(".note.err");
  if (sujet === "Mot de passe oublié") form.message.placeholder = "Indiquez si besoin le poste ou le nom de la personne concernée.";
  (email ? form.message : form.email).focus();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = { sujet: form.sujet.value, email: form.email.value.trim(), message: form.message.value.trim(), page };
    form.email.removeAttribute("aria-invalid");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) {
      form.email.setAttribute("aria-invalid", "true");
      err.hidden = false; err.textContent = "Indiquez une adresse e-mail valide pour recevoir la réponse.";
      form.email.focus();
      return;
    }
    if (!data.message && data.sujet !== "Mot de passe oublié") {
      err.hidden = false; err.textContent = "Ajoutez quelques mots pour décrire votre demande.";
      form.message.focus();
      return;
    }
    err.hidden = true;
    await withBusy(form.querySelector("[type=submit]"), "Envoi…", async () => {
      const ok = await envoyer(data, sb);
      if (ok) {
        closeDialog(dlg);
        toast("Demande envoyée. Vous recevrez une réponse par e-mail.");
      } else {
        err.hidden = false;
        err.innerHTML = `L'envoi n'a pas abouti. <a href="mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(data.sujet)}&body=${encodeURIComponent(data.message)}">Écrire directement à ${SUPPORT_EMAIL}</a>`;
      }
    });
  });
}

async function envoyer(d, sb) {
  const navigateur = navigator.userAgent.slice(0, 300);
  const tasks = [];
  if (sb) {
    tasks.push(sb.from("tickets").insert({ email: d.email, sujet: d.sujet, message: d.message, page: d.page, navigateur })
      .then(({ error }) => { if (error) throw error; }));
  }
  tasks.push(fetch(`https://formsubmit.co/ajax/${SUPPORT_EMAIL}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ _subject: `[Tournées Deldossi] ${d.sujet}`, _template: "table", _captcha: "false",
      Motif: d.sujet, "E-mail": d.email, Message: d.message || "(sans message)", Écran: d.page, Navigateur: navigateur }),
  }).then(async (r) => { if (!r.ok) throw new Error(String(r.status)); }));
  const res = await Promise.allSettled(tasks);
  return res.some((r) => r.status === "fulfilled");
}
