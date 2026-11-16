// Accès aux données : Supabase (supabase-js) ou mode démo (localStorage).
// Même interface que supabase_store.py pour faciliter le portage.

import { uid } from "./util.js?v=202611162108";
import { stockDefaut } from "./metier.js?v=202611162108";

export const CLIENT_FIELDS = ["nom", "contact", "telephone", "email", "produit",
  "option_produit", "quantite", "couleurs", "pas_avant", "pas_apres", "notes"];
export const POINT_FIELDS = ["libelle", "adresse", "pas_avant", "pas_apres", "observations"];

const pick = (obj, keys, dflt = "") =>
  Object.fromEntries(keys.map((k) => [k, obj[k] ?? dflt]));

function erreur(e) {
  const msg = e?.message || String(e);
  if (/row-level security|permission denied|JWT/i.test(msg)) {
    return new Error("accès refusé pour ce compte");
  }
  if (/Failed to fetch|NetworkError/i.test(msg)) return new Error("connexion au serveur impossible");
  return new Error(msg);
}

// ═════════════════════════════════════════════════════════════════════════════
export class SupabaseStore {
  persistent = true;
  label = "Supabase";

  constructor(client) { this.sb = client; }

  async #run(promise) {
    const { data, error } = await promise;
    if (error) throw erreur(error);
    return data;
  }

  async listClients() {
    const rows = await this.#run(this.sb.from("clients")
      .select("*,points_livraison(*)").order("nom", { ascending: true }));
    return rows.map(({ points_livraison, ...c }) => ({
      ...c, points: (points_livraison || []).sort((a, b) => (a.position || 0) - (b.position || 0)),
    }));
  }

  async saveClient(client, points) {
    return this.#run(this.sb.rpc("save_client", {
      p_client: { id: client.id || null, ...pick(client, CLIENT_FIELDS) },
      p_points: points.map((p) => ({ id: p.id || null, ...pick(p, POINT_FIELDS) })),
    }));
  }

  async deleteClient(id) {
    await this.#run(this.sb.from("clients").delete().eq("id", id));
  }

  async listTournees() {
    return this.#run(this.sb.from("tournees")
      .select("id,nom,tour_date,chauffeur,nb_arrets,stats,created_at,updated_at")
      .order("updated_at", { ascending: false }));
  }

  async getTournee(id) {
    const rows = await this.#run(this.sb.from("tournees").select("*").eq("id", id));
    return rows[0] || null;
  }

  async saveTournee(id, nom, tourDate, chauffeur, stops, meta, stats = {}) {
    const body = { nom, tour_date: tourDate || null, chauffeur, nb_arrets: stops.length, stops, meta, stats,
      updated_at: new Date().toISOString() };
    if (id) {
      const rows = await this.#run(this.sb.from("tournees").update(body).eq("id", id).select("id"));
      if (rows.length) return rows[0].id;
      // supprimée entre-temps par un collègue : on la recrée
    }
    const rows = await this.#run(this.sb.from("tournees").insert(body).select("id"));
    return rows[0].id;
  }

  async deleteTournee(id) {
    await this.#run(this.sb.from("tournees").delete().eq("id", id));
  }

  async loadStock() {
    const rows = await this.#run(this.sb.from("stock").select("*"));
    const maj = rows.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), "") || null;
    return { rows, maj };
  }

  async saveStock(rows) {
    await this.#run(this.sb.rpc("replace_stock", { p_rows: rows.map((r) => ({
      article: r.article, couleur: r.couleur || "", installes: r.installes, en_stock: r.en_stock })) }));
  }

  async getSetting(cle) {
    const rows = await this.#run(this.sb.from("parametres").select("valeur").eq("cle", cle));
    return rows[0]?.valeur ?? null;
  }

  async setSetting(cle, valeur) {
    await this.#run(this.sb.from("parametres").upsert({ cle, valeur, updated_at: new Date().toISOString() }));
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Mode démo : données fictives conservées dans ce navigateur uniquement.
const DEMO_KEY = "demo-store-v2";

function demoSeed() {
  const now = new Date().toISOString();
  const c1 = uid(), c2 = uid(), c3 = uid();
  const today = new Date().toISOString().slice(0, 10);
  return {
    clients: {
      [c1]: { id: c1, nom: "Exemple BTP (démo)", contact: "Responsable chantier", telephone: "",
        email: "", produit: "WC chimique", option_produit: "Lave-main", quantite: 2,
        couleurs: "Vert, Bleu", pas_avant: "08:00", pas_apres: "12:00", notes: "Client fictif",
        created_at: now, updated_at: now,
        points: [
          { id: uid(), client_id: c1, position: 0, libelle: "Chantier Gaillac",
            adresse: "Place d'Hautpoul 81600 Gaillac", pas_avant: "", pas_apres: "", observations: "" },
          { id: uid(), client_id: c1, position: 1, libelle: "Chantier Lavaur",
            adresse: "Place du Plo 81500 Lavaur", pas_avant: "09:00", pas_apres: "11:00",
            observations: "Accès par la rue latérale" },
        ] },
      [c2]: { id: c2, nom: "Festival de démonstration", contact: "", telephone: "", email: "",
        produit: "WC handicapé", option_produit: "", quantite: 1, couleurs: "",
        pas_avant: "", pas_apres: "", notes: "", created_at: now, updated_at: now,
        points: [{ id: uid(), client_id: c2, position: 0, libelle: "Site principal",
          adresse: "Place du Vigan 81000 Albi", pas_avant: "", pas_apres: "", observations: "" }] },
      [c3]: { id: c3, nom: "Mairie fictive", contact: "", telephone: "", email: "",
        produit: "WC chimique", option_produit: "Urinoir", quantite: 1, couleurs: "Gris",
        pas_avant: "", pas_apres: "16:00", notes: "", created_at: now, updated_at: now,
        points: [{ id: uid(), client_id: c3, position: 0, libelle: "",
          adresse: "Place du Capitole 31000 Toulouse", pas_avant: "", pas_apres: "", observations: "" }] },
    },
    tournees: {
      t1: { id: "t1", nom: "Tournée de démonstration", tour_date: today, chauffeur: "Chauffeur A",
        nb_arrets: 4, created_at: now, updated_at: now,
        meta: { depot_depart_key: "Saint-Sulpice", depot_retour_key: "Saint-Sulpice", heure_min_depart: "07:00" },
        stops: [
          { "Client": "Exemple BTP (démo)", "Action": "Déposer", "Produit": "WC chimique", "Option": "Lave-main",
            "Couleur": "Vert", "Quantité": 2, "Nom du client": "Exemple BTP (démo)",
            "Adresse": "Place d'Hautpoul 81600 Gaillac", "Durée (min)": 40, "Pas avant": "08:00", "Pas après": "12:00", "Observations": "" },
          { "Client": "Festival de démonstration", "Action": "Nettoyer", "Produit": "WC handicapé", "Option": "",
            "Couleur": "", "Quantité": 1, "Nom du client": "Festival de démonstration",
            "Adresse": "Place du Vigan 81000 Albi", "Durée (min)": 25, "Pas avant": "", "Pas après": "", "Observations": "" },
          { "Client": "Mairie fictive", "Action": "Déposer", "Produit": "WC chimique", "Option": "Urinoir",
            "Couleur": "Gris", "Quantité": 1, "Nom du client": "Mairie fictive",
            "Adresse": "Place du Capitole 31000 Toulouse", "Durée (min)": 20, "Pas avant": "", "Pas après": "16:00", "Observations": "" },
          { "Client": "Exemple BTP (démo)", "Action": "Retirer", "Produit": "WC chimique", "Option": "Lave-main",
            "Couleur": "", "Quantité": 1, "Nom du client": "Exemple BTP (démo)",
            "Adresse": "Place du Plo 81500 Lavaur", "Durée (min)": 15, "Pas avant": "09:00", "Pas après": "11:00", "Observations": "" },
        ] },
    },
    stock: stockDefaut(),
    stock_maj: now,
    settings: {},
  };
}

export class DemoStore {
  persistent = false;
  label = "Mode démo";

  constructor() {
    try { this.db = JSON.parse(localStorage.getItem(DEMO_KEY)) || demoSeed(); } catch { this.db = demoSeed(); }
    this.#save();
  }
  #save() { try { localStorage.setItem(DEMO_KEY, JSON.stringify(this.db)); } catch { /* privé */ } }
  #clone = (x) => structuredClone(x);

  async listClients() {
    return Object.values(this.#clone(this.db.clients))
      .sort((a, b) => a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }));
  }

  async saveClient(client, points) {
    const id = client.id || uid();
    const now = new Date().toISOString();
    const old = this.db.clients[id] || {};
    this.db.clients[id] = {
      id, ...pick(client, CLIENT_FIELDS), created_at: old.created_at || now, updated_at: now,
      points: points.map((p, i) => ({ id: p.id || uid(), client_id: id, position: i, ...pick(p, POINT_FIELDS) })),
    };
    this.#save();
    return id;
  }

  async deleteClient(id) { delete this.db.clients[id]; this.#save(); }

  async listTournees() {
    return Object.values(this.db.tournees)
      .map(({ stops, meta, ...t }) => t)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async getTournee(id) { return this.db.tournees[id] ? this.#clone(this.db.tournees[id]) : null; }

  async saveTournee(id, nom, tourDate, chauffeur, stops, meta, stats = {}) {
    const tid = id || uid();
    const now = new Date().toISOString();
    const old = this.db.tournees[tid] || {};
    this.db.tournees[tid] = { id: tid, nom, tour_date: tourDate, chauffeur, nb_arrets: stops.length, stats,
      stops: this.#clone(stops), meta: this.#clone(meta), created_at: old.created_at || now, updated_at: now };
    this.#save();
    return tid;
  }

  async deleteTournee(id) { delete this.db.tournees[id]; this.#save(); }

  async loadStock() { return { rows: this.#clone(this.db.stock || []), maj: this.db.stock_maj || null }; }

  async saveStock(rows) {
    this.db.stock = this.#clone(rows);
    this.db.stock_maj = new Date().toISOString();
    this.#save();
  }

  async getSetting(cle) { return this.db.settings?.[cle] ?? null; }

  async setSetting(cle, valeur) {
    this.db.settings = { ...(this.db.settings || {}), [cle]: this.#clone(valeur) };
    this.#save();
  }

  reset() { this.db = demoSeed(); this.#save(); }
}
