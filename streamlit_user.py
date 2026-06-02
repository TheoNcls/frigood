import streamlit as st
import requests
import os
from datetime import date, timedelta

API_URL = os.getenv("API_URL", "http://localhost:8000")
API_KEY = os.getenv("API_KEY", "")
HEADERS = {"X-API-Key": API_KEY}

st.set_page_config(page_title="Frigood", page_icon="🥦", layout="wide")


# --- API helpers ---

def api_get(path):
    try:
        r = requests.get(f"{API_URL}{path}", headers=HEADERS, timeout=5)
        if not r.ok or not r.text:
            return None
        return r.json()
    except Exception:
        return None


def api_post(path, data):
    try:
        r = requests.post(f"{API_URL}{path}", json=data, headers=HEADERS, timeout=5)
        if not r.ok:
            try:
                detail = r.json().get("detail", r.text)
            except Exception:
                detail = r.text
            st.error(detail)
            return None
        return r.json()
    except Exception as e:
        st.error(str(e))
        return None


def api_put(path, data):
    try:
        r = requests.put(f"{API_URL}{path}", json=data, headers=HEADERS, timeout=5)
        if not r.ok:
            try:
                detail = r.json().get("detail", r.text)
            except Exception:
                detail = r.text
            st.error(detail)
            return None
        return r.json()
    except Exception as e:
        st.error(str(e))
        return None


def api_delete(path):
    try:
        r = requests.delete(f"{API_URL}{path}", headers=HEADERS, timeout=5)
        return r.ok
    except Exception:
        return False


def api_garmin_sync(user_id, email=None, password=None, mfa_code=None):
    """Retourne (status, data) — status: 'success'|'mfa_required'|'session_expired'|'error'"""
    payload = {}
    if email:
        payload = {"email": email, "password": password, "mfa_code": mfa_code}
    try:
        r = requests.post(
            f"{API_URL}/users/{user_id}/garmin_sync",
            json=payload, headers=HEADERS, timeout=30,
        )
        try:
            detail = r.json().get("detail", "")
        except Exception:
            detail = r.text
        if r.status_code == 422 and detail == "CODE_MFA_REQUIS":
            return "mfa_required", None
        if r.status_code == 401 and detail == "SESSION_GARMIN_EXPIREE":
            return "session_expired", None
        if not r.ok:
            return "error", detail
        return "success", r.json()
    except Exception as e:
        return "error", str(e)


# --- Nutritional calculations ---

def calc_recipe_macros(recipe):
    """Returns [cal, prot, gluc, lip] for 1 full portion of a recipe."""
    total = [0.0, 0.0, 0.0, 0.0]
    for ri in recipe.get("ingredients", []):
        ing = ri["ingredient"]
        q = ri["quantite"]
        q_g = q * (ing.get("quantite_defaut") or 0) if ri["type_mesure"] == "unite" else q
        f = q_g / 100
        total[0] += (ing.get("calories") or 0) * f
        total[1] += (ing.get("proteines") or 0) * f
        total[2] += (ing.get("glucides") or 0) * f
        total[3] += (ing.get("lipides") or 0) * f
    return total


def calc_log_macros(log, ingredients_map, recipes_map):
    """Returns [cal, prot, gluc, lip] for a meal log entry."""
    rid = log.get("recipe_id")
    iid = log.get("ingredient_id")
    q = log.get("quantite") or 0

    if rid and rid in recipes_map:
        recipe = recipes_map[rid]
        base = calc_recipe_macros(recipe)
        portions_total = recipe.get("portions") or 1
        nb_portions = q if q else 1.0
        return [x * nb_portions / portions_total for x in base]

    if iid and iid in ingredients_map:
        ing = ingredients_map[iid]
        if log.get("type_mesure") == "unite":
            q_g = q * (ing.get("quantite_defaut") or 0)
        else:
            q_g = q
        f = q_g / 100
        return [
            (ing.get("calories") or 0) * f,
            (ing.get("proteines") or 0) * f,
            (ing.get("glucides") or 0) * f,
            (ing.get("lipides") or 0) * f,
        ]
    return [0.0, 0.0, 0.0, 0.0]


def macro_progress(label, current, target, unit):
    if target and target > 0:
        ratio = min(current / target, 1.0)
        pct = ratio * 100
        color = "#2ecc71" if pct <= 100 else "#e74c3c"
        st.markdown(
            f"**{label}** — {current:.0f} / {target:.0f} {unit} "
            f"<span style='color:{color}'>({pct:.0f}%)</span>",
            unsafe_allow_html=True,
        )
        st.progress(ratio)
    else:
        st.markdown(f"**{label}** — {current:.0f} {unit}")


