import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import ingredients, recipes, nutriments, users, meal_logs, activity_types, activities, fridge, tasks

app = FastAPI(title="Frigood", version="0.1")

def _normalize_origin(raw: str) -> str:
    origin = raw.strip().strip("\"'").rstrip("/")
    if origin and not origin.startswith(("http://", "https://")):
        origin = f"https://{origin}"
    return origin


# Origines autorisées pour l'app React (séparées par des virgules)
cors_origins = [o for o in (_normalize_origin(x) for x in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")) if o]
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
app.include_router(tasks.router)

@app.get("/")
def root():
    return {"message": "Bienvenue sur Frigood !"}
