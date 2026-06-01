# 1. Import de FastAPI
from fastapi import FastAPI
from app.routers import ingredients, recipes

app = FastAPI(title="Frigood", version="0.1")

app.include_router(ingredients.router)
app.include_router(recipes.router)

@app.get("/")
def root():
    return {"message": "Bienvenue sur Frigood !"}