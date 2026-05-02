@echo off
cd C:\Users\nicol\Desktop\frigood_app
call venv\Scripts\activate
uvicorn app.main:app --reload