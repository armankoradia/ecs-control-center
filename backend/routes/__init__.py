"""API routes module."""

from fastapi import APIRouter

# Create a main router that will be included in the app
api_router = APIRouter()

# Import all route modules to register them
from . import auth, clusters, services, tasks, deployments, logs, task_definitions

# Include all routers
api_router.include_router(auth.router, tags=["auth"])
api_router.include_router(clusters.router, tags=["clusters"])
api_router.include_router(services.router, tags=["services"])
api_router.include_router(tasks.router, tags=["tasks"])
api_router.include_router(deployments.router, tags=["deployments"])
api_router.include_router(logs.router, tags=["logs"])
api_router.include_router(task_definitions.router, tags=["task-definitions"])

__all__ = ["api_router"]

