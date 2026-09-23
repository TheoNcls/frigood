import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import ingredients, recipes, nutriments, users, meal_logs, activity_types, activities, fridge

app = FastAPI(title="Frigood", version="0.1")

# Origines autorisées pour l'app React (séparées par des virgules)
cors_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(ingredients.router)
app.include_router(recipes.router)
app.include_router(nutriments.router)
app.include_router(users.router)
app.include_router(meal_logs.router)
app.include_router(activity_types.router)
app.include_router(activities.router)
app.include_router(fridge.router)

@app.get("/")
def root():
    return {"message": "Bienvenue sur Frigood !"}
