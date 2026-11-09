"""
Persistance des données – Supabase (PostgREST) avec repli mémoire.

Streamlit ne conserve rien d'une session à l'autre : ce module stocke la base
client, les tournées enregistrées et le stock du parc dans Supabase.

Configuration (Streamlit Cloud → Settings → Secrets, ou .streamlit/secrets.toml) :

    [supabase]
    url = "https://<projet>.supabase.co"
    key = "<clé secrète : sb_secret_… ou service_role>"

Variables d'environnement acceptées en alternative : SUPABASE_URL / SUPABASE_KEY.

Le schéma SQL à exécuter une fois dans Supabase est fourni dans
« supabase_schema.sql ». Sans configuration, un stockage en mémoire prend le
relais pour que l'application reste utilisable (données perdues en fin de
session, un bandeau le signale).

Aucune dépendance supplémentaire : appels REST via « requests ».
"""

from __future__ import annotations

import copy
import datetime
import os
import uuid

import requests


class StoreError(Exception):
    """Erreur de lecture / écriture dans le stockage persistant."""


# ─────────────────────────────────────────────────────────────────────────────
# Champs manipulés (noms de colonnes Supabase)
# ─────────────────────────────────────────────────────────────────────────────

CLIENT_FIELDS = ["nom", "contact", "telephone", "email", "produit",
                 "option_produit", "quantite", "couleurs",
                 "pas_avant", "pas_apres", "notes"]
POINT_FIELDS = ["libelle", "adresse", "pas_avant", "pas_apres", "observations"]


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


# ═════════════════════════════════════════════════════════════════════════════
# SUPABASE
# ═════════════════════════════════════════════════════════════════════════════

class SupabaseStore:
    persistent = True
    label = "Supabase"

    def __init__(self, url: str, key: str, timeout: int = 15):
        self.base = url.rstrip("/") + "/rest/v1"
        self.timeout = timeout
        self.headers = {"apikey": key, "Content-Type": "application/json"}
        # Les clés historiques (anon / service_role) sont des JWT et doivent
        # aussi figurer dans l'en-tête Authorization. Les nouvelles clés
        # (sb_secret_…) se passent uniquement via « apikey ».
        if key.startswith("eyJ"):
            self.headers["Authorization"] = f"Bearer {key}"

    # ── Bas niveau ───────────────────────────────────────────────────────────
    def _req(self, method, path, params=None, json=None, prefer=None):
        headers = dict(self.headers)
        if prefer:
            headers["Prefer"] = prefer
        try:
            r = requests.request(method, f"{self.base}/{path}", params=params,
                                 json=json, headers=headers, timeout=self.timeout)
        except requests.RequestException as e:
            raise StoreError(f"Supabase injoignable : {e}") from e
        if r.status_code >= 400:
            try:
                detail = r.json().get("message") or r.text
            except ValueError:
                detail = r.text
            raise StoreError(f"Supabase ({r.status_code}) : {detail}")
        if not r.content:
            return None
        try:
            return r.json()
        except ValueError:
            return None

    def ping(self) -> None:
        self._req("GET", "clients", params={"select": "id", "limit": "1"})

    # ── Base client ──────────────────────────────────────────────────────────
    def list_clients(self) -> list[dict]:
        rows = self._req("GET", "clients", params={
            "select": "*,points_livraison(*)", "order": "nom.asc"}) or []
        for c in rows:
            pts = c.pop("points_livraison", None) or []
            c["points"] = sorted(pts, key=lambda p: (p.get("position") or 0))
        return rows

    def save_client(self, client: dict, points: list[dict]) -> str:
        payload = {"id": client.get("id") or None,
                   **{k: client.get(k) for k in CLIENT_FIELDS}}
        pts = [{"id": p.get("id") or None, **{k: p.get(k, "") for k in POINT_FIELDS}}
               for p in points]
        res = self._req("POST", "rpc/save_client",
                        json={"p_client": payload, "p_points": pts})
        return str(res)

    def delete_client(self, client_id: str) -> None:
        self._req("DELETE", "clients", params={"id": f"eq.{client_id}"})

    # ── Tournées enregistrées ────────────────────────────────────────────────
    def list_tournees(self) -> list[dict]:
        return self._req("GET", "tournees", params={
            "select": "id,nom,tour_date,chauffeur,nb_arrets,created_at,updated_at",
            "order": "updated_at.desc"}) or []

    def get_tournee(self, tournee_id: str) -> dict | None:
        rows = self._req("GET", "tournees", params={
            "select": "*", "id": f"eq.{tournee_id}"}) or []
        return rows[0] if rows else None

    def save_tournee(self, tournee_id, nom, tour_date, chauffeur,
                     stops: list[dict], meta: dict) -> str:
        body = {"nom": nom, "tour_date": tour_date, "chauffeur": chauffeur,
                "nb_arrets": len(stops), "stops": stops, "meta": meta,
                "updated_at": _now_iso()}
        if tournee_id:
            rows = self._req("PATCH", "tournees", params={"id": f"eq.{tournee_id}"},
                             json=body, prefer="return=representation") or []
            if rows:
                return rows[0]["id"]
            # La tournée a été supprimée entre-temps : on la recrée.
        rows = self._req("POST", "tournees", json=body,
                         prefer="return=representation") or []
        if not rows:
            raise StoreError("Supabase n'a pas renvoyé la tournée créée.")
        return rows[0]["id"]

    def delete_tournee(self, tournee_id: str) -> None:
        self._req("DELETE", "tournees", params={"id": f"eq.{tournee_id}"})

    # ── Stock du parc ────────────────────────────────────────────────────────
    def load_stock(self) -> tuple[list[dict], str | None]:
        """Retourne (lignes, date de dernière mise à jour ISO | None)."""
        rows = self._req("GET", "stock", params={"select": "*"}) or []
        maj = max((r.get("updated_at") or "" for r in rows), default="") or None
        return rows, maj

    def save_stock(self, rows: list[dict]) -> None:
        self._req("POST", "rpc/replace_stock", json={"p_rows": rows})

    # ── Paramètres (barème des durées…) ──────────────────────────────────────
    def get_setting(self, cle: str):
        rows = self._req("GET", "parametres", params={
            "select": "valeur", "cle": f"eq.{cle}"}) or []
        return rows[0]["valeur"] if rows else None

    def set_setting(self, cle: str, valeur) -> None:
        self._req("POST", "parametres",
                  json={"cle": cle, "valeur": valeur, "updated_at": _now_iso()},
                  prefer="resolution=merge-duplicates,return=minimal")


