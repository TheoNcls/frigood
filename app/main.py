# 1. Import de FastAPI
from fastapi import FastAPI

# 2. Crée une instance FastAPI
# → donne lui un titre et une version (paramètres title= et version=)
app = FastAPI(title='Frigood', version='0')

# 3. Une route GET sur "/"
# → elle retourne un dict avec une clé "message"
@app.get("/")
def root():
    return {"message": "Bienvenue sur Frigood !"}