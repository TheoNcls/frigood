"""Connexion à Garmin depuis ton PC, quand Garmin bloque les serveurs de Railway (erreurs 429 / 403 Cloudflare).

Utilisation, depuis le dossier du projet :
    venv\\Scripts\\python.exe -m pip install garminconnect==0.3.16
    venv\\Scripts\\python.exe scripts\\garmin_login.py

Colle ensuite le texte affiché dans Frigood : Sport → Garmin Connect → « Importer une session ».
Ce texte donne accès à ton compte Garmin : ne le partage avec personne d'autre.
"""
import getpass

from garminconnect import Garmin


def main():
    email = input("Email Garmin : ").strip()
    password = getpass.getpass("Mot de passe Garmin (rien ne s'affiche, c'est normal) : ")
    api = Garmin(
        email=email,
        password=password,
        prompt_mfa=lambda: input("Code de vérification reçu par mail : ").strip(),
    )
    api.login()
    print("\nConnexion réussie. Copie tout le texte entre les deux lignes, puis colle-le dans Frigood :\n")
    print("-" * 60)
    print(api.client.dumps())
    print("-" * 60)


if __name__ == "__main__":
    main()