# --- Session state init ---

if "user" not in st.session_state:
    st.session_state.user = None

# --- Login / Register screen ---

if st.session_state.user is None:
    st.title("🥦 Frigood")
    tab_login, tab_register = st.tabs(["Connexion", "Créer un compte"])

    with tab_login:
        with st.form("login"):
            email = st.text_input("Email")
            password = st.text_input("Mot de passe", type="password")
            if st.form_submit_button("Se connecter", use_container_width=True):
                result = api_post("/users/login", {"email": email, "password": password})
                if result:
                    st.session_state.user = result
                    st.rerun()

    with tab_register:
        with st.form("register"):
            nom = st.text_input("Nom")
            email_r = st.text_input("Email")
            password_r = st.text_input("Mot de passe", type="password")
            st.markdown("**Objectifs nutritionnels quotidiens**")
            col1, col2 = st.columns(2)
            with col1:
                cals = st.number_input("Calories (kcal)", min_value=0.0, value=2000.0, step=50.0)
                gluc = st.number_input("Glucides (g)", min_value=0.0, value=250.0, step=5.0)
            with col2:
                prot = st.number_input("Protéines (g)", min_value=0.0, value=60.0, step=5.0)
                lip = st.number_input("Lipides (g)", min_value=0.0, value=65.0, step=5.0)
            if st.form_submit_button("Créer mon compte", use_container_width=True):
                if not nom or not email_r or not password_r:
                    st.error("Nom, email et mot de passe sont obligatoires")
                else:
                    result = api_post("/users/", {
                        "nom": nom,
                        "email": email_r,
                        "password": password_r,
                        "calories_cible": cals or None,
                        "proteines_cible": prot or None,
                        "glucides_cible": gluc or None,
                        "lipides_cible": lip or None,
                    })
                    if result:
                        st.session_state.user = result
                        st.rerun()
    st.stop()

# --- Main app (logged in) ---

user = st.session_state.user

with st.sidebar:
    st.markdown(f"**{user['nom']}**")
    st.caption(user["email"])
    st.divider()
    page = st.radio("Navigation", ["Accueil", "Repas", "Sport", "Historique", "Profil"], label_visibility="collapsed")
    st.divider()
    if st.button("Déconnexion", use_container_width=True):
        st.session_state.user = None
        st.rerun()


# --- Shared cached data ---

@st.cache_data(ttl=120)
def load_ingredients():
    data = api_get("/ingredients/") or []
    return {i["id"]: i for i in data}


@st.cache_data(ttl=120)
def load_recipes():
    data = api_get("/recipes/") or []
    return {r["id"]: r for r in data}


ingredients_map = load_ingredients()
recipes_map = load_recipes()

MOMENTS = ["matin", "midi", "soir", "snack"]


# =========================================================
# PAGE : ACCUEIL
# =========================================================

