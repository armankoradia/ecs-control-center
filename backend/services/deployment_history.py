"""Deployment history management service."""

import time
from typing import List, Dict, Any, Optional
from datetime import datetime
from fastapi import HTTPException
from utils.aws import get_boto3_session
from config.settings import BOTO3_CONFIG

# Deployment history storage (in-memory for now, can be enhanced with database later)
deployment_history: List[Dict[str, Any]] = []


def save_deployment_history(deployment_data: Dict[str, Any]) -> str:
    """Save deployment to history and return deployment ID"""
    deployment_id = deployment_data.get("deployment_id", f"deploy-{int(time.time())}")
    
    history_entry = {
        "deployment_id": deployment_id,
        "timestamp": datetime.utcnow().isoformat(),
        "cluster": deployment_data.get("cluster"),
        "service": deployment_data.get("service"),
        "deployment_type": deployment_data.get("deployment_type"),
        "status": "IN_PROGRESS",
        "message": deployment_data.get("message"),
        "service_arn": deployment_data.get("service_arn"),
        "new_task_definition": deployment_data.get("new_task_definition"),
        "stopped_tasks": deployment_data.get("stopped_tasks", 0),
        "user": deployment_data.get("user", "unknown"),
        # Refresh bookkeeping
        "last_checked_at": None,
        "next_refresh_at": datetime.utcnow().isoformat(),
    }
    
    # Add to beginning of list (most recent first)
    deployment_history.insert(0, history_entry)
    
    # Keep only last 100 deployments to prevent memory issues
    if len(deployment_history) > 100:
        deployment_history.pop()
    
    return deployment_id


def update_deployment_status(
    deployment_id: str,
    profile: str,
    region: str,
    auth_method: str,
    aws_access_key_id: Optional[str] = None,
    aws_secret_access_key: Optional[str] = None,
    aws_session_token: Optional[str] = None
):
    """Update deployment status based on actual ECS service state"""
    try:
        # Find the deployment
        deployment = next((d for d in deployment_history if d.get("deployment_id") == deployment_id), None)
        if not deployment:
            return
        
        cluster = deployment.get("cluster")
        service = deployment.get("service")
        if not cluster or not service:
            return
        
        # Get current service status
        session = get_boto3_session(profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)
        ecs = session.client("ecs", config=BOTO3_CONFIG)
        
        try:
            svc_response = ecs.describe_services(cluster=cluster, services=[service])
        except Exception as e:
            # Non-terminal error: mark as UNKNOWN and keep previous status if it's COMPLETED
            previous_status = deployment.get("status")
            if previous_status != "COMPLETED":
                deployment["status"] = "UNKNOWN"
                deployment["status_error"] = str(e)
            # schedule next refresh soon
            deployment["last_checked_at"] = datetime.utcnow().isoformat()
            deployment["next_refresh_at"] = datetime.utcnow().isoformat()
            return
        if not svc_response.get("services"):
            # Service not found; treat as UNKNOWN unless previously terminal
            if deployment.get("status") not in ["COMPLETED", "FAILED"]:
                deployment["status"] = "UNKNOWN"
            deployment["status_error"] = "Service not found"
            deployment["last_checked_at"] = datetime.utcnow().isoformat()
            deployment["next_refresh_at"] = datetime.utcnow().isoformat()
            return
        
        service_info = svc_response["services"][0]
        desired_count = service_info.get("desiredCount", 0)
        running_count = service_info.get("runningCount", 0)
        pending_count = service_info.get("pendingCount", 0)
        
        # Check deployment status
        deployments = service_info.get("deployments", [])
        primary_deployment = None
        for dep in deployments:
            if dep.get("status") == "PRIMARY":
                primary_deployment = dep
                break
        
        if primary_deployment:
            deployment_status = primary_deployment.get("rolloutState", "UNKNOWN")
            if deployment_status == "FAILED":
                deployment["status"] = "FAILED"
            elif deployment_status == "COMPLETED":
                deployment["status"] = "COMPLETED"
            elif deployment_status in ["IN_PROGRESS", "PENDING", "STARTED"]:
                deployment["status"] = "IN_PROGRESS"
            else:
                # Unknown rollout state: infer from counts without marking failure
                if running_count == 0:
                    deployment["status"] = "PENDING"
                elif running_count < desired_count or pending_count > 0:
                    deployment["status"] = "IN_PROGRESS"
                else:
                    deployment["status"] = "COMPLETED"
        else:
            # No explicit deployment object: infer from counts
            if running_count == 0:
                deployment["status"] = "PENDING"
            elif running_count < desired_count or pending_count > 0:
                deployment["status"] = "IN_PROGRESS"
            else:
                deployment["status"] = "COMPLETED"
        
        # Update additional status info
        deployment["running_count"] = running_count
        deployment["desired_count"] = desired_count
        deployment["pending_count"] = pending_count
        deployment["last_checked_at"] = datetime.utcnow().isoformat()
        # schedule next refresh if not terminal
        if deployment["status"] in ["IN_PROGRESS", "PENDING", "UNKNOWN"]:
            deployment["next_refresh_at"] = datetime.utcnow().isoformat()
        else:
            deployment["next_refresh_at"] = None
        
    except Exception as e:
        # Non-terminal catch-all; avoid marking as FAILED
        if deployment:
            if deployment.get("status") != "COMPLETED":
                deployment["status"] = "UNKNOWN"
            deployment["status_error"] = str(e)
            deployment["last_checked_at"] = datetime.utcnow().isoformat()
            deployment["next_refresh_at"] = datetime.utcnow().isoformat()

