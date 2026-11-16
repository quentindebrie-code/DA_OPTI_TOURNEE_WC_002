// Point d'entrée : connexion, chargement des données (cache local puis réseau),
// navigation avec transitions, pastille de contexte, assistance.

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../config.js?v=202611161929";
import { SupabaseStore, DemoStore } from "./store.js?v=202611161929";
import { toast, initInteractions, moveInk, fmtDate, reduceMotion } from "./util.js?v=202611161929";
import { icon } from "./icons.js?v=202611161929";
import { logoHtml } from "./logo.js?v=202611161929";
import { S, on, initState, resultatObsolete } from "./state.js?v=202611161929";
import { ouvrirTicket } from "./ticket.js?v=202611161929";

const $ = (s) => document.querySelector(s);
// « ?demo » dans l'adresse force le mode démo (données fictives locales).
const DEMO = !SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || new URLSearchParams(location.search).has("demo");
const VIEWS = ["accueil", "saisie", "tournee", "clients", "stock"];
const ALIAS = { export: "tournee", carte: "clients" };

// ── Habillage statique (logo, icônes de navigation) ──────────────────────────
document.querySelectorAll(".brand, .logo-slot").forEach((el) => { el.innerHTML = logoHtml(); });
document.querySelectorAll("[data-ic]").forEach((a) => { a.insertAdjacentHTML("afterbegin", icon(a.dataset.ic)); });
$("#help-fab").innerHTML = icon("support");
$("#logout").innerHTML = icon("logout");
initInteractions();

// ── État partagé ─────────────────────────────────────────────────────────────
const ctx = {
  store: null, sb: null, email: "", demo: DEMO,
  clients: [], listeners: new Set(),
  cacheKey() { return `cache-clients-v1:${DEMO ? "demo" : ctx.email}`; },
  async refreshClients() {
    try {
      ctx.clients = await ctx.store.listClients();
      try { localStorage.setItem(ctx.cacheKey(), JSON.stringify(ctx.clients)); } catch { /* quota */ }
    } catch (e) { toast("Base client indisponible : " + e.message, "err"); }
    ctx.listeners.forEach((fn) => fn(ctx.clients));
    return ctx.clients;
  },
  onClients(fn) { ctx.listeners.add(fn); },
  goto(view, arg) { ctx.pending = arg; if (location.hash === "#" + view) route(); else location.hash = view; },
  ticket(sujet) { ouvrirTicket({ sb: ctx.sb, email: ctx.email, sujet, page: currentView }); },
};

// ── Navigation ───────────────────────────────────────────────────────────────
const views = {};
let started = false;
let currentView = null;