if page == "Accueil":
    today = date.today()
    st.title(f"Bonjour, {user['nom']} 👋")
    st.caption(today.strftime("%A %d %B %Y").capitalize())

    # --- Données du jour ---
    logs_today   = api_get(f"/users/{user['id']}/meal_logs/?date={today}") or []
    acts_today   = api_get(f"/users/{user['id']}/activities/?date={today}") or []
    stats_today  = api_get(f"/users/{user['id']}/daily_stats/?date={today}")

    # Macros consommées aujourd'hui
    consumed = [0.0, 0.0, 0.0, 0.0]
    for log in logs_today:
        m = calc_log_macros(log, ingredients_map, recipes_map)
        for i in range(4):
            consumed[i] += m[i]

    # --- Bilan nutrition ---
    with st.container(border=True):
        st.markdown("##### Nutrition du jour")
        targets = [
            user.get("calories_cible"), user.get("proteines_cible"),
            user.get("glucides_cible"), user.get("lipides_cible"),
        ]
        labels  = ["Calories", "Protéines", "Glucides", "Lipides"]
        units   = ["kcal", "g", "g", "g"]
        cols = st.columns(4)
        for idx, (col, label, val, target, unit) in enumerate(
            zip(cols, labels, consumed, targets, units)
        ):
            with col:
                if target and target > 0:
                    remaining = target - val
                    pct = min(val / target, 1.0)
                    color = "#e74c3c" if remaining < 0 else "#2ecc71"
                    st.markdown(
                        f"**{label}**  \n"
                        f"<span style='font-size:1.4em'>{val:.0f}</span> / {target:.0f} {unit}",
                        unsafe_allow_html=True,
                    )
                    st.progress(pct)
                    reste = abs(remaining)
                    mention = "de trop" if remaining < 0 else "restantes"
                    st.caption(
                        f"<span style='color:{color}'>{reste:.0f} {unit} {mention}</span>",
                        unsafe_allow_html=True,
                    )
                else:
                    st.markdown(f"**{label}**  \n{val:.0f} {unit}")

    st.divider()

    # --- Sport ---
    with st.container(border=True):
        st.markdown("##### Sport")
        at_names = {at["id"]: at["nom"] for at in (api_get("/activity_types/") or [])}

        # Aujourd'hui
        if acts_today:
            for a in acts_today:
                nom = at_names.get(a.get("activity_type_id") or -1) or a.get("notes") or "Activité"
                parts = []
                if a.get("duree_min"):   parts.append(f"{a['duree_min']} min")
                if a.get("distance_km"): parts.append(f"{a['distance_km']} km")
                if a.get("calories"):    parts.append(f"{a['calories']:.0f} kcal")
                st.markdown(f"✅ **{nom}** — {' · '.join(parts) if parts else ''}")
        else:
            st.markdown("😴 Pas de sport aujourd'hui")

        # Ratio & streak sur 7 jours
        all_acts = api_get(f"/users/{user['id']}/activities/") or []
        act_date_set = set(str(a["date"]) for a in all_acts)
        last7 = {str(today - timedelta(days=i)) for i in range(7)}
        active_days = len(last7 & act_date_set)
        ratio_pct = active_days / 7

        # Streak (jours consécutifs en remontant depuis aujourd'hui)
        streak = 0
        check = today if str(today) in act_date_set else today - timedelta(days=1)
        while str(check) in act_date_set:
            streak += 1
            check -= timedelta(days=1)

        col1, col2 = st.columns(2)
        with col1:
            st.markdown(f"**Ratio 7 jours** : {active_days}/7")
            st.progress(ratio_pct)
        with col2:
            fire = "🔥" * min(streak, 5) if streak else "—"
            st.markdown(f"**Streak** : {streak} jour(s) {fire}")

    st.divider()

    # --- Sommeil (3 derniers jours) ---
    with st.container(border=True):
        st.markdown("##### Sommeil — 3 derniers jours")
        sleep_rows = []
        for i in range(1, 4):
            d = today - timedelta(days=i)
            ds = api_get(f"/users/{user['id']}/daily_stats/?date={d}")
            if ds:
                sleep_rows.append({
                    "date": d.strftime("%d/%m"),
                    "score": ds.get("sommeil_score"),
                    "total": ds.get("sommeil_total_h"),
                })

        if sleep_rows:
            scores = [r["score"] for r in sleep_rows if r["score"] is not None]
            avg_score = sum(scores) / len(scores) if scores else None
            if avg_score:
                st.metric("Score moyen", f"{avg_score:.0f}/100")
            cols = st.columns(3)
            for idx, row in enumerate(sleep_rows):
                with cols[idx]:
                    score_str = f"{row['score']}/100" if row["score"] else "—"
                    time_str  = f"{row['total']} h" if row["total"] else "—"
                    st.markdown(f"**{row['date']}**")
                    st.caption(f"Score : {score_str}")
                    st.caption(f"Durée : {time_str}")
        else:
            st.caption("Pas encore de données sommeil. Synchronise Garmin depuis la page Sport.")

    # --- Pas aujourd'hui ---
    if stats_today and stats_today.get("steps"):
        st.divider()
        with st.container(border=True):
            st.markdown("##### Pas aujourd'hui")
            steps = stats_today["steps"]
            goal  = stats_today.get("steps_goal") or 10000
            pct   = min(steps / goal, 1.0)
            st.markdown(f"**{steps:,}** / {goal:,} pas")
            st.progress(pct)
            if steps >= goal:
                st.caption("✅ Objectif atteint !")
            else:
                st.caption(f"{goal - steps:,} pas restants")


# =========================================================
# PAGE : REPAS (ex-Journal)
# =========================================================

