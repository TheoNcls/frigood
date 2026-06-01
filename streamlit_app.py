import io
import os
import pandas as pd
import streamlit as st
import requests
from requests.exceptions import ConnectionError, Timeout

API_URL = os.getenv("API_URL", "http://127.0.0.1:8000")
API_KEY = os.getenv("API_KEY", "")
HEADERS = {"X-API-Key": API_KEY}

def api_get(path):
    try:
        res = requests.get(f"{API_URL}{path}", headers=HEADERS, timeout=5)
        if not res.ok or not res.text:
            st.error(f"Erreur API ({res.status_code}) : {res.text or 'réponse vide'}")
            st.stop()
        return res.json()
    except (ConnectionError, Timeout):
        st.error("Impossible de joindre l'API. Vérifie que le serveur est lancé.")
        st.stop()

if "authenticated" not in st.session_state:
    st.session_state.authenticated = False

if not st.session_state.authenticated:
    st.title("Frigood")
    pwd = st.text_input("Mot de passe", type="password")
    if st.button("Connexion"):
        if pwd == os.getenv("STREAMLIT_PASSWORD", ""):
            st.session_state.authenticated = True
            st.rerun()
        else:
            st.error("Mot de passe incorrect")
    st.stop()

st.set_page_config(page_title="Frigood", layout="centered")

page = st.sidebar.selectbox("Navigation", ["Accueil", "Ingrédients", "Recettes", "Nutriments"])


# ─── ACCUEIL ────────────────────────────────────────────────────────────────