# ═════════════════════════════════════════════════════════════════════════════
# REPLI MÉMOIRE (aucune persistance entre sessions)
# ═════════════════════════════════════════════════════════════════════════════

class MemoryStore:
    persistent = False
    label = "Mémoire de session"

    def __init__(self):
        self.clients: dict[str, dict] = {}
        self.tournees: dict[str, dict] = {}
        self.stock: list[dict] = []
        self.stock_maj: str | None = None

    def ping(self) -> None:
        return None

    def list_clients(self) -> list[dict]:
        out = [copy.deepcopy(c) for c in self.clients.values()]
        return sorted(out, key=lambda c: str(c.get("nom", "")).lower())

    def save_client(self, client: dict, points: list[dict]) -> str:
        cid = client.get("id") or str(uuid.uuid4())
        old = self.clients.get(cid, {})
        self.clients[cid] = {
            "id": cid, **{k: client.get(k) for k in CLIENT_FIELDS},
            "created_at": old.get("created_at", _now_iso()), "updated_at": _now_iso(),
            "points": [{"id": p.get("id") or str(uuid.uuid4()), "client_id": cid,
                        "position": i, **{k: p.get(k, "") for k in POINT_FIELDS}}
                       for i, p in enumerate(points)],
        }
        return cid

    def delete_client(self, client_id: str) -> None:
        self.clients.pop(client_id, None)

    def list_tournees(self) -> list[dict]:
        out = [{k: v for k, v in t.items() if k not in ("stops", "meta")}
               for t in self.tournees.values()]
        return sorted(out, key=lambda t: t["updated_at"], reverse=True)

    def get_tournee(self, tournee_id: str) -> dict | None:
        t = self.tournees.get(tournee_id)
        return copy.deepcopy(t) if t else None

    def save_tournee(self, tournee_id, nom, tour_date, chauffeur,
                     stops: list[dict], meta: dict) -> str:
        tid = tournee_id or str(uuid.uuid4())
        old = self.tournees.get(tid, {})
        self.tournees[tid] = {
            "id": tid, "nom": nom, "tour_date": tour_date, "chauffeur": chauffeur,
            "nb_arrets": len(stops), "stops": copy.deepcopy(stops),
            "meta": copy.deepcopy(meta),
            "created_at": old.get("created_at", _now_iso()), "updated_at": _now_iso(),
        }
        return tid

    def delete_tournee(self, tournee_id: str) -> None:
        self.tournees.pop(tournee_id, None)

    def load_stock(self):
        return copy.deepcopy(self.stock), self.stock_maj

    def save_stock(self, rows: list[dict]) -> None:
        self.stock = copy.deepcopy(rows)
        self.stock_maj = _now_iso()

    def get_setting(self, cle: str):
        return copy.deepcopy(getattr(self, "settings", {}).get(cle))

    def set_setting(self, cle: str, valeur) -> None:
        if not hasattr(self, "settings"):
            self.settings = {}
        self.settings[cle] = copy.deepcopy(valeur)


# ═════════════════════════════════════════════════════════════════════════════
# Lecture de la configuration
# ═════════════════════════════════════════════════════════════════════════════

def read_supabase_config(secrets) -> tuple[str | None, str | None]:
    """Lit url / key depuis st.secrets (section [supabase]) ou l'environnement."""
    url = key = None
    try:
        sec = secrets.get("supabase") if secrets is not None else None
        if sec:
            url = sec.get("url")
            key = sec.get("key") or sec.get("service_role_key") or sec.get("secret_key")
        url = url or secrets.get("SUPABASE_URL")
        key = key or secrets.get("SUPABASE_KEY")
    except Exception:
        # st.secrets lève une exception si aucun fichier secrets n'existe
        pass
    url = url or os.environ.get("SUPABASE_URL")
    key = key or os.environ.get("SUPABASE_KEY")
    return (url or None), (key or None)