elif page == "Repas":
    today = date.today()
    st.title(f"Repas — {today.strftime('%A %d %B %Y')}")

    logs = api_get(f"/users/{user['id']}/meal_logs/?date={today}") or []

    # Daily summary
    total = [0.0, 0.0, 0.0, 0.0]
    for log in logs:
        m = calc_log_macros(log, ingredients_map, recipes_map)
        for i in range(4):
            total[i] += m[i]

    with st.container(border=True):
        st.markdown("##### Bilan du jour")
        c1, c2, c3, c4 = st.columns(4)
        with c1:
            macro_progress("Calories", total[0], user.get("calories_cible"), "kcal")
        with c2:
            macro_progress("Protéines", total[1], user.get("proteines_cible"), "g")
        with c3:
            macro_progress("Glucides", total[2], user.get("glucides_cible"), "g")
        with c4:
            macro_progress("Lipides", total[3], user.get("lipides_cible"), "g")

    st.divider()

    # Add meal form
    st.subheader("Ajouter un repas")

    # Hors du form : changer ces widgets re-rend la page immédiatement
    col1, col2 = st.columns(2)
    with col1:
        moment = st.selectbox("Moment", MOMENTS)
    with col2:
        type_aliment = st.radio("Type d'aliment", ["Recette", "Ingrédient"], horizontal=True)

    recipe_id = ingredient_id = None
    type_mesure = "poids"
    ing_selected = recipe_selected = None

    if type_aliment == "Recette":
        recipe_options = sorted(recipes_map.values(), key=lambda r: r["nom"])
        if recipe_options:
            noms_r = [r["nom"] for r in recipe_options]
            choix_r = st.selectbox("Recette", noms_r)
            recipe_selected = next(r for r in recipe_options if r["nom"] == choix_r)
            recipe_id = recipe_selected["id"]
        else:
            st.info("Aucune recette disponible")
    else:
        ing_list = sorted(ingredients_map.values(), key=lambda i: i["nom"])
        if ing_list:
            noms_i = [i["nom"] for i in ing_list]
            choix_i = st.selectbox("Ingrédient", noms_i)
            ing_selected = next(i for i in ing_list if i["nom"] == choix_i)
            ingredient_id = ing_selected["id"]
            if ing_selected.get("quantite_defaut") is not None:
                mesure_label = st.radio("Mesure", ["poids", "unité"], horizontal=True)
                type_mesure = "unite" if mesure_label == "unité" else "poids"
        else:
            st.info("Aucun ingrédient disponible")

    # Dans le form : seulement la quantité, les notes et le bouton
    with st.form("add_meal", clear_on_submit=True):
        if type_aliment == "Recette" and recipe_selected:
            portions_total = recipe_selected.get("portions") or 1
            quantite = st.number_input("Nombre de portions consommées", min_value=0.1, value=1.0, step=0.5)
            if portions_total > 1:
                st.caption(f"Recette prévue pour {portions_total} portions")
        elif type_aliment == "Ingrédient" and ing_selected:
            if type_mesure == "unite":
                quantite = st.number_input("Nombre d'unités", min_value=0.1, value=1.0, step=0.5)
                st.caption(f"1 unité ≈ {ing_selected.get('quantite_defaut', '?')} {ing_selected.get('unite', 'g')}")
            else:
                default_q = float(ing_selected.get("quantite_defaut") or 100)
                quantite = st.number_input(
                    f"Quantité ({ing_selected.get('unite', 'g')})",
                    min_value=0.1, value=default_q, step=10.0,
                )
        else:
            quantite = 0.0

        notes = st.text_input("Notes (optionnel)")
        submitted = st.form_submit_button("Ajouter", use_container_width=True)

    if submitted and (recipe_id or ingredient_id):
        payload = {
            "date": str(today),
            "moment": moment,
            "recipe_id": recipe_id,
            "ingredient_id": ingredient_id,
            "quantite": quantite,
            "type_mesure": type_mesure,
            "notes": notes or None,
        }
        result = api_post(f"/users/{user['id']}/meal_logs/", payload)
        if result:
            st.success("Repas ajouté !")
            st.cache_data.clear()
            st.rerun()

    st.divider()

    # Today's meals
    st.subheader("Repas d'aujourd'hui")
    if not logs:
        st.info("Aucun repas enregistré pour aujourd'hui.")
    else:
        logs_sorted = sorted(logs, key=lambda x: MOMENTS.index(x["moment"]) if x["moment"] in MOMENTS else 99)
        for log in logs_sorted:
            macros = calc_log_macros(log, ingredients_map, recipes_map)
            rid = log.get("recipe_id")
            iid = log.get("ingredient_id")
            if rid:
                r = recipes_map.get(rid, {})
                q_str = f"× {log.get('quantite', 1):.1f} portion"
                label = f"🍽️ **{r.get('nom', '?')}** {q_str}"
            else:
                ing = ingredients_map.get(iid, {})
                if log.get("type_mesure") == "unite":
                    label = f"🥗 **{ing.get('nom', '?')}** × {log.get('quantite', 0):.1f} unité(s)"
                else:
                    label = f"🥗 **{ing.get('nom', '?')}** {log.get('quantite', 0):.0f} {ing.get('unite', 'g')}"

            c1, c2, c3 = st.columns([3, 5, 1])
            with c1:
                st.markdown(f"{log['moment'].capitalize()} — {label}")
                if log.get("notes"):
                    st.caption(log["notes"])
            with c2:
                st.caption(
                    f"~{macros[0]:.0f} kcal | "
                    f"P: {macros[1]:.1f} g | "
                    f"G: {macros[2]:.1f} g | "
                    f"L: {macros[3]:.1f} g"
                )
            with c3:
                if st.button("🗑️", key=f"del_{log['id']}"):
                    if api_delete(f"/meal_logs/{log['id']}"):
                        st.cache_data.clear()
                        st.rerun()