if page == "Accueil":
    st.title("Frigood — Accueil")

    # Export tout
    st.subheader("Export")
    if st.button("Exporter toute la base en Excel"):
        ingredients = api_get("/ingredients/")
        recipes     = api_get("/recipes/")
        nutriments  = api_get("/nutriments/")

        buf = io.BytesIO()
        with pd.ExcelWriter(buf, engine="openpyxl") as writer:
            pd.DataFrame([{
                "Nom": i["nom"], "Calories": i["calories"], "Protéines": i["proteines"],
                "Glucides": i["glucides"], "Lipides": i["lipides"],
                "Unité": i["unite"], "Quantité défaut": i["quantite_defaut"]
            } for i in ingredients]).to_excel(writer, index=False, sheet_name="Ingrédients")

            rows_recettes = []
            for r in recipes:
                for ri in r["ingredients"]:
                    rows_recettes.append({
                        "Recette": r["nom"], "Description": r["description"],
                        "Ingrédient": ri["ingredient"]["nom"],
                        "Quantité": ri["quantite"], "Type mesure": ri["type_mesure"],
                        "Unité": ri["ingredient"]["unite"],
                    })
            pd.DataFrame(rows_recettes).to_excel(writer, index=False, sheet_name="Recettes")

            pd.DataFrame([{
                "Nom": n["nom"], "Unité": n["unite"]
            } for n in nutriments]).to_excel(writer, index=False, sheet_name="Nutriments")

            rows_ing_nut = []
            for i in ingredients:
                for n in i.get("nutriments", []):
                    rows_ing_nut.append({
                        "Ingrédient": i["nom"],
                        "Nutriment": n["nutriment"]["nom"],
                        "Valeur (100g)": n["valeur"],
                        "Unité": n["nutriment"]["unite"],
                    })
            pd.DataFrame(rows_ing_nut).to_excel(writer, index=False, sheet_name="Ingrédients Nutriments")

        st.download_button("Télécharger", buf.getvalue(), "frigood_backup.xlsx",
                           mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

    st.divider()

    # Imports
    st.subheader("Import")

    with st.expander("Importer des ingrédients"):
        st.caption("Colonnes : Nom, Calories, Protéines, Glucides, Lipides, Unité, Quantité défaut")
        fichier = st.file_uploader("Fichier Excel", type=["xlsx"], key="import_ing")
        if fichier:
            df_import = pd.read_excel(fichier)
            st.dataframe(df_import, use_container_width=True)
            if st.button("Importer les ingrédients"):
                erreurs, succes = [], 0
                for _, row in df_import.iterrows():
                    res = requests.post(f"{API_URL}/ingredients/", headers=HEADERS, json={
                        "nom": str(row.get("Nom", "")),
                        "calories": float(row["Calories"]) if pd.notna(row.get("Calories")) else None,
                        "proteines": float(row["Protéines"]) if pd.notna(row.get("Protéines")) else None,
                        "glucides": float(row["Glucides"]) if pd.notna(row.get("Glucides")) else None,
                        "lipides": float(row["Lipides"]) if pd.notna(row.get("Lipides")) else None,
                        "unite": str(row["Unité"]) if pd.notna(row.get("Unité")) else "g",
                        "quantite_defaut": float(row["Quantité défaut"]) if pd.notna(row.get("Quantité défaut")) else None,
                    })
                    if res.status_code == 200:
                        succes += 1
                    else:
                        erreurs.append(str(row.get("Nom", "?")))
                st.success(f"{succes} ingrédient(s) importé(s)")
                if erreurs:
                    st.warning(f"Ignorés : {', '.join(erreurs)}")
                st.rerun()

    with st.expander("Importer des nutriments"):
        st.caption("Colonnes : Nom, Unité")
        fichier = st.file_uploader("Fichier Excel", type=["xlsx"], key="import_nut")
        if fichier:
            df_import = pd.read_excel(fichier)
            st.dataframe(df_import, use_container_width=True)
            if st.button("Importer les nutriments"):
                erreurs, succes = [], 0
                for _, row in df_import.iterrows():
                    res = requests.post(f"{API_URL}/nutriments/", headers=HEADERS, json={
                        "nom": str(row.get("Nom", "")),
                        "unite": str(row["Unité"]) if pd.notna(row.get("Unité")) else "g",
                    })
                    if res.status_code == 200:
                        succes += 1
                    else:
                        erreurs.append(str(row.get("Nom", "?")))
                st.success(f"{succes} nutriment(s) importé(s)")
                if erreurs:
                    st.warning(f"Ignorés : {', '.join(erreurs)}")
                st.rerun()

    with st.expander("Importer des associations ingrédients/nutriments"):
        st.caption("Colonnes : Ingrédient, Nutriment, Valeur (100g) — les ingrédients et nutriments doivent déjà exister")
        fichier = st.file_uploader("Fichier Excel", type=["xlsx"], key="import_ing_nut")
        if fichier:
            df_import = pd.read_excel(fichier)
            st.dataframe(df_import, use_container_width=True)
            if st.button("Importer les associations"):
                ingredients_list = api_get("/ingredients/")
                nutriments_list  = api_get("/nutriments/")
                ing_map = {i["nom"]: i for i in ingredients_list}
                nut_map = {n["nom"]: n for n in nutriments_list}
                erreurs, succes = [], 0
                for _, row in df_import.iterrows():
                    ing_nom = str(row.get("Ingrédient", ""))
                    nut_nom = str(row.get("Nutriment", ""))
                    if ing_nom not in ing_map or nut_nom not in nut_map:
                        erreurs.append(f"{ing_nom}/{nut_nom}")
                        continue
                    res = requests.post(
                        f"{API_URL}/ingredients/{ing_map[ing_nom]['id']}/nutriments/",
                        headers=HEADERS,
                        json={"nutriment_id": nut_map[nut_nom]["id"],
                              "valeur": float(row.get("Valeur (100g)", 0))}
                    )
                    if res.status_code == 200:
                        succes += 1
                    else:
                        erreurs.append(f"{ing_nom}/{nut_nom}")
                st.success(f"{succes} association(s) importée(s)")
                if erreurs:
                    st.warning(f"Ignorées : {', '.join(erreurs)}")
                st.rerun()

    with st.expander("Importer des recettes"):
        st.caption("Colonnes : Recette, Description (les ingrédients s'ajoutent depuis la page Recettes)")
        fichier = st.file_uploader("Fichier Excel", type=["xlsx"], key="import_rec")
        if fichier:
            df_import = pd.read_excel(fichier)
            st.dataframe(df_import, use_container_width=True)
            if st.button("Importer les recettes"):
                erreurs, succes = [], 0
                for _, row in df_import.iterrows():
                    res = requests.post(f"{API_URL}/recipes/", headers=HEADERS, json={
                        "nom": str(row.get("Recette", "")),
                        "description": str(row["Description"]) if pd.notna(row.get("Description")) else None,
                    })
                    if res.status_code == 200:
                        succes += 1
                    else:
                        erreurs.append(str(row.get("Recette", "?")))
                st.success(f"{succes} recette(s) importée(s)")
                if erreurs:
                    st.warning(f"Ignorées : {', '.join(erreurs)}")
                st.rerun()

    st.divider()

    # Reset DB
    st.subheader("Reset")
    st.warning("Supprime toutes les données de la base de façon irréversible.")
    if "confirm_reset" not in st.session_state:
        st.session_state.confirm_reset = False
    if not st.session_state.confirm_reset:
        if st.button("Réinitialiser la base", type="primary"):
            st.session_state.confirm_reset = True
            st.rerun()
    else:
        st.error("Es-tu sûr ? Cette action est irréversible.")
        col1, col2 = st.columns(2)
        if col1.button("Oui, tout supprimer", type="primary"):
            ingredients = api_get("/ingredients/")
            recipes     = api_get("/recipes/")
            nutriments  = api_get("/nutriments/")
            for r in recipes:
                requests.delete(f"{API_URL}/recipes/{r['id']}", headers=HEADERS)
            for i in ingredients:
                requests.delete(f"{API_URL}/ingredients/{i['id']}", headers=HEADERS)
            for n in nutriments:
                requests.delete(f"{API_URL}/nutriments/{n['id']}", headers=HEADERS)
            st.session_state.confirm_reset = False
            st.success("Base réinitialisée.")
            st.rerun()
        if col2.button("Annuler"):
            st.session_state.confirm_reset = False
            st.rerun()


# ─── INGRÉDIENTS ────────────────────────────────────────────────────────────

elif page == "Ingrédients":
    st.title("Ingrédients")

    # Liste
    ingredients = api_get("/ingredients/")
    if ingredients:
        df_ing = pd.DataFrame([{
            "ID": i["id"], "Nom": i["nom"],
            "Calories": i["calories"], "Protéines": i["proteines"],
            "Glucides": i["glucides"], "Lipides": i["lipides"],
            "Unité": i["unite"], "Quantité défaut": i["quantite_defaut"]
        } for i in ingredients])
        st.dataframe(df_ing, width='stretch')

        buf = io.BytesIO()
        df_ing.to_excel(buf, index=False, sheet_name="Ingrédients")
        st.download_button("Exporter en Excel", buf.getvalue(), "ingredients.xlsx",
                           mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    else:
        st.info("Aucun ingrédient pour l'instant.")

    st.divider()

    # Ajouter / Modifier
    noms = {i["nom"]: i for i in ingredients}
    mode = st.radio("Action", ["Ajouter", "Modifier", "Supprimer"], horizontal=True)

    if mode == "Ajouter":
        st.subheader("Nouvel ingrédient")
        with st.form("add_ingredient"):
            nom = st.text_input("Nom")
            col1, col2 = st.columns(2)
            calories  = col1.number_input("Calories (kcal)", min_value=0.0, step=0.1)
            proteines = col2.number_input("Protéines (g)", min_value=0.0, step=0.1)
            glucides  = col1.number_input("Glucides (g)", min_value=0.0, step=0.1)
            lipides   = col2.number_input("Lipides (g)", min_value=0.0, step=0.1)
            unite = st.text_input("Unité", value="g")
            quantite_defaut = st.number_input("Poids classique (g)", min_value=0.0, step=1.0, help="Ex: 130 pour une pomme")
            submitted = st.form_submit_button("Ajouter")
        if submitted:
            res = requests.post(f"{API_URL}/ingredients/", headers=HEADERS, json={
                "nom": nom, "calories": calories, "proteines": proteines,
                "glucides": glucides, "lipides": lipides, "unite": unite,
                "quantite_defaut": quantite_defaut or None
            })
            if res.status_code == 200:
                st.success(f"Ingrédient « {nom} » ajouté !")
                st.rerun()
            else:
                st.error(f"Erreur : {res.json()}")

    elif mode == "Modifier" and noms:
        st.subheader("Modifier un ingrédient")
        choix = st.selectbox("Ingrédient", list(noms.keys()))
        ing = noms[choix]
        with st.form("edit_ingredient"):
            nom = st.text_input("Nom", value=ing["nom"])
            col1, col2 = st.columns(2)
            calories  = col1.number_input("Calories", value=ing["calories"] or 0.0, step=0.1)
            proteines = col2.number_input("Protéines", value=ing["proteines"] or 0.0, step=0.1)
            glucides  = col1.number_input("Glucides", value=ing["glucides"] or 0.0, step=0.1)
            lipides   = col2.number_input("Lipides", value=ing["lipides"] or 0.0, step=0.1)
            unite = st.text_input("Unité", value=ing["unite"])
            quantite_defaut = st.number_input("Poids classique (g)", min_value=0.0, step=1.0, value=ing["quantite_defaut"] or 0.0)
            submitted = st.form_submit_button("Enregistrer")
        if submitted:
            res = requests.put(f"{API_URL}/ingredients/{ing['id']}", headers=HEADERS, json={
                "nom": nom, "calories": calories, "proteines": proteines,
                "glucides": glucides, "lipides": lipides, "unite": unite,
                "quantite_defaut": quantite_defaut or None
            })
            if res.status_code == 200:
                st.success("Modifié !")
                st.rerun()
            else:
                st.error(f"Erreur : {res.json()}")

    elif mode == "Supprimer" and noms:
        st.subheader("Supprimer un ingrédient")
        choix = st.selectbox("Ingrédient", list(noms.keys()))
        if st.button("Supprimer", type="primary"):
            res = requests.delete(f"{API_URL}/ingredients/{noms[choix]['id']}", headers=HEADERS)
            if res.status_code == 200:
                st.success("Supprimé !")
                st.rerun()
            else:
                st.error(f"Erreur : {res.json()}")


# ─── RECETTES ───────────────────────────────────────────────────────────────

elif page == "Recettes":
    st.title("Recettes")

    recipes = api_get("/recipes/")
    ingredients = api_get("/ingredients/")
    ingredients_map = {i["nom"]: i for i in ingredients}

    if recipes:
        for r in recipes:
            with st.expander(r["nom"]):
                if r["description"]:
                    st.write(r["description"])
                if r["ingredients"]:
                    st.table([{
                        "Ingrédient": ri["ingredient"]["nom"],
                        "Quantité": f"{ri['quantite']} {ri['ingredient']['unite']}" if ri["type_mesure"] == "poids"
                                    else f"{ri['quantite']} pièce(s)"
                    } for ri in r["ingredients"]])

                    totaux = {"Calories": 0.0, "Protéines": 0.0, "Glucides": 0.0, "Lipides": 0.0}
                    extras: dict[str, dict] = {}
                    for ri in r["ingredients"]:
                        ing = ri["ingredient"]
                        if ri["type_mesure"] == "poids":
                            ratio = ri["quantite"] / 100
                        else:
                            ratio = ri["quantite"] * (ing["quantite_defaut"] or 0) / 100
                        totaux["Calories"]  += (ing["calories"]  or 0) * ratio
                        totaux["Protéines"] += (ing["proteines"] or 0) * ratio
                        totaux["Glucides"]  += (ing["glucides"]  or 0) * ratio
                        totaux["Lipides"]   += (ing["lipides"]   or 0) * ratio
                        for n in ing.get("nutriments", []):
                            nom_n = n["nutriment"]["nom"]
                            unite_n = n["nutriment"]["unite"]
                            extras.setdefault(nom_n, {"valeur": 0.0, "unite": unite_n})
                            extras[nom_n]["valeur"] += n["valeur"] * ratio
                    col1, col2, col3, col4 = st.columns(4)
                    col1.metric("Calories", f"{totaux['Calories']:.0f} kcal")
                    col2.metric("Protéines", f"{totaux['Protéines']:.1f} g")
                    col3.metric("Glucides", f"{totaux['Glucides']:.1f} g")
                    col4.metric("Lipides", f"{totaux['Lipides']:.1f} g")
                    if extras:
                        cols = st.columns(min(len(extras), 4))
                        for i, (nom_n, data) in enumerate(extras.items()):
                            cols[i % 4].metric(nom_n, f"{data['valeur']:.2f} {data['unite']}")
                else:
                    st.caption("Aucun ingrédient ajouté.")
    else:
        st.info("Aucune recette pour l'instant.")

    if recipes:
        rows = []
        for r in recipes:
            for ri in r["ingredients"]:
                rows.append({
                    "Recette": r["nom"],
                    "Description": r["description"],
                    "Ingrédient": ri["ingredient"]["nom"],
                    "Quantité": ri["quantite"],
                    "Unité": ri["ingredient"]["unite"],
                })
        if rows:
            buf = io.BytesIO()
            pd.DataFrame(rows).to_excel(buf, index=False, sheet_name="Recettes")
            st.download_button("Exporter les recettes en Excel", buf.getvalue(), "recettes.xlsx",
                               mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

    st.divider()

    noms_recettes = {r["nom"]: r for r in recipes}
    mode = st.radio("Action", ["Ajouter une recette", "Ajouter un ingrédient à une recette", "Retirer un ingrédient d'une recette", "Supprimer une recette"], horizontal=True)

    if mode == "Ajouter une recette":
        st.subheader("Nouvelle recette")
        with st.form("add_recipe"):
            nom = st.text_input("Nom")
            description = st.text_area("Description")
            submitted = st.form_submit_button("Ajouter")
        if submitted:
            res = requests.post(f"{API_URL}/recipes/", headers=HEADERS, json={"nom": nom, "description": description})
            if res.status_code == 200:
                st.success(f"Recette « {nom} » ajoutée !")
                st.rerun()
            else:
                st.error(f"Erreur : {res.json()}")

    elif mode == "Ajouter un ingrédient à une recette" and noms_recettes and ingredients_map:
        st.subheader("Ajouter un ingrédient")
        recette_choisie = st.selectbox("Recette", list(noms_recettes.keys()))
        ing_choisi = st.selectbox("Ingrédient", list(ingredients_map.keys()))
        ing_sel = ingredients_map[ing_choisi]
        type_mesure = st.radio("Mode", ["poids", "unite"],
                               format_func=lambda x: f"Au poids ({ing_sel['unite']})" if x == "poids" else "Par unité (pièce)",
                               horizontal=True)
        with st.form("add_ing_to_recipe"):
            if type_mesure == "poids":
                defaut = ing_sel["quantite_defaut"] or 0.0
                quantite = st.number_input(f"Quantité ({ing_sel['unite']})", min_value=0.0, step=1.0, value=defaut)
            else:
                quantite = st.number_input("Nombre de pièces", min_value=0.0, step=1.0, value=1.0)
            submitted = st.form_submit_button("Ajouter")
        if submitted:
            recette = noms_recettes[recette_choisie]
            res = requests.post(f"{API_URL}/recipes/{recette['id']}/ingredients", headers=HEADERS, json={
                "ingredient_id": ing_sel["id"], "quantite": quantite, "type_mesure": type_mesure
            })
            if res.status_code == 200:
                st.success("Ingrédient ajouté à la recette !")
                st.rerun()
            else:
                st.error(f"Erreur : {res.json()}")

    elif mode == "Retirer un ingrédient d'une recette" and noms_recettes:
        st.subheader("Retirer un ingrédient")
        recette_choisie = st.selectbox("Recette", list(noms_recettes.keys()))
        recette = noms_recettes[recette_choisie]
        ings_recette = {ri["ingredient"]["nom"]: ri for ri in recette["ingredients"]}
        if ings_recette:
            ing_choisi = st.selectbox("Ingrédient à retirer", list(ings_recette.keys()))
            if st.button("Retirer", type="primary"):
                ri = ings_recette[ing_choisi]
                res = requests.delete(f"{API_URL}/recipes/{recette['id']}/ingredients/{ri['ingredient']['id']}", headers=HEADERS)
                if res.status_code == 200:
                    st.success("Retiré !")
                    st.rerun()
                else:
                    st.error(f"Erreur : {res.json()}")
        else:
            st.info("Cette recette n'a pas encore d'ingrédients.")

    elif mode == "Supprimer une recette" and noms_recettes:
        st.subheader("Supprimer une recette")
        choix = st.selectbox("Recette", list(noms_recettes.keys()))
        if st.button("Supprimer", type="primary"):
            res = requests.delete(f"{API_URL}/recipes/{noms_recettes[choix]['id']}", headers=HEADERS)
            if res.status_code == 200:
                st.success("Supprimée !")
                st.rerun()
            else:
                st.error(f"Erreur : {res.json()}")


# ─── NUTRIMENTS ─────────────────────────────────────────────────────────────

elif page == "Nutriments":
    st.title("Nutriments supplémentaires")
    st.caption("Gérez les nutriments au-delà des 4 classiques (fibres, vitamines, fer...)")

    nutriments = api_get("/nutriments/")

    if nutriments:
        st.dataframe(
            [{"ID": n["id"], "Nom": n["nom"], "Unité": n["unite"]} for n in nutriments],
            use_container_width=True
        )
    else:
        st.info("Aucun nutriment supplémentaire pour l'instant.")

    st.divider()

    noms_nutriments = {n["nom"]: n for n in nutriments}
    mode = st.radio("Action", ["Ajouter un nutriment", "Ajouter à un ingrédient", "Retirer d'un ingrédient", "Supprimer un nutriment"], horizontal=True)

    if mode == "Ajouter un nutriment":
        st.subheader("Nouveau nutriment")
        with st.form("add_nutriment"):
            nom = st.text_input("Nom (ex: Fibres, Vitamine C...)")
            unite = st.text_input("Unité", value="g")
            submitted = st.form_submit_button("Ajouter")
        if submitted:
            res = requests.post(f"{API_URL}/nutriments/", headers=HEADERS, json={"nom": nom, "unite": unite})
            if res.status_code == 200:
                st.success(f"Nutriment « {nom} » ajouté !")
                st.rerun()
            else:
                st.error(f"Erreur : {res.json()}")

    elif mode == "Ajouter à un ingrédient" and noms_nutriments:
        st.subheader("Associer un nutriment à un ingrédient")
        ingredients = api_get("/ingredients/")
        noms_ingredients = {i["nom"]: i for i in ingredients}
        with st.form("add_nutriment_to_ingredient"):
            ing_choisi = st.selectbox("Ingrédient", list(noms_ingredients.keys()))
            nut_choisi = st.selectbox("Nutriment", list(noms_nutriments.keys()))
            valeur = st.number_input("Valeur pour 100g", min_value=0.0, step=0.01)
            submitted = st.form_submit_button("Enregistrer")
        if submitted:
            ing = noms_ingredients[ing_choisi]
            nut = noms_nutriments[nut_choisi]
            res = requests.post(f"{API_URL}/ingredients/{ing['id']}/nutriments/", headers=HEADERS,
                                json={"nutriment_id": nut["id"], "valeur": valeur})
            if res.status_code == 200:
                st.success("Enregistré !")
                st.rerun()
            else:
                st.error(f"Erreur : {res.json()}")

    elif mode == "Retirer d'un ingrédient":
        st.subheader("Nutriments d'un ingrédient")
        ingredients = api_get("/ingredients/")
        noms_ingredients = {i["nom"]: i for i in ingredients}
        if noms_ingredients:
            ing_choisi = st.selectbox("Ingrédient", list(noms_ingredients.keys()))
            ing = noms_ingredients[ing_choisi]
            nuts_ing = {n["nutriment"]["nom"]: n for n in ing.get("nutriments", [])}
            if nuts_ing:
                st.table([{
                    "Nutriment": n["nutriment"]["nom"],
                    "Valeur (100g)": f"{n['valeur']} {n['nutriment']['unite']}"
                } for n in ing["nutriments"]])
                nut_choisi = st.selectbox("Nutriment à retirer", list(nuts_ing.keys()))
                if st.button("Retirer", type="primary"):
                    n = nuts_ing[nut_choisi]
                    res = requests.delete(
                        f"{API_URL}/ingredients/{ing['id']}/nutriments/{n['nutriment']['id']}",
                        headers=HEADERS
                    )
                    if res.status_code == 200:
                        st.success("Retiré !")
                        st.rerun()
                    else:
                        st.error(f"Erreur : {res.json()}")
            else:
                st.info("Aucun nutriment supplémentaire pour cet ingrédient.")

    elif mode == "Supprimer un nutriment" and noms_nutriments:
        st.subheader("Supprimer un nutriment")
        choix = st.selectbox("Nutriment", list(noms_nutriments.keys()))
        if st.button("Supprimer", type="primary"):
            res = requests.delete(f"{API_URL}/nutriments/{noms_nutriments[choix]['id']}", headers=HEADERS)
            if res.status_code == 200:
                st.success("Supprimé !")
                st.rerun()
            else:
                st.error(f"Erreur : {res.json()}")