function route() {
  if (!started) return;
  let name = location.hash.replace("#", "").split("?")[0];
  if (ALIAS[name]) { if (name === "carte") ctx.pending = { carte: true }; name = ALIAS[name]; }
  const view = VIEWS.includes(name) ? name : "accueil";
  const arg = ctx.pending; ctx.pending = undefined;
  const apply = () => {
    document.body.dataset.view = view;
    document.querySelectorAll("a[data-view]").forEach((a) => {
      if (a.dataset.view === view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    document.querySelectorAll(".view").forEach((s) => { s.hidden = s.id !== `view-${view}`; });
    moveInk($(".topnav"), $(`.topnav a[data-view="${view}"]`));
    if (currentView !== view) scrollTo({ top: 0, behavior: "instant" });
    currentView = view;
    views[view]?.show?.(arg);
  };
  if (document.startViewTransition && !reduceMotion() && currentView && currentView !== view) document.startViewTransition(apply);
  else apply();
}
addEventListener("hashchange", route);
addEventListener("resize", () => moveInk($(".topnav"), $(".topnav a[aria-current]")));
document.fonts?.ready.then(() => moveInk($(".topnav"), $(".topnav a[aria-current]")));

function majContexte() {
  const pill = $("#ctx-pill");
  const T = S.tournee;
  const nom = T.nom || "Nouvelle tournée";
  pill.querySelector("span").textContent = `${nom} · ${fmtDate(S.params.tourDate)}${DEMO ? " · démo" : ""}`;
  pill.classList.toggle("unsaved", !T.id);
  pill.classList.toggle("demo", DEMO);
  pill.title = T.id ? "Tournée enregistrée" : "Tournée non enregistrée";
  const dot = resultatObsolete() ? '<i class="badge-dot" aria-label="Tournée à recalculer"></i>' : "";
  document.querySelectorAll('.bottom-nav a[data-view="tournee"] .badge-dot').forEach((d) => d.remove());
  if (dot) $('.bottom-nav a[data-view="tournee"]').insertAdjacentHTML("beforeend", dot);
}

async function startApp(email) {
  ctx.email = email || "";
  if (started) return;
  started = true;
  // Affichage immédiat depuis le cache local, rafraîchissement en arrière-plan.
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(ctx.cacheKey()) || "null"); } catch { /* cache illisible */ }
  if (cached) ctx.clients = cached;
  const [mods] = await Promise.all([
    Promise.all([import("./accueil.js?v=202611161929"), import("./saisie.js?v=202611161929"), import("./tournee.js?v=202611161929"), import("./clients.js?v=202611161929"), import("./stock.js?v=202611161929")]),
    initState(ctx.store),
    cached ? null : ctx.refreshClients(),
  ]);
  const [acc, sai, tou, cli, sto] = mods;
  views.accueil = acc.initAccueil($("#view-accueil"), ctx);
  views.saisie = sai.initSaisie($("#view-saisie"), ctx);
  views.tournee = tou.initTournee($("#view-tournee"), ctx);
  views.clients = cli.initClients($("#view-clients"), ctx);
  views.stock = sto.initStock($("#view-stock"), ctx);
  ctx.listeners.forEach((fn) => fn(ctx.clients));
  if (cached) ctx.refreshClients();
  ["tournee", "params", "result", "stops"].forEach((e) => on(e, majContexte));
  majContexte();

  $("#login").hidden = true;
  $("#app").hidden = false;
  route();
  const boot = $("#boot");
  boot.classList.add("out");
  setTimeout(() => boot.remove(), 600);
}

function showLogin(mode = "login") {
  const boot = $("#boot");
  if (boot) { boot.classList.add("out"); setTimeout(() => boot.remove(), 600); }
  $("#app").hidden = true;
  $("#login").hidden = false;
  $("#login-form").hidden = mode !== "login";
  $("#newpwd-form").hidden = mode !== "newpwd";
  setTimeout(() => (mode === "login" ? $("#login-form input[name=email]") : $("#newpwd-form input")).focus(), 50);
}
function formError(id, msg) { const el = $(id); el.textContent = msg || ""; el.hidden = !msg; }

$("#help-fab").addEventListener("click", () => ctx.ticket());
$("#forgot").addEventListener("click", () => {
  const email = $("#login-form input[name=email]").value.trim();
  ouvrirTicket({ sb: ctx.sb, email, sujet: "Mot de passe oublié", page: "connexion" });
});
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && started) { e.preventDefault(); views.saisie?.enregistrer?.(); }
});

// ── Démarrage ────────────────────────────────────────────────────────────────
if (DEMO) {
  ctx.store = new DemoStore();
  startApp("");
} else {
  let recovery = /type=(recovery|invite)/.test(location.hash);   // lu avant createClient
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm");
  const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  ctx.sb = sb;
  ctx.store = new SupabaseStore(sb);
  $("#logout").hidden = false;

  async function enter(session) {
    // Les règles d'accès filtrent en silence : un compte hors équipe verrait une base vide.
    const { data: ok, error } = await sb.rpc("est_membre");
    if (error || !ok) {
      await sb.auth.signOut({ scope: "local" });
      showLogin();
      formError("#login-error", error ? "Connexion impossible pour le moment. Réessayez dans un instant."
        : "Ce compte n'a pas encore accès à l'outil. Utilisez « Mot de passe oublié ? » pour contacter l'assistance.");
      return;
    }
    startApp(session.user.email);
  }

  sb.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY" || (recovery && session)) { recovery = true; return showLogin("newpwd"); }
    if (event === "SIGNED_OUT") {
      try { localStorage.removeItem(ctx.cacheKey()); } catch { /* rien */ }
      if (started) { location.hash = ""; location.reload(); }
      return;
    }
    if (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) setTimeout(() => enter(session), 0);
    else if (event === "INITIAL_SESSION") showLogin();
  });

  $("#login-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const btn = ev.target.querySelector("[type=submit]");
    btn.disabled = true; btn.setAttribute("aria-busy", "true"); btn.textContent = "Connexion…";
    formError("#login-error");
    const { error } = await sb.auth.signInWithPassword({ email: String(f.get("email")).trim(), password: String(f.get("password")) });
    btn.disabled = false; btn.removeAttribute("aria-busy"); btn.textContent = "Se connecter";
    if (error) formError("#login-error", /invalid/i.test(error.message) ? "E-mail ou mot de passe incorrect." : "Connexion impossible pour le moment.");
  });

  $("#newpwd-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const password = new FormData(ev.target).get("password");
    const { data, error } = await sb.auth.updateUser({ password });
    if (error) return formError("#newpwd-error", "Ce mot de passe n'a pas pu être enregistré.");
    toast("Mot de passe enregistré");
    recovery = false;
    history.replaceState(null, "", location.pathname);
    enter({ user: data.user });
  });

  $("#logout").addEventListener("click", () => sb.auth.signOut());
}