# =========================================================
# PAGE : SPORT
# =========================================================

elif page == "Sport":
    from streamlit_calendar import calendar as st_calendar
    from collections import defaultdict

    st.title("Sport & Activités")

    activity_types_list = api_get("/activity_types/") or []
    at_map = {at["id"]: at for at in activity_types_list}

    # ── Garmin sync ──────────────────────────────────────
    garmin_ok = user.get("garmin_connected", False)
    if "garmin_needs_mfa" not in st.session_state:
        st.session_state.garmin_needs_mfa = False

    with st.expander("🔄 Garmin Connect", expanded=not garmin_ok):
        if garmin_ok:
            st.success("Connecté à Garmin Connect")
            col_sync, col_disc = st.columns(2)
            with col_sync:
                if st.button("Synchroniser", use_container_width=True, key="garmin_sync_btn"):
                    status, data = api_garmin_sync(user["id"])
                    if status == "success":
                        st.success(f"{data['imported']} activité(s) importée(s), {data.get('stats_days', 0)} jour(s) de données santé synchronisé(s).")
                        st.cache_data.clear()
                        st.rerun()
                    elif status == "session_expired":
                        st.warning("Session expirée, reconnecte-toi.")
                        updated = api_get(f"/users/{user['id']}")
                        if updated:
                            st.session_state.user = updated
                        st.rerun()
                    else:
                        st.error(data or "Erreur inconnue")
            with col_disc:
                if st.button("Déconnecter Garmin", use_container_width=True, key="garmin_disc_btn"):
                    api_delete(f"/users/{user['id']}/garmin_disconnect")
                    updated = api_get(f"/users/{user['id']}")
                    if updated:
                        st.session_state.user = updated
                    st.rerun()
        else:
            if st.session_state.garmin_needs_mfa:
                st.warning("Garmin a demandé un code MFA — vérifie ton email ou ton application d'authentification.")

            g_email = st.text_input("Email Garmin Connect", key="g_email")
            g_password = st.text_input("Mot de passe", type="password", key="g_password")
            g_mfa = st.text_input("Code MFA", key="g_mfa") if st.session_state.garmin_needs_mfa else None

            if st.button("Se connecter et synchroniser", use_container_width=True, key="garmin_auth_btn"):
                status, data = api_garmin_sync(user["id"], g_email, g_password, g_mfa)
                if status == "mfa_required":
                    st.session_state.garmin_needs_mfa = True
                    st.rerun()
                elif status == "success":
                    st.session_state.garmin_needs_mfa = False
                    st.success(f"{data['imported']} activité(s) importée(s), {data.get('stats_days', 0)} jour(s) de données santé synchronisé(s).")
                    updated = api_get(f"/users/{user['id']}")
                    if updated:
                        st.session_state.user = updated
                    st.cache_data.clear()
                    st.rerun()
                else:
                    st.error(data or "Erreur de connexion Garmin")

    # ── Ajout manuel ─────────────────────────────────────
    with st.expander("➕ Ajouter une activité manuellement"):
        at_options = {at["nom"]: at["id"] for at in activity_types_list}
        col1, col2 = st.columns(2)
        with col1:
            act_date = st.date_input("Date", value=date.today(), key="act_date")
        with col2:
            at_choix = st.selectbox("Type d'activité", ["(non défini)"] + list(at_options.keys()))
        with st.form("add_activity", clear_on_submit=True):
            col1, col2 = st.columns(2)
            duree = col1.number_input("Durée (min)", min_value=0, value=30, step=5)
            calories_act = col2.number_input("Calories brûlées", min_value=0.0, step=10.0)
            distance = col1.number_input("Distance (km)", min_value=0.0, step=0.1)
            fc = col2.number_input("FC moyenne (bpm)", min_value=0, step=1)
            notes_act = st.text_input("Notes")
            if st.form_submit_button("Ajouter", use_container_width=True):
                payload = {
                    "date": str(act_date),
                    "activity_type_id": at_options.get(at_choix) if at_choix != "(non défini)" else None,
                    "source": "manual",
                    "duree_min": duree or None,
                    "calories": calories_act or None,
                    "distance_km": distance or None,
                    "freq_cardiaque_moy": fc or None,
                    "notes": notes_act or None,
                }
                result = api_post(f"/users/{user['id']}/activities/", payload)
                if result:
                    st.success("Activité ajoutée !")
                    st.cache_data.clear()
                    st.rerun()

    st.divider()

    # ── Calendrier global ─────────────────────────────────
    st.subheader("Calendrier")

    @st.cache_data(ttl=60)
    def load_all_activities(uid):
        return api_get(f"/users/{uid}/activities/") or []

    @st.cache_data(ttl=60)
    def load_all_meals(uid):
        return api_get(f"/users/{uid}/meal_logs/") or []

    all_acts = load_all_activities(user["id"])
    all_meals_cal = load_all_meals(user["id"])

    events = []

    # Activités
    for a in all_acts:
        at = at_map.get(a.get("activity_type_id") or -1, {})
        nom_type = at.get("nom") or a.get("notes") or "Activité"
        parts = [nom_type]
        if a.get("duree_min"):
            parts.append(f"{a['duree_min']} min")
        if a.get("calories"):
            parts.append(f"{a['calories']:.0f} kcal")
        color = "#e67e22" if a.get("source") == "garmin" else "#3498db"
        events.append({
            "title": " · ".join(parts),
            "start": str(a["date"]),
            "color": color,
        })

    # Repas groupés par date
    meals_by_date = defaultdict(lambda: {"count": 0, "cal": 0.0})
    for log in all_meals_cal:
        d = str(log["date"])
        meals_by_date[d]["count"] += 1
        m = calc_log_macros(log, ingredients_map, recipes_map)
        meals_by_date[d]["cal"] += m[0]

    for d, data in meals_by_date.items():
        events.append({
            "title": f"🍽 {data['count']} repas · {data['cal']:.0f} kcal",
            "start": d,
            "color": "#27ae60",
        })

    calendar_options = {
        "initialView": "dayGridMonth",
        "locale": "fr",
        "headerToolbar": {
            "left": "prev,next today",
            "center": "title",
            "right": "dayGridMonth,timeGridWeek,listWeek",
        },
        "height": 650,
        "eventDisplay": "block",
    }

    st_calendar(events=events, options=calendar_options, key="sport_calendar")

    # ── Liste des activités récentes ──────────────────────
    if all_acts:
        st.divider()
        st.subheader("Activités récentes")
        for a in all_acts[:10]:
            at = at_map.get(a.get("activity_type_id") or -1, {})
            nom_type = at.get("nom") or "Activité"
            parts = []
            if a.get("duree_min"):
                parts.append(f"{a['duree_min']} min")
            if a.get("distance_km"):
                parts.append(f"{a['distance_km']} km")
            if a.get("calories"):
                parts.append(f"{a['calories']:.0f} kcal")
            if a.get("freq_cardiaque_moy"):
                parts.append(f"FC {a['freq_cardiaque_moy']} bpm")
            source_icon = "⌚" if a.get("source") == "garmin" else "✏️"
            col1, col2, col3 = st.columns([2, 4, 1])
            with col1:
                st.markdown(f"**{a['date']}** {source_icon} {nom_type}")
                if a.get("notes") and a["notes"] != nom_type:
                    st.caption(a["notes"])
            with col2:
                st.caption(" · ".join(parts) if parts else "—")
            with col3:
                if st.button("🗑️", key=f"del_act_{a['id']}"):
                    if api_delete(f"/activities/{a['id']}"):
                        st.cache_data.clear()
                        st.rerun()


