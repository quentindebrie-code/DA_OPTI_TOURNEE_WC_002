// Point d'entrée : authentification, navigation par onglets, état partagé.

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../config.js";
import { SupabaseStore, DemoStore } from "./store.js";
import { toast } from "./util.js";
import { initClients } from "./clients.js";
import { initCarte } from "./carte.js";
import { initState } from "./state.js";
import { initSaisie } from "./saisie.js";
import { initTournee } from "./tournee.js";
import { initStock } from "./stock.js";
import { initExport } from "./export.js";

const $ = (s) => document.querySelector(s);
const DEMO = !SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY;

// ── État partagé entre les onglets ───────────────────────────────────────────
const ctx = {
  store: null,
  clients: [],
  listeners: new Set(),
  async refreshClients() {
    try {
      ctx.clients = await ctx.store.listClients();
    } catch (e) {
      toast(e.message, "err");
    }
    ctx.listeners.forEach((fn) => fn(ctx.clients));
    return ctx.clients;
  },
  onClients(fn) { ctx.listeners.add(fn); },
  goto(view, arg) { ctx.pending = arg; location.hash = view; route(); },
};

// ── Navigation ───────────────────────────────────────────────────────────────
const views = {};
let started = false;

function route() {
  if (!started) return;
  const name = location.hash.replace("#", "") || "saisie";
  const view = views[name] ? name : "saisie";
  document.querySelectorAll(".tabs a").forEach((a) =>
    a.setAttribute("aria-selected", String(a.dataset.view === view)));
  document.querySelectorAll(".view").forEach((s) => { s.hidden = s.id !== `view-${view}`; });
  views[view].show?.(ctx.pending);
  ctx.pending = undefined;
}
window.addEventListener("hashchange", route);

async function startApp(email) {
  $("#login").hidden = true;
  $("#boot").hidden = true;
  $("#app").hidden = false;
  $("#store-badge").textContent = ctx.store.label;
  $("#store-badge").classList.toggle("badge-warn", !ctx.store.persistent);
  $("#user-email").textContent = email || "";
  if (started) return;
  started = true;
  await ctx.refreshClients();
  await initState(ctx.store);
  views.saisie = initSaisie($("#view-saisie"), ctx);
  views.clients = initClients($("#view-clients"), ctx);
  views.tournee = initTournee($("#view-tournee"), ctx);
  views.stock = initStock($("#view-stock"), ctx);
  views.export = initExport($("#view-export"), ctx);
  views.carte = initCarte($("#view-carte"), ctx);
  ctx.listeners.forEach((fn) => fn(ctx.clients));
  route();
}

function showLogin(mode = "login") {
  $("#boot").hidden = true;
  $("#app").hidden = true;
  $("#login").hidden = false;
  $("#login-form").hidden = mode !== "login";
  $("#newpwd-form").hidden = mode !== "newpwd";
  (mode === "login" ? $("#login-form input[name=email]") : $("#newpwd-form input")).focus();
}

function formError(id, msg) {
  const el = $(id);
  el.textContent = msg || "";
  el.hidden = !msg;
}

// ── Démarrage ────────────────────────────────────────────────────────────────
if (DEMO) {
  ctx.store = new DemoStore();
  $("#demo-banner").hidden = false;
  $("#demo-reset").addEventListener("click", async () => {
    ctx.store.reset();
    await ctx.refreshClients();
    toast("Données de démonstration réinitialisées");
  });
  startApp("");
} else {
  // Lien « mot de passe oublié » / invitation : on demande d'abord un mot de passe.
  // (lu avant createClient, qui efface ensuite le fragment de l'URL)
  let recovery = /type=(recovery|invite)/.test(location.hash);
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm");
  const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  ctx.store = new SupabaseStore(sb);
  $("#logout").hidden = false;


  async function enter(session) {
    // Les politiques RLS filtrent silencieusement : un compte hors équipe verrait
    // une base vide. On le détecte explicitement.
    const { data: ok, error } = await sb.rpc("est_membre");
    if (error || !ok) {
      await sb.auth.signOut({ scope: "local" });
      showLogin();
      formError("#login-error", error ? error.message
        : "Ce compte n'a pas accès aux données : demandez à l'administrateur d'ajouter votre e-mail à l'équipe.");
      return;
    }
    startApp(session.user.email);
  }

  sb.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY" || (recovery && session)) {
      recovery = true;
      return showLogin("newpwd");
    }
    if (event === "SIGNED_OUT") { if (started) { location.hash = ""; location.reload(); } return; }
    if (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
      // Laisse supabase-js terminer son traitement avant de lancer des requêtes.
      setTimeout(() => enter(session), 0);
    } else if (event === "INITIAL_SESSION") {
      showLogin();
    }
  });

  $("#login-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const btn = ev.target.querySelector("[type=submit]");
    btn.disabled = true;
    formError("#login-error");
    const { error } = await sb.auth.signInWithPassword({
      email: String(f.get("email")).trim(), password: String(f.get("password")) });
    btn.disabled = false;
    if (error) {
      formError("#login-error", /invalid/i.test(error.message)
        ? "E-mail ou mot de passe incorrect." : error.message);
    }
  });

  $("#forgot").addEventListener("click", async () => {
    const email = $("#login-form input[name=email]").value.trim();
    if (!email) return formError("#login-error", "Saisissez d'abord votre e-mail.");
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + location.pathname });
    if (error) formError("#login-error", error.message);
    else toast("Si ce compte existe, un e-mail de réinitialisation vient d'être envoyé.");
  });

  $("#newpwd-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const password = new FormData(ev.target).get("password");
    const { data, error } = await sb.auth.updateUser({ password });
    if (error) return formError("#newpwd-error", error.message);
    toast("Mot de passe enregistré");
    recovery = false;
    history.replaceState(null, "", location.pathname);
    enter({ user: data.user });
  });

  $("#logout").addEventListener("click", () => sb.auth.signOut());
}
