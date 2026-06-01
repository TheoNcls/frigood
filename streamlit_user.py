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
        base = calc_recipe_macros(recipes_map[rid])
        portion = q if q else 1.0
        return [x * portion for x in base]

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
    page = st.radio("Navigation", ["Journal", "Historique", "Profil"], label_visibility="collapsed")
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
# PAGE : JOURNAL
# =========================================================

if page == "Journal":
    today = date.today()
    st.title(f"Journal — {today.strftime('%A %d %B %Y')}")

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
    with st.form("add_meal", clear_on_submit=True):
        col_left, col_right = st.columns(2)
        with col_left:
            moment = st.selectbox("Moment", MOMENTS)
            type_aliment = st.radio("Type d'aliment", ["Recette", "Ingrédient"], horizontal=True)
        with col_right:
            notes = st.text_input("Notes (optionnel)")

        recipe_id = ingredient_id = None
        quantite = None
        type_mesure = "poids"

        if type_aliment == "Recette":
            recipe_options = sorted(recipes_map.values(), key=lambda r: r["nom"])
            if recipe_options:
                noms = [r["nom"] for r in recipe_options]
                choix = st.selectbox("Recette", noms)
                recipe_id = next(r["id"] for r in recipe_options if r["nom"] == choix)
                quantite = st.number_input(
                    "Portion (1 = recette entière)", min_value=0.1, value=1.0, step=0.5
                )
            else:
                st.info("Aucune recette disponible")

        else:
            ing_list = sorted(ingredients_map.values(), key=lambda i: i["nom"])
            if ing_list:
                noms = [i["nom"] for i in ing_list]
                choix = st.selectbox("Ingrédient", noms)
                ing = next(i for i in ing_list if i["nom"] == choix)
                ingredient_id = ing["id"]

                has_unite = ing.get("quantite_defaut") is not None
                if has_unite:
                    mesure_label = st.radio(
                        "Mesure", ["poids", "unité"], horizontal=True,
                        key="mesure_radio"
                    )
                    type_mesure = "unite" if mesure_label == "unité" else "poids"

                if type_mesure == "unite":
                    quantite = st.number_input(
                        "Nombre d'unités", min_value=0.1, value=1.0, step=0.5
                    )
                    qdeft = ing.get("quantite_defaut", "?")
                    unite = ing.get("unite", "g")
                    st.caption(f"1 unité ≈ {qdeft} {unite}")
                else:
                    qdeft = float(ing.get("quantite_defaut") or 100)
                    quantite = st.number_input(
                        f"Quantité ({ing.get('unite', 'g')})",
                        min_value=0.1,
                        value=qdeft,
                        step=10.0,
                    )
            else:
                st.info("Aucun ingrédient disponible")

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
# PAGE : HISTORIQUE
# =========================================================

elif page == "Historique":
    st.title("Historique")

    selected = st.date_input("Choisir une date", value=date.today() - timedelta(days=1))
    logs = api_get(f"/users/{user['id']}/meal_logs/?date={selected}") or []

    if not logs:
        st.info(f"Aucun repas enregistré le {selected.strftime('%d/%m/%Y')}.")
    else:
        total = [0.0, 0.0, 0.0, 0.0]
        for log in logs:
            m = calc_log_macros(log, ingredients_map, recipes_map)
            for i in range(4):
                total[i] += m[i]

        c1, c2, c3, c4 = st.columns(4)
        with c1:
            st.metric("Calories", f"{total[0]:.0f} kcal",
                      delta=f"{total[0] - (user.get('calories_cible') or 0):.0f} kcal" if user.get("calories_cible") else None)
        with c2:
            st.metric("Protéines", f"{total[1]:.1f} g")
        with c3:
            st.metric("Glucides", f"{total[2]:.1f} g")
        with c4:
            st.metric("Lipides", f"{total[3]:.1f} g")

        st.divider()

        logs_sorted = sorted(logs, key=lambda x: MOMENTS.index(x["moment"]) if x["moment"] in MOMENTS else 99)
        for log in logs_sorted:
            macros = calc_log_macros(log, ingredients_map, recipes_map)
            rid = log.get("recipe_id")
            iid = log.get("ingredient_id")
            if rid:
                r = recipes_map.get(rid, {})
                label = f"🍽️ {r.get('nom', '?')} × {log.get('quantite', 1):.1f} portion"
            else:
                ing = ingredients_map.get(iid, {})
                if log.get("type_mesure") == "unite":
                    label = f"🥗 {ing.get('nom', '?')} × {log.get('quantite', 0):.1f} unité(s)"
                else:
                    label = f"🥗 {ing.get('nom', '?')} {log.get('quantite', 0):.0f} {ing.get('unite', 'g')}"

            with st.container(border=True):
                col1, col2 = st.columns([2, 3])
                with col1:
                    st.markdown(f"**{log['moment'].capitalize()}** — {label}")
                    if log.get("notes"):
                        st.caption(log["notes"])
                with col2:
                    st.caption(
                        f"~{macros[0]:.0f} kcal | "
                        f"P: {macros[1]:.1f} g | "
                        f"G: {macros[2]:.1f} g | "
                        f"L: {macros[3]:.1f} g"
                    )


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