# =========================================================
# PAGE : HISTORIQUE
# =========================================================

elif page == "Historique":
    st.title("Historique")

    # Navigation par date
    if "hist_date" not in st.session_state:
        st.session_state.hist_date = date.today() - timedelta(days=1)

    col_p, col_d, col_n = st.columns([1, 4, 1])
    with col_p:
        if st.button("◀", use_container_width=True):
            st.session_state.hist_date -= timedelta(days=1)
            st.rerun()
    with col_d:
        picked = st.date_input("", value=st.session_state.hist_date,
                               label_visibility="collapsed", key="hist_date_picker")
        if picked != st.session_state.hist_date:
            st.session_state.hist_date = picked
    with col_n:
        if st.button("▶", use_container_width=True,
                     disabled=st.session_state.hist_date >= date.today()):
            st.session_state.hist_date += timedelta(days=1)
            st.rerun()

    selected = st.session_state.hist_date
    st.subheader(selected.strftime("%A %d %B %Y").capitalize())

    # Fetch toutes les données du jour
    logs = api_get(f"/users/{user['id']}/meal_logs/?date={selected}") or []
    acts = api_get(f"/users/{user['id']}/activities/?date={selected}") or []
    ds   = api_get(f"/users/{user['id']}/daily_stats/?date={selected}")

    activity_types_list = api_get("/activity_types/") or []
    at_map_hist = {at["id"]: at for at in activity_types_list}

    # ── Nutrition ───────────────────────────────────────────
    st.markdown("### Nutrition")
    if logs:
        total = [0.0, 0.0, 0.0, 0.0]
        for log in logs:
            m = calc_log_macros(log, ingredients_map, recipes_map)
            for i in range(4):
                total[i] += m[i]

        c1, c2, c3, c4 = st.columns(4)
        with c1:
            delta = f"{total[0] - (user.get('calories_cible') or 0):.0f}" if user.get("calories_cible") else None
            st.metric("Calories", f"{total[0]:.0f} kcal", delta=delta)
        with c2:
            st.metric("Protéines", f"{total[1]:.1f} g")
        with c3:
            st.metric("Glucides", f"{total[2]:.1f} g")
        with c4:
            st.metric("Lipides", f"{total[3]:.1f} g")

        logs_sorted = sorted(logs, key=lambda x: MOMENTS.index(x["moment"]) if x["moment"] in MOMENTS else 99)
        for log in logs_sorted:
            macros = calc_log_macros(log, ingredients_map, recipes_map)
            rid, iid = log.get("recipe_id"), log.get("ingredient_id")
            if rid:
                r = recipes_map.get(rid, {})
                label = f"🍽️ {r.get('nom','?')} × {log.get('quantite',1):.1f} portion"
            else:
                ing = ingredients_map.get(iid, {})
                if log.get("type_mesure") == "unite":
                    label = f"🥗 {ing.get('nom','?')} × {log.get('quantite',0):.1f} unité(s)"
                else:
                    label = f"🥗 {ing.get('nom','?')} {log.get('quantite',0):.0f} {ing.get('unite','g')}"
            col1, col2 = st.columns([2, 3])
            with col1:
                st.markdown(f"**{log['moment'].capitalize()}** — {label}")
            with col2:
                st.caption(f"~{macros[0]:.0f} kcal | P {macros[1]:.1f}g | G {macros[2]:.1f}g | L {macros[3]:.1f}g")
    else:
        st.caption("Aucun repas enregistré.")

    # ── Activités ───────────────────────────────────────────
    st.divider()
    st.markdown("### Activités sportives")
    if acts:
        total_cal_act = sum(a.get("calories") or 0 for a in acts)
        if total_cal_act:
            st.caption(f"Total brûlées : {total_cal_act:.0f} kcal")
        for a in acts:
            at = at_map_hist.get(a.get("activity_type_id") or -1, {})
            nom = at.get("nom") or a.get("notes") or "Activité"
            parts = []
            if a.get("duree_min"):  parts.append(f"{a['duree_min']} min")
            if a.get("distance_km"): parts.append(f"{a['distance_km']} km")
            if a.get("calories"):   parts.append(f"{a['calories']:.0f} kcal")
            if a.get("freq_cardiaque_moy"): parts.append(f"FC {a['freq_cardiaque_moy']} bpm")
            icon = "⌚" if a.get("source") == "garmin" else "✏️"
            st.markdown(f"{icon} **{nom}** — {' · '.join(parts) if parts else '—'}")
    else:
        st.caption("Aucune activité enregistrée.")

    # ── Santé Garmin ────────────────────────────────────────
    st.divider()
    st.markdown("### Santé Garmin")
    if not ds:
        st.caption("Pas de données Garmin pour cette date. Synchronise depuis la page Sport.")
    else:
        col1, col2, col3 = st.columns(3)

        with col1:
            st.markdown("**Sommeil**")
            if ds.get("sommeil_score") is not None:
                score = ds["sommeil_score"]
                color = "#2ecc71" if score >= 80 else "#f39c12" if score >= 60 else "#e74c3c"
                st.markdown(
                    f"Score : <span style='font-size:1.3em;color:{color}'><b>{score}/100</b></span>",
                    unsafe_allow_html=True,
                )
            if ds.get("sommeil_total_h"):
                st.metric("Durée totale", f"{ds['sommeil_total_h']} h")
            for label, key in [("Profond", "sommeil_profond_h"), ("Léger", "sommeil_leger_h"),
                                ("REM", "sommeil_rem_h"), ("Éveillé", "sommeil_eveil_h")]:
                if ds.get(key):
                    st.caption(f"{label} : {ds[key]} h")
            if ds.get("heure_coucher"):
                st.caption(f"Coucher : {ds['heure_coucher']}")
            if ds.get("heure_reveil"):
                st.caption(f"Réveil : {ds['heure_reveil']}")

        with col2:
            st.markdown("**Cœur & Énergie**")
            if ds.get("bpm_repos"):
                st.metric("BPM repos", ds["bpm_repos"])
            if ds.get("bpm_moy"):
                st.metric("BPM moyen", ds["bpm_moy"])
            for label, key in [("BPM min", "bpm_min"), ("BPM max", "bpm_max")]:
                if ds.get(key):
                    st.caption(f"{label} : {ds[key]}")
            if ds.get("stress_moy") is not None:
                st.metric("Stress moyen", f"{ds['stress_moy']}/100")
            if ds.get("stress_max") is not None:
                st.caption(f"Stress max : {ds['stress_max']}/100")
            if ds.get("body_battery_max") is not None:
                st.metric("Body battery max", f"{ds['body_battery_max']}/100")
            if ds.get("body_battery_min") is not None:
                st.caption(f"Body battery min : {ds['body_battery_min']}/100")

        with col3:
            st.markdown("**Activité & Santé**")
            if ds.get("steps"):
                goal = ds.get("steps_goal")
                label_steps = f"{ds['steps']:,}"
                if goal:
                    label_steps += f" / {goal:,}"
                st.metric("Pas", label_steps)
            if ds.get("etages"):
                st.caption(f"Étages : {ds['etages']}")
            if ds.get("respiration_moy"):
                st.metric("Respiration", f"{ds['respiration_moy']:.1f} /min")
            if ds.get("spo2_moy"):
                st.metric("SpO2", f"{ds['spo2_moy']} %")
            if ds.get("hrv_moy"):
                st.metric("HRV", f"{ds['hrv_moy']} ms")


