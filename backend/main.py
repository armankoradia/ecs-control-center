"""Refactored main.py - FastAPI application entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes import api_router

# Create FastAPI app
app = FastAPI(title="ECS Control Center API", version="1.0.0")

# CORS middleware - MUST be added before routes
# This handles preflight OPTIONS requests automatically
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Include all API routes
app.include_router(api_router)


@app.get("/")
def root():
    """Root endpoint"""
    return {"message": "ECS Control Center API - Optimized"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

