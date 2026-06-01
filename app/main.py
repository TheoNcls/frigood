# 1. Import de FastAPI
from fastapi import FastAPI
from app.routers import ingredients, recipes, nutriments

app = FastAPI(title="Frigood", version="0.1")

app.include_router(ingredients.router)
app.include_router(recipes.router)
app.include_router(nutriments.router)

@app.get("/")
def root():
    return {"message": "Bienvenue sur Frigood !"}