# =========================================================
# PAGE : PROFIL
# =========================================================

elif page == "Profil":
    st.title("Profil")

    st.subheader("Informations & objectifs")
    with st.form("edit_profile"):
        nom = st.text_input("Nom", value=user.get("nom", ""))
        st.caption(f"Email : {user.get('email', '')}")
        st.markdown("**Objectifs nutritionnels (par jour)**")
        col1, col2 = st.columns(2)
        with col1:
            cals = st.number_input("Calories (kcal)", min_value=0.0,
                                   value=float(user.get("calories_cible") or 0), step=50.0)
            gluc = st.number_input("Glucides (g)", min_value=0.0,
                                   value=float(user.get("glucides_cible") or 0), step=5.0)
        with col2:
            prot = st.number_input("Protéines (g)", min_value=0.0,
                                   value=float(user.get("proteines_cible") or 0), step=5.0)
            lip = st.number_input("Lipides (g)", min_value=0.0,
                                  value=float(user.get("lipides_cible") or 0), step=5.0)
        if st.form_submit_button("Enregistrer", use_container_width=True):
            result = api_put(f"/users/{user['id']}", {
                "nom": nom,
                "calories_cible": cals or None,
                "proteines_cible": prot or None,
                "glucides_cible": gluc or None,
                "lipides_cible": lip or None,
            })
            if result:
                st.session_state.user = result
                st.success("Profil mis à jour !")
                st.rerun()

    st.divider()

    with st.expander("Changer de mot de passe"):
        with st.form("change_pw"):
            old_pw = st.text_input("Mot de passe actuel", type="password")
            new_pw = st.text_input("Nouveau mot de passe", type="password")
            confirm_pw = st.text_input("Confirmer le nouveau mot de passe", type="password")
            if st.form_submit_button("Changer"):
                if new_pw != confirm_pw:
                    st.error("Les mots de passe ne correspondent pas")
                elif not old_pw or not new_pw:
                    st.error("Remplissez tous les champs")
                else:
                    result = api_post(
                        f"/users/{user['id']}/change_password",
                        {"old_password": old_pw, "new_password": new_pw},
                    )
                    if result:
                        st.success("Mot de passe changé !")

    st.divider()

    st.subheader("Zone danger")
    if "confirm_delete_account" not in st.session_state:
        st.session_state.confirm_delete_account = False

    if not st.session_state.confirm_delete_account:
        if st.button("Supprimer mon compte", type="secondary"):
            st.session_state.confirm_delete_account = True
            st.rerun()
    else:
        st.warning("Cette action est irréversible. Tous vos repas seront supprimés.")
        col1, col2 = st.columns(2)
        with col1:
            if st.button("Oui, supprimer définitivement", type="primary"):
                if api_delete(f"/users/{user['id']}"):
                    st.session_state.user = None
                    st.session_state.confirm_delete_account = False
                    st.rerun()
        with col2:
            if st.button("Annuler"):
                st.session_state.confirm_delete_account = False
                st.rerun()
