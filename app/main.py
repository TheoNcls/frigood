from fastapi import FastAPI
from app.routers import ingredients, recipes, nutriments, users, meal_logs, activity_types, activities, fridge

app = FastAPI(title="Frigood", version="0.1")

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