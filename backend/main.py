from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Depends, Header, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import boto3
import time
import asyncio
import json
import os
from datetime import datetime
from botocore.exceptions import NoCredentialsError, ClientError
from botocore.config import Config
# Okta JWT verifier removed for open source version

app = FastAPI()

# Okta configuration removed for open source version

# Deployment history storage (in-memory for now, can be enhanced with database later)
deployment_history: List[Dict[str, Any]] = []

# Optimized boto3 config
BOTO3_CONFIG = Config(
    retries={'max_attempts': 3, 'mode': 'adaptive'},
    max_pool_connections=50
)

def extract_ecr_info(image_uri):
    """Extract ECR region, account, and repository name from image URI"""
    if not image_uri or ".dkr.ecr." not in image_uri:
        return None, None, None
    
    try:
        # Parse ECR image URI: {account-id}.dkr.ecr.{region}.amazonaws.com/{repository-name}:{tag}
        if ".amazonaws.com/" in image_uri:
            # Extract the ECR part
            ecr_part = image_uri.split(".amazonaws.com/")[0]
            repo_and_tag = image_uri.split(".amazonaws.com/")[1]
            
            # Extract region from ECR part
            if ".dkr.ecr." in ecr_part:
                region_part = ecr_part.split(".dkr.ecr.")[1]
                account_id = ecr_part.split(".dkr.ecr.")[0]
                ecr_region = region_part
                
                # Extract repository name (everything before the tag)
                repo_name = repo_and_tag.split(":")[0]
                
                return ecr_region, account_id, repo_name
    except:
        pass
    
    return None, None, None

def unified_image_comparison(current_image_uri: str, images_info: List[Dict[str, Any]], running_task_digest: Optional[str] = None):
    """Unified logic to determine if updates are available and compute latest image URI.

    Handles both versioned tags and the special "latest" tag in a single place.
    - For versioned tags: compares tags against most recent ECR image's first tag
    - For "latest": compares image digests; prefers the digest from a running task when provided
    """
    try:
        if not current_image_uri or not images_info:
            return False, current_image_uri

        # Ensure newest-first ordering
        try:
            images_info = sorted(images_info, key=lambda x: x.get("imagePushedAt", 0), reverse=True)
        except Exception:
            pass

        base_uri = current_image_uri.split(":")[0]
        current_tag = current_image_uri.split(":")[-1]

        if current_tag == "latest":
            latest_digest = images_info[0].get("imageDigest") if images_info else None

            if running_task_digest:
                has_updates = bool(running_task_digest and latest_digest and running_task_digest != latest_digest)
                return has_updates, f"{base_uri}:latest"

            # Fallback: find the digest currently pointed to by the 'latest' tag in ECR
            current_digest = None
            for img in images_info:
                if "latest" in (img.get("imageTags") or []):
                    current_digest = img.get("imageDigest")
                    break

            if current_digest and latest_digest:
                return current_digest != latest_digest, f"{base_uri}:latest"

            # If we cannot resolve digests, default to no updates
            return False, f"{base_uri}:latest"

        # Versioned tags: compare tag strings to the newest image's first tag
        latest_image = images_info[0]
        latest_tags = latest_image.get("imageTags", [])
        if latest_tags:
            latest_tag = latest_tags[0]
            latest_image_uri = f"{base_uri}:{latest_tag}"
            return current_image_uri != latest_image_uri, latest_image_uri

        return False, current_image_uri
    except Exception:
        # Safe fallback on any unexpected condition
        return False, current_image_uri

def get_boto3_session(
    profile: Optional[str] = None,
    region: str = "us-east-1",
    auth_method: str = "access_key",
    aws_access_key_id: Optional[str] = None,
    aws_secret_access_key: Optional[str] = None,
    aws_session_token: Optional[str] = None,
):
    """Get boto3 session supporting access_key authentication only."""
    try:
        if auth_method == "access_key":
            # Trim whitespace to avoid signature issues
            aws_access_key_id = (aws_access_key_id or "").strip() or None
            aws_secret_access_key = (aws_secret_access_key or "").strip() or None
            aws_session_token = (aws_session_token or "").strip() or None
            # Helpful validation: STS temporary keys usually start with ASIA and REQUIRE a session token
            if aws_access_key_id and aws_access_key_id.startswith("ASIA") and not aws_session_token:
                raise HTTPException(status_code=400, detail="Temporary credentials detected (ASIA...). Session token is required.")
            if not (aws_access_key_id and aws_secret_access_key):
                raise HTTPException(status_code=400, detail="access_key requires aws_access_key_id and aws_secret_access_key")
            return boto3.Session(
                aws_access_key_id=aws_access_key_id,
                aws_secret_access_key=aws_secret_access_key,
                aws_session_token=aws_session_token,
                region_name=region,
            )
        else:
            # Only access_key authentication is supported
            raise HTTPException(status_code=400, detail="Only access_key authentication is supported. Please provide aws_access_key_id and aws_secret_access_key.")
    except (NoCredentialsError, ClientError) as e:
        raise HTTPException(status_code=401, detail=f"Authentication failed: {str(e)}")

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

def update_deployment_status(deployment_id: str, profile: str, region: str, auth_method: str, aws_access_key_id: Optional[str] = None, aws_secret_access_key: Optional[str] = None, aws_session_token: Optional[str] = None):
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

# Authentication removed for open source version - no user authentication required

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Models
class DeployRequest(BaseModel):
    cluster: str
    service: str
    container_name: Optional[str] = None
    profile: Optional[str] = None
    region: str = "us-east-1"
    auth_method: str = "access_key"
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    aws_session_token: Optional[str] = None

class ContainerUpdate(BaseModel):
    container_name: str
    cpu: Optional[int] = None
    memory: Optional[int] = None  # This will be used as memoryReservation for containers
    image: Optional[str] = None
    environment_variables: Optional[Dict[str, str]] = None
    secrets: Optional[Dict[str, str]] = None

class TaskDefinitionUpdate(BaseModel):
    cluster: str
    service: str
    container_updates: List[ContainerUpdate] = []
    cpu: Optional[str] = None
    memory: Optional[str] = None
    profile: Optional[str] = None
    region: str = "us-east-1"
    auth_method: str = "access_key"
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    aws_session_token: Optional[str] = None

class DeploymentHistoryRequest(BaseModel):
    cluster: Optional[str] = None
    service: Optional[str] = None
    limit: int = 50
    profile: Optional[str] = None
    region: str = "us-east-1"
    auth_method: str = "access_key"
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    aws_session_token: Optional[str] = None

class RefreshDeploymentRequest(BaseModel):
    profile: Optional[str] = None
    region: str = "us-east-1"
    auth_method: str = "access_key"
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    aws_session_token: Optional[str] = None

class RollbackRequest(BaseModel):
    profile: Optional[str] = None
    region: str = "us-east-1"
    auth_method: str = "access_key"
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    aws_session_token: Optional[str] = None

class TaskDefinitionRequest(BaseModel):
    cluster: str
    service: str
    profile: Optional[str] = None
    region: str = "us-east-1"
    auth_method: str = "access_key"
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    aws_session_token: Optional[str] = None

class ServiceImageInfoRequest(BaseModel):
    cluster: str
    service: str
    profile: Optional[str] = None
    region: str = "us-east-1"
    auth_method: str = "access_key"
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    aws_session_token: Optional[str] = None

class ClustersRequest(BaseModel):
    profile: Optional[str] = None
    region: str = "us-east-1"
    auth_method: str = "access_key"
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    aws_session_token: Optional[str] = None

class ServicesRequest(BaseModel):
    cluster: str
    profile: Optional[str] = None
    region: str = "us-east-1"
    auth_method: str = "access_key"
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    aws_session_token: Optional[str] = None

class TasksRequest(BaseModel):
    cluster: str
    service: str
    profile: Optional[str] = None
    region: str = "us-east-1"
    auth_method: str = "access_key"
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    aws_session_token: Optional[str] = None

class TaskDetailsRequest(BaseModel):
    cluster: str
    service: str
    profile: Optional[str] = None
    region: str = "us-east-1"
    auth_method: str = "access_key"
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    aws_session_token: Optional[str] = None

class ClusterOverviewRequest(BaseModel):
    cluster: str
    profile: Optional[str] = None
    region: str = "us-east-1"
    auth_method: str = "access_key"
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    aws_session_token: Optional[str] = None

class DeploymentStatusRequest(BaseModel):
    cluster: str
    service: str
    profile: Optional[str] = None
    region: str = "us-east-1"
    auth_method: str = "access_key"
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    aws_session_token: Optional[str] = None

class TaskCountRequest(BaseModel):
    cluster: str
    service: Optional[str] = None
    profile: Optional[str] = None
    region: str = "us-east-1"
    auth_method: str = "access_key"
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    aws_session_token: Optional[str] = None

class AuthTestRequest(BaseModel):
    profile: Optional[str] = None
    region: str = "us-east-1"
    auth_method: str = "access_key"
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    aws_session_token: Optional[str] = None

class LogTargetRequest(BaseModel):
    cluster: str
    service: str
    profile: Optional[str] = None
    region: str = "us-east-1"
    auth_method: str = "access_key"
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    aws_session_token: Optional[str] = None

class HistoricalLogsRequest(BaseModel):
    cluster: str
    service: str
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    limit: int = 1000
    profile: Optional[str] = None
    region: str = "us-east-1"
    auth_method: str = "access_key"
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    aws_session_token: Optional[str] = None

class UpdateTaskCountRequest(BaseModel):
    cluster: str
    service: str
    desired_count: int
    profile: Optional[str] = None
    region: str = "us-east-1"
    auth_method: str = "access_key"
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    aws_session_token: Optional[str] = None

class ForceNewDeploymentRequest(BaseModel):
    cluster: str
    service: str
    profile: Optional[str] = None
    region: str = "us-east-1"
    auth_method: str = "access_key"
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    aws_session_token: Optional[str] = None

class ServiceEventsRequest(BaseModel):
    cluster: str
    service: str
    profile: Optional[str] = None
    region: str = "us-east-1"
    auth_method: str = "access_key"
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    aws_session_token: Optional[str] = None

# Endpoints
@app.get("/")
def root():
    return {"message": "ECS Explorer API - Optimized"}

# Authentication status endpoint removed for open source version

@app.post("/auth_test")
def test_authentication_post(request: AuthTestRequest):
    """Test authentication (POST version)"""
    return test_authentication_impl(
        request.profile, request.region, request.auth_method,
        request.aws_access_key_id, request.aws_secret_access_key, request.aws_session_token
    )

@app.get("/auth_test")
def test_authentication(
    profile: Optional[str] = None,
    region: str = "us-east-1",
    auth_method: str = "access_key",
    aws_access_key_id: Optional[str] = None,
    aws_secret_access_key: Optional[str] = None,
    aws_session_token: Optional[str] = None,
):
    """Test authentication (GET version for backward compatibility)"""
    return test_authentication_impl(profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)

def test_authentication_impl(
    profile: Optional[str] = None,
    region: str = "us-east-1",
    auth_method: str = "access_key",
    aws_access_key_id: Optional[str] = None,
    aws_secret_access_key: Optional[str] = None,
    aws_session_token: Optional[str] = None,
):
    """Test authentication method"""
    try:
        session = get_boto3_session(profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)
        sts = session.client('sts', config=BOTO3_CONFIG)
        identity = sts.get_caller_identity()
        return {
            "success": True,
            "auth_method": auth_method,
            "identity": {
                "user_id": identity.get("UserId"),
                "account": identity.get("Account"),
                "arn": identity.get("Arn")
            }
        }
    except Exception as e:
        return {
            "success": False,
            "auth_method": auth_method,
            "error": str(e)
        }


@app.post("/clusters")
def list_clusters_post(request: ClustersRequest):
    """List ECS clusters (POST version)"""
    return list_clusters_impl(
        request.profile, request.region, request.auth_method,
        request.aws_access_key_id, request.aws_secret_access_key, request.aws_session_token
    )

@app.get("/clusters")
def list_clusters(
    profile: Optional[str] = None,
    region: str = "us-east-1",
    auth_method: str = "access_key",
    aws_access_key_id: Optional[str] = None,
    aws_secret_access_key: Optional[str] = None,
    aws_session_token: Optional[str] = None,
):
    """List ECS clusters (GET version for backward compatibility)"""
    return list_clusters_impl(profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)

def list_clusters_impl(
    profile: Optional[str] = None,
    region: str = "us-east-1",
    auth_method: str = "access_key",
    aws_access_key_id: Optional[str] = None,
    aws_secret_access_key: Optional[str] = None,
    aws_session_token: Optional[str] = None,
):
    """List ECS clusters"""
    try:
        session = get_boto3_session(profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)
        ecs = session.client("ecs", config=BOTO3_CONFIG)
        clusters = []
        paginator = ecs.get_paginator("list_clusters")
        for page in paginator.paginate():
            clusters.extend(page["clusterArns"])
        return clusters
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list clusters: {str(e)}")

@app.post("/services")
def list_services_post(request: ServicesRequest):
    """List ECS services (POST version)"""
    return list_services_impl(
        request.cluster, request.profile, request.region, request.auth_method,
        request.aws_access_key_id, request.aws_secret_access_key, request.aws_session_token
    )

@app.get("/services")
def list_services(
    cluster: str,
    profile: Optional[str] = None,
    region: str = "us-east-1",
    auth_method: str = "access_key",
    aws_access_key_id: Optional[str] = None,
    aws_secret_access_key: Optional[str] = None,
    aws_session_token: Optional[str] = None,
):
    """List ECS services (GET version for backward compatibility)"""
    return list_services_impl(cluster, profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)

def list_services_impl(
    cluster: str,
    profile: Optional[str] = None,
    region: str = "us-east-1",
    auth_method: str = "access_key",
    aws_access_key_id: Optional[str] = None,
    aws_secret_access_key: Optional[str] = None,
    aws_session_token: Optional[str] = None,
):
    """List ECS services"""
    try:
        session = get_boto3_session(profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)
        ecs = session.client("ecs", config=BOTO3_CONFIG)
        services = []
        paginator = ecs.get_paginator("list_services")
        for page in paginator.paginate(cluster=cluster):
            services.extend(page["serviceArns"])
        return [s.split("/")[-1] for s in services]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list services: {str(e)}")

@app.post("/tasks")
def list_tasks_post(request: TasksRequest):
    """List ECS tasks (POST version)"""
    return list_tasks_impl(
        request.cluster, request.service, request.profile, request.region, request.auth_method,
        request.aws_access_key_id, request.aws_secret_access_key, request.aws_session_token
    )

@app.get("/tasks")
def list_tasks(
    cluster: str,
    service: str,
    profile: Optional[str] = None,
    region: str = "us-east-1",
    auth_method: str = "access_key",
    aws_access_key_id: Optional[str] = None,
    aws_secret_access_key: Optional[str] = None,
    aws_session_token: Optional[str] = None,
):
    """List ECS tasks (GET version for backward compatibility)"""
    return list_tasks_impl(cluster, service, profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)

def list_tasks_impl(
    cluster: str,
    service: str,
    profile: Optional[str] = None,
    region: str = "us-east-1",
    auth_method: str = "access_key",
    aws_access_key_id: Optional[str] = None,
    aws_secret_access_key: Optional[str] = None,
    aws_session_token: Optional[str] = None,
):
    """List ECS tasks"""
    try:
        session = get_boto3_session(profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)
        ecs = session.client("ecs", config=BOTO3_CONFIG)
        tasks = ecs.list_tasks(cluster=cluster, serviceName=service)
        return tasks.get("taskArns", [])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list tasks: {str(e)}")

@app.post("/task_count")
def task_count_post(request: TaskCountRequest):
    """Get count of active tasks (POST version)"""
    return task_count_impl(
        request.cluster, request.service, request.profile, request.region, request.auth_method,
        request.aws_access_key_id, request.aws_secret_access_key, request.aws_session_token
    )

@app.get("/task_count")
def task_count(cluster: str, service: str = None, profile: Optional[str] = None, region: str = "us-east-1", auth_method: str = "access_key", aws_access_key_id: Optional[str] = None, aws_secret_access_key: Optional[str] = None, aws_session_token: Optional[str] = None):
    """Get count of active tasks (GET version for backward compatibility)"""
    return task_count_impl(cluster, service, profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)

def task_count_impl(cluster: str, service: str = None, profile: Optional[str] = None, region: str = "us-east-1", auth_method: str = "access_key", aws_access_key_id: Optional[str] = None, aws_secret_access_key: Optional[str] = None, aws_session_token: Optional[str] = None):
    """Get count of active tasks for a cluster or specific service"""
    try:
        session = get_boto3_session(profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)
        ecs = session.client("ecs", config=BOTO3_CONFIG)
        
        if service:
            # Count tasks for specific service
            tasks = ecs.list_tasks(cluster=cluster, serviceName=service)
            task_count = len(tasks.get("taskArns", []))
        else:
            # Count all tasks in cluster
            tasks = ecs.list_tasks(cluster=cluster)
            task_count = len(tasks.get("taskArns", []))
        
        return {"count": task_count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to count tasks: {str(e)}")

@app.post("/task_details")
def task_details_post(request: TaskDetailsRequest):
    """Get detailed task information (POST version)"""
    return task_details_impl(
        request.cluster, request.service, request.profile, request.region, request.auth_method,
        request.aws_access_key_id, request.aws_secret_access_key, request.aws_session_token
    )

@app.get("/task_details")
def task_details(
    cluster: str,
    service: str,
    profile: Optional[str] = None,
    region: str = "us-east-1",
    auth_method: str = "access_key",
    aws_access_key_id: Optional[str] = None,
    aws_secret_access_key: Optional[str] = None,
    aws_session_token: Optional[str] = None,
):
    """Get detailed task information (GET version for backward compatibility)"""
    return task_details_impl(cluster, service, profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)

def task_details_impl(
    cluster: str,
    service: str,
    profile: Optional[str] = None,
    region: str = "us-east-1",
    auth_method: str = "access_key",
    aws_access_key_id: Optional[str] = None,
    aws_secret_access_key: Optional[str] = None,
    aws_session_token: Optional[str] = None,
):
    """Get detailed task information"""
    try:
        session = get_boto3_session(profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)
        ecs = session.client("ecs", config=BOTO3_CONFIG)
        # ECR client will be created dynamically based on image region

        task_arns = ecs.list_tasks(cluster=cluster, serviceName=service, desiredStatus="RUNNING").get("taskArns", [])
        results = []
        
        if not task_arns:
            # Check for stopped tasks
            stopped_arns = []
            paginator = ecs.get_paginator("list_tasks")
            for page in paginator.paginate(cluster=cluster, serviceName=service, desiredStatus="STOPPED"):
                stopped_arns.extend(page.get("taskArns", []))
            if not stopped_arns:
                return []
            stopped_arns = stopped_arns[:2]  # Limit to 2 most recent
            stopped_desc = ecs.describe_tasks(cluster=cluster, tasks=stopped_arns)
            
            for t in stopped_desc.get("tasks", []):
                task_arn = t.get("taskArn")
                task_id = task_arn.split("/")[-1] if task_arn else ""
                td_arn = t.get("taskDefinitionArn")
                td = ecs.describe_task_definition(taskDefinition=td_arn).get("taskDefinition", {}) if td_arn else {}
                
                images = []
                for c in (td.get("containerDefinitions") or []):
                    img_uri = c.get("image")
                    container_name = c.get("name")
                    is_latest = False
                    latest_image_uri = None
                    
                    if img_uri and ".dkr.ecr." in img_uri:
                        try:
                            # Extract ECR region, account, and repository name from image URI
                            ecr_region, account_id, repo_name = extract_ecr_info(img_uri)
                            if not ecr_region or not repo_name:
                                continue
                            
                            # Create ECR client for the correct region
                            ecr = session.client("ecr", region_name=ecr_region, config=BOTO3_CONFIG)
                            
                            current_tag = img_uri.split(":")[-1]
                            
                            resp = ecr.describe_images(repositoryName=repo_name, filter={"tagStatus": "TAGGED"})
                            images_info = resp.get("imageDetails", [])
                            if images_info:
                                images_info.sort(key=lambda x: x.get("imagePushedAt", 0), reverse=True)
                                
                            # Use unified logic to compute whether image is latest and what the latest URI is
                            has_updates_tmp, latest_image_uri_tmp = unified_image_comparison(
                                img_uri,
                                images_info,
                                running_task_digest=None
                            )
                            latest_image_uri = latest_image_uri_tmp
                            is_latest = not has_updates_tmp
                        except:
                            pass
                    
                    images.append({
                        "uri": img_uri,
                        "latest_tag": latest_image_uri.split(":")[-1] if latest_image_uri else None,
                        "latest_image_uri": latest_image_uri,
                        "is_latest": is_latest,
                        "container_name": container_name
                    })
                
                # Get container error details
                exit_code = None
                container_reason = None
                containers = t.get("containers", [])
                if containers:
                    first_container = containers[0]
                    exit_code = first_container.get("exitCode")
                    container_reason = first_container.get("reason")
                
                results.append({
                    "task_id": task_id,
                    "task_arn": task_arn,
                    "cpu": td.get("cpu") or t.get("cpu"),
                    "memory": td.get("memory") or t.get("memory"),
                    "task_definition": f"{td.get('family', '')}:{td.get('revision', '')}" if td.get('family') else td_arn,
                    "images": images,
                    "stopped_reason": t.get("stoppedReason"),
                    "exit_code": exit_code,
                    "container_reason": container_reason,
                    "status": "STOPPED"
                })
            return results

        # Get service information to determine if it uses latest tags
        service_info = None
        try:
            svc_response = ecs.describe_services(cluster=cluster, services=[service])
            if svc_response.get("services"):
                service_info = svc_response["services"][0]
        except:
            pass
        
        # Determine if service uses latest tags
        uses_latest_tag = False
        if service_info:
            try:
                svc_td_arn = service_info.get("taskDefinition")
                if svc_td_arn:
                    svc_td = ecs.describe_task_definition(taskDefinition=svc_td_arn).get("taskDefinition", {})
                    for c in svc_td.get("containerDefinitions", []):
                        img_uri = c.get("image", "")
                        if img_uri and ".dkr.ecr." in img_uri:
                            current_tag = img_uri.split(":")[-1]
                            if current_tag == "latest":
                                uses_latest_tag = True
                                break
            except:
                pass

        # Handle running tasks
        tasks_desc = ecs.describe_tasks(cluster=cluster, tasks=task_arns)
        for t in tasks_desc.get("tasks", []):
            task_arn = t.get("taskArn")
            task_id = task_arn.split("/")[-1] if task_arn else ""
            td_arn = t.get("taskDefinitionArn")
            td = ecs.describe_task_definition(taskDefinition=td_arn).get("taskDefinition", {}) if td_arn else {}
            
            images = []
            
            # Get actual running container images (with digests) from the task
            running_containers = t.get("containers", [])
            container_images = {}
            container_digests = {}
            for container in running_containers:
                container_name = container.get("name")
                actual_image = container.get("image")
                image_digest = container.get("imageDigest")
                container_images[container_name] = actual_image
                container_digests[container_name] = image_digest
            
            for c in (td.get("containerDefinitions") or []):
                img_uri = c.get("image")  # Task definition image (repo:tag)
                container_name = c.get("name")
                
                # Use actual running container image if available (includes digest)
                actual_running_image = container_images.get(container_name, img_uri)
                
                is_latest = False
                latest_image_uri = None
                
                if img_uri and ".dkr.ecr." in img_uri:
                    try:
                        # Extract ECR region, account, and repository name from image URI
                        ecr_region, account_id, repo_name = extract_ecr_info(img_uri)
                        if not ecr_region or not repo_name:
                            continue
                        
                        # Create ECR client for the correct region
                        ecr = session.client("ecr", region_name=ecr_region, config=BOTO3_CONFIG)
                        
                        current_tag = img_uri.split(":")[-1]
                        
                        resp = ecr.describe_images(repositoryName=repo_name, filter={"tagStatus": "TAGGED"})
                        images_info = resp.get("imageDetails", [])
                        if images_info:
                            images_info.sort(key=lambda x: x.get("imagePushedAt", 0), reverse=True)
                            
                            # Use unified logic with running task digest when available
                            running_digest = container_digests.get(container_name)
                            has_updates_tmp, latest_image_uri_tmp = unified_image_comparison(
                                img_uri,
                                images_info,
                                running_task_digest=running_digest
                            )
                            latest_image_uri = latest_image_uri_tmp
                            is_latest = not has_updates_tmp
                    except:
                        pass
                
                # Build image URI with digest if available
                image_with_digest = actual_running_image
                current_digest = container_digests.get(container_name)
                if current_digest and not "@" in actual_running_image:
                    image_with_digest = f"{actual_running_image}@{current_digest}"
                
                images.append({
                    "uri": image_with_digest,  # Show actual running image with digest
                    "task_definition_uri": img_uri,  # Keep original task definition URI for reference
                    "latest_tag": latest_image_uri.split(":")[-1] if latest_image_uri else None,
                    "latest_image_uri": latest_image_uri,
                    "is_latest": is_latest,
                    "container_name": container_name
                })
            
            results.append({
                "task_id": task_id,
                "task_arn": task_arn,
                "cpu": td.get("cpu") or t.get("cpu"),
                "memory": td.get("memory") or t.get("memory"),
                "task_definition": f"{td.get('family', '')}:{td.get('revision', '')}" if td.get('family') else td_arn,
                "images": images,
                "status": "RUNNING",
                "service_uses_latest_tag": uses_latest_tag
            })
        return results
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get task details: {str(e)}")

@app.post("/deploy")
def deploy_new_image(data: DeployRequest):
    """Deploy new image with latest ECR version"""
    try:
        session = get_boto3_session(data.profile, data.region, data.auth_method, data.aws_access_key_id, data.aws_secret_access_key, data.aws_session_token)
        ecs = session.client("ecs", config=BOTO3_CONFIG)
        # ECR client will be created dynamically based on image region

        # Get current service and task definition
        svc = ecs.describe_services(cluster=data.cluster, services=[data.service])["services"][0]
        td_arn = svc["taskDefinition"]
        td = ecs.describe_task_definition(taskDefinition=td_arn)["taskDefinition"]

        # Check if any container uses "latest" tag
        has_latest_tag = False
        for c in td["containerDefinitions"]:
            current_image_uri = c.get("image", "")
            if current_image_uri and ".dkr.ecr." in current_image_uri:
                current_tag = current_image_uri.split(":")[-1]
                if current_tag == "latest":
                    has_latest_tag = True
                    break
        
        if has_latest_tag:
            # For "latest" tag: Just trigger force new deployment to pull the latest image
            update_response = ecs.update_service(
                cluster=data.cluster,
                service=data.service,
                forceNewDeployment=True
            )
            
            deployment_data = {
                "cluster": data.cluster,
                "service": data.service,
                "message": "Force new deployment started - ECS will pull latest image and start new tasks",
                "deployment_type": "latest_tag_restart",
                "service_arn": update_response["service"]["serviceArn"],
                "deployment_id": f"{data.cluster}-{data.service}-{int(time.time())}"
            }
            
            # Save to deployment history
            save_deployment_history(deployment_data)
            
            return deployment_data
        else:
            # For versioned tags: Update task definition with latest image
            new_container_defs = []
            for c in td["containerDefinitions"]:
                new_c = c.copy()
                current_image_uri = c.get("image", "")
                
                should_update = (
                    (data.container_name and c["name"] == data.container_name) or
                    (not data.container_name)
                )
                
                if should_update and current_image_uri and ".dkr.ecr." in current_image_uri:
                    try:
                        # Extract ECR region, account, and repository name from image URI
                        ecr_region, account_id, repo_name = extract_ecr_info(current_image_uri)
                        if not ecr_region or not repo_name:
                            continue
                        
                        # Create ECR client for the correct region
                        ecr = session.client("ecr", region_name=ecr_region, config=BOTO3_CONFIG)
                        
                        resp = ecr.describe_images(repositoryName=repo_name, filter={"tagStatus": "TAGGED"})
                        images_info = resp.get("imageDetails", [])
                        
                        if images_info:
                            images_info.sort(key=lambda x: x.get("imagePushedAt", 0), reverse=True)
                            latest_image = images_info[0]
                            latest_tags = latest_image.get("imageTags", [])
                            
                            if latest_tags:
                                latest_tag = latest_tags[0]
                                base_uri = current_image_uri.split(":")[0]
                                new_c["image"] = f"{base_uri}:{latest_tag}"
                    except:
                        pass
                
                new_container_defs.append(new_c)

            # Register new task definition
            register_args = {
                "family": td["family"],
                "containerDefinitions": new_container_defs,
                "cpu": td.get("cpu"),
                "memory": td.get("memory"),
                "networkMode": td.get("networkMode"),
                "requiresCompatibilities": td.get("requiresCompatibilities"),
                "executionRoleArn": td.get("executionRoleArn"),
                "taskRoleArn": td.get("taskRoleArn"),
                "volumes": td.get("volumes", []),
                "placementConstraints": td.get("placementConstraints", []),
                "proxyConfiguration": td.get("proxyConfiguration"),
                "inferenceAccelerators": td.get("inferenceAccelerators", []),
                "ephemeralStorage": td.get("ephemeralStorage"),
            }
            
            tags = td.get("tags", [])
            if tags:
                register_args["tags"] = tags
                
            register_args = {k: v for k, v in register_args.items() if v is not None}
            new_td = ecs.register_task_definition(**register_args)["taskDefinition"]
            new_td_arn = new_td["taskDefinitionArn"]

            # Update service
            update_response = ecs.update_service(
                cluster=data.cluster, 
                service=data.service, 
                taskDefinition=new_td_arn
            )

            deployment_data = {
                "cluster": data.cluster,
                "service": data.service,
                "message": "Deployment started successfully", 
                "deployment_type": "versioned_tag_update",
                "new_task_definition": new_td_arn,
                "service_arn": update_response["service"]["serviceArn"],
                "deployment_id": f"{data.cluster}-{data.service}-{int(time.time())}"
            }
            
            # Save to deployment history
            save_deployment_history(deployment_data)
            
            return deployment_data
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Deployment failed: {str(e)}")

@app.post("/deployment_status")
def get_deployment_status_post(request: DeploymentStatusRequest):
    """Check deployment status (POST version)"""
    return get_deployment_status_impl(
        request.cluster, request.service, request.profile, request.region, request.auth_method,
        request.aws_access_key_id, request.aws_secret_access_key, request.aws_session_token
    )

@app.get("/deployment_status")
def get_deployment_status(
    cluster: str,
    service: str,
    profile: Optional[str] = None,
    region: str = "us-east-1",
    auth_method: str = "access_key",
    aws_access_key_id: Optional[str] = None,
    aws_secret_access_key: Optional[str] = None,
    aws_session_token: Optional[str] = None,
):
    """Check deployment status (GET version for backward compatibility)"""
    return get_deployment_status_impl(cluster, service, profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)

def get_deployment_status_impl(
    cluster: str,
    service: str,
    profile: Optional[str] = None,
    region: str = "us-east-1",
    auth_method: str = "access_key",
    aws_access_key_id: Optional[str] = None,
    aws_secret_access_key: Optional[str] = None,
    aws_session_token: Optional[str] = None,
):
    """Check deployment status"""
    try:
        session = get_boto3_session(profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)
        ecs = session.client("ecs", config=BOTO3_CONFIG)
        
        svc_response = ecs.describe_services(cluster=cluster, services=[service])
        if not svc_response["services"]:
            return {"error": "Service not found"}
        
        service_info = svc_response["services"][0]
        desired_count = service_info.get("desiredCount", 0)
        running_count = service_info.get("runningCount", 0)
        pending_count = service_info.get("pendingCount", 0)
        
        status = "COMPLETED"
        if running_count < desired_count or pending_count > 0:
            status = "IN_PROGRESS"
        elif running_count == 0:
            status = "PENDING"
        
        return {
            "status": status,
            "desired_count": desired_count,
            "running_count": running_count,
            "pending_count": pending_count
        }
        
    except Exception as e:
        return {"error": f"Failed to get deployment status: {str(e)}"}

@app.post("/service/update_count")
def update_service_count(request: UpdateTaskCountRequest):
    """Update the desired count for an ECS service"""
    try:
        session = get_boto3_session(request.profile, request.region, request.auth_method, request.aws_access_key_id, request.aws_secret_access_key, request.aws_session_token)
        ecs = session.client("ecs", config=BOTO3_CONFIG)
        
        # Validate desired count
        if request.desired_count < 0:
            raise HTTPException(status_code=400, detail="Desired count must be 0 or greater")
        
        # Get current service info
        svc_response = ecs.describe_services(cluster=request.cluster, services=[request.service])
        if not svc_response["services"]:
            raise HTTPException(status_code=404, detail="Service not found")
        
        service_info = svc_response["services"][0]
        current_desired_count = service_info.get("desiredCount", 0)
        
        # Update service desired count
        update_response = ecs.update_service(
            cluster=request.cluster,
            service=request.service,
            desiredCount=request.desired_count
        )
        
        return {
            "success": True,
            "message": f"Service desired count updated from {current_desired_count} to {request.desired_count}",
            "cluster": request.cluster,
            "service": request.service,
            "previous_count": current_desired_count,
            "new_count": request.desired_count,
            "service_arn": update_response["service"]["serviceArn"]
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update service count: {str(e)}")

@app.post("/service/force_new_deployment")
def force_new_deployment(request: ForceNewDeploymentRequest):
    """Force a new deployment for an ECS service (mimics AWS Console behavior)"""
    try:
        session = get_boto3_session(request.profile, request.region, request.auth_method, request.aws_access_key_id, request.aws_secret_access_key, request.aws_session_token)
        ecs = session.client("ecs", config=BOTO3_CONFIG)
        
        # Get current service info
        svc_response = ecs.describe_services(cluster=request.cluster, services=[request.service])
        if not svc_response["services"]:
            raise HTTPException(status_code=404, detail="Service not found")
        
        # Force new deployment
        update_response = ecs.update_service(
            cluster=request.cluster,
            service=request.service,
            forceNewDeployment=True
        )
        
        deployment_data = {
            "cluster": request.cluster,
            "service": request.service,
            "message": "Force new deployment started - ECS will start new tasks with the current task definition",
            "deployment_type": "force_new_deployment",
            "service_arn": update_response["service"]["serviceArn"],
            "deployment_id": f"{request.cluster}-{request.service}-{int(time.time())}"
        }
        
        # Save to deployment history
        save_deployment_history(deployment_data)
        
        return {
            "success": True,
            "message": "Force new deployment initiated successfully",
            **deployment_data
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to force new deployment: {str(e)}")

@app.post("/service/events")
def get_service_events(request: ServiceEventsRequest):
    """Get ECS service events (task placement, deployments, etc.)"""
    try:
        session = get_boto3_session(request.profile, request.region, request.auth_method, request.aws_access_key_id, request.aws_secret_access_key, request.aws_session_token)
        ecs = session.client("ecs", config=BOTO3_CONFIG)
        
        # Get service details including events
        svc_response = ecs.describe_services(cluster=request.cluster, services=[request.service])
        if not svc_response["services"]:
            raise HTTPException(status_code=404, detail="Service not found")
        
        service_info = svc_response["services"][0]
        events = service_info.get("events", [])
        
        # Format events for frontend
        formatted_events = []
        for event in events:
            formatted_events.append({
                "id": event.get("id"),
                "created_at": event.get("createdAt").isoformat() if event.get("createdAt") else None,
                "message": event.get("message", "")
            })
        
        # Sort by created_at descending (newest first)
        formatted_events.sort(key=lambda x: x["created_at"] or "", reverse=True)
        
        return {
            "events": formatted_events,
            "count": len(formatted_events)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get service events: {str(e)}")

@app.post("/cluster_overview")
def get_cluster_overview_post(request: ClusterOverviewRequest):
    """Get cluster overview (POST version)"""
    return get_cluster_overview_impl(
        request.cluster, request.profile, request.region, request.auth_method,
        request.aws_access_key_id, request.aws_secret_access_key, request.aws_session_token
    )

@app.get("/cluster_overview")
def get_cluster_overview(
    cluster: str,
    profile: Optional[str] = None,
    region: str = "us-east-1",
    auth_method: str = "access_key",
    aws_access_key_id: Optional[str] = None,
    aws_secret_access_key: Optional[str] = None,
    aws_session_token: Optional[str] = None,
):
    """Get cluster overview (GET version for backward compatibility)"""
    return get_cluster_overview_impl(cluster, profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)

def get_cluster_overview_impl(
    cluster: str,
    profile: Optional[str] = None,
    region: str = "us-east-1",
    auth_method: str = "access_key",
    aws_access_key_id: Optional[str] = None,
    aws_secret_access_key: Optional[str] = None,
    aws_session_token: Optional[str] = None,
):
    """Get cluster overview"""
    try:
        session = get_boto3_session(profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)
        ecs = session.client("ecs", config=BOTO3_CONFIG)
        # ECR client will be created dynamically based on image region
        
        # Get all services with pagination
        service_arns = []
        next_token = None
        
        while True:
            if next_token:
                services_response = ecs.list_services(cluster=cluster, nextToken=next_token, maxResults=100)
            else:
                services_response = ecs.list_services(cluster=cluster, maxResults=100)
            
            batch_arns = services_response.get("serviceArns", [])
            service_arns.extend(batch_arns)
            next_token = services_response.get("nextToken")
            
            if not next_token:
                break
        
        if not service_arns:
            return {"services": [], "summary": {"total": 0, "no_tasks": 0, "updates_available": 0, "up_to_date": 0}}
        
        # Convert ARNs to service names and describe services in batches of 10 (AWS limit)
        service_names = [arn.split("/")[-1] for arn in service_arns]
        services = []
        batch_size = 10
        for i in range(0, len(service_names), batch_size):
            batch_names = service_names[i:i + batch_size]
            services_details = ecs.describe_services(cluster=cluster, services=batch_names)
            services.extend(services_details.get("services", []))
        
        processed_services = []
        no_tasks_count = 0
        updates_available_count = 0
        up_to_date_count = 0
        latest_tag_services_count = 0
        latest_tag_updates_count = 0
        
        # Cache for task definitions to avoid duplicate API calls
        td_cache = {}
        # Cache for ECR clients to avoid recreating them
        ecr_client_cache = {}
        
        # Performance optimization: Limit expensive "latest" tag digest checks
        # to prevent timeout on clusters with many services using "latest" tags
        max_latest_tag_checks = 10  # Limit to first 10 services with latest tags
        latest_tag_checks_count = 0
        
        for service in services:
            service_name = service.get("serviceName")
            running_count = service.get("runningCount", 0)
            
            current_td_arn = service.get("taskDefinition")
            has_updates = False
            current_image_uri = None
            latest_image_uri = None
            
            if current_td_arn:
                try:
                    # Use cached task definition or fetch if not cached
                    if current_td_arn not in td_cache:
                        td_response = ecs.describe_task_definition(taskDefinition=current_td_arn)
                        td_cache[current_td_arn] = td_response.get("taskDefinition", {})
                    current_td = td_cache[current_td_arn]
                    
                    if current_td.get("containerDefinitions"):
                        for container in current_td.get("containerDefinitions", []):
                            image_uri = container.get("image", "")
                            # Early exit: Skip non-ECR images to avoid unnecessary processing
                            if not (image_uri and ".dkr.ecr." in image_uri):
                                continue
                            
                            current_image_uri = image_uri
                            try:
                                # Extract ECR region, account, and repository name from image URI
                                ecr_region, account_id, repo_name = extract_ecr_info(image_uri)
                                if not ecr_region or not repo_name:
                                    continue
                                
                                # Use cached ECR client or create new one
                                ecr_key = f"{ecr_region}_{account_id}"
                                if ecr_key not in ecr_client_cache:
                                    ecr_client_cache[ecr_key] = session.client("ecr", region_name=ecr_region, config=BOTO3_CONFIG)
                                ecr = ecr_client_cache[ecr_key]
                                
                                current_tag = image_uri.split(":")[-1]
                                
                                resp = ecr.describe_images(repositoryName=repo_name, filter={"tagStatus": "TAGGED"})
                                images_info = resp.get("imageDetails", [])
                                
                                if images_info:
                                    # Sort by push time to get most recent
                                    images_info.sort(key=lambda x: x.get("imagePushedAt", 0), reverse=True)
                                    
                                # Use unified comparison logic for both tag types
                                running_digest_for_service = None
                                if current_tag == "latest" and latest_tag_checks_count < max_latest_tag_checks:
                                    try:
                                        running_tasks = ecs.list_tasks(
                                            cluster=cluster,
                                            serviceName=service_name,
                                            desiredStatus="RUNNING"
                                        ).get("taskArns", [])
                                        if running_tasks:
                                            task_details = ecs.describe_tasks(
                                                cluster=cluster,
                                                tasks=running_tasks[:1]
                                            ).get("tasks", [])
                                            if task_details:
                                                for c in task_details[0].get("containers", []):
                                                    running_digest_for_service = c.get("imageDigest")
                                                    if running_digest_for_service:
                                                        break
                                    except Exception:
                                        pass
                                    latest_tag_checks_count += 1

                                has_updates, latest_image_uri = unified_image_comparison(
                                    image_uri,
                                    images_info,
                                    running_digest_for_service
                                )
                            except:
                                pass
                            break
                except:
                    pass
            
            # Determine if service uses "latest" tags (use cached task definition)
            uses_latest_tag = False
            if current_td_arn and current_td_arn in td_cache:
                try:
                    current_td = td_cache[current_td_arn]
                    if current_td.get("containerDefinitions"):
                        for container in current_td.get("containerDefinitions", []):
                            image_uri = container.get("image", "")
                            if image_uri and ".dkr.ecr." in image_uri:
                                current_tag = image_uri.split(":")[-1]
                                if current_tag == "latest":
                                    uses_latest_tag = True
                                    break
                except:
                    pass
            
            status = "UP_TO_DATE"
            if running_count == 0:
                status = "NO_TASKS"
                no_tasks_count += 1
            elif has_updates:
                status = "UPDATES_AVAILABLE"
                updates_available_count += 1
            else:
                up_to_date_count += 1
            
            # Count latest tag services
            if uses_latest_tag:
                latest_tag_services_count += 1
                if has_updates:
                    latest_tag_updates_count += 1
            
            processed_services.append({
                "service_name": service_name,
                "status": status,
                "running_count": running_count,
                "desired_count": service.get("desiredCount", 0),
                "current_image_uri": current_image_uri,
                "latest_image_uri": latest_image_uri,
                "task_definition": current_td_arn,
                "has_updates": has_updates,
                "uses_latest_tag": uses_latest_tag
            })
        
        return {
            "services": processed_services,
            "summary": {
                "total": len(processed_services),
                "no_tasks": no_tasks_count,
                "updates_available": updates_available_count,
                "up_to_date": up_to_date_count,
                "latest_tag_services": latest_tag_services_count,
                "latest_tag_updates": latest_tag_updates_count
            }
        }
        
    except Exception as e:
        return {"error": f"Failed to get cluster overview: {str(e)}"}

@app.post("/log-target")
def get_log_target_post(request: LogTargetRequest):
    """Get log target for a service (POST version)"""
    return get_log_target_impl(
        request.cluster, request.service, request.profile, request.region, request.auth_method,
        request.aws_access_key_id, request.aws_secret_access_key, request.aws_session_token
    )

@app.get("/log-target")
def get_log_target(cluster: str, service: str, profile: Optional[str] = None, region: str = "us-east-1", auth_method: str = "access_key", aws_access_key_id: Optional[str] = None, aws_secret_access_key: Optional[str] = None, aws_session_token: Optional[str] = None):
    """Get log target for a service (GET version for backward compatibility)"""
    return get_log_target_impl(cluster, service, profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)

def get_log_target_impl(cluster: str, service: str, profile: Optional[str] = None, region: str = "us-east-1", auth_method: str = "access_key", aws_access_key_id: Optional[str] = None, aws_secret_access_key: Optional[str] = None, aws_session_token: Optional[str] = None):
    """Get CloudWatch log group and stream for a service"""
    try:
        session = get_boto3_session(profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)
        ecs = session.client("ecs", config=BOTO3_CONFIG)
        logs = session.client("logs", config=BOTO3_CONFIG)
        
        # Get service details
        services_response = ecs.describe_services(cluster=cluster, services=[service])
        if not services_response.get("services"):
            return {"error": "Service not found"}
        
        service_info = services_response["services"][0]
        service_name = service_info.get("serviceName")
        
        # Get running tasks
        tasks_response = ecs.list_tasks(cluster=cluster, serviceName=service)
        if not tasks_response.get("taskArns"):
            return {"error": "No tasks found for this service"}
        
        # Get task details
        tasks_details = ecs.describe_tasks(cluster=cluster, tasks=tasks_response["taskArns"][:1])  # Get first task
        if not tasks_details.get("tasks"):
            return {"error": "No task details found"}
        
        task = tasks_details["tasks"][0]
        task_definition_arn = task.get("taskDefinitionArn")
        
        if not task_definition_arn:
            return {"error": "No task definition found for tasks"}
        
        # Get task definition
        td_response = ecs.describe_task_definition(taskDefinition=task_definition_arn)
        task_definition = td_response.get("taskDefinition", {})
        
        # Find log configuration
        log_group = None
        log_stream_prefix = None
        
        for container in task_definition.get("containerDefinitions", []):
            log_config = container.get("logConfiguration", {})
            if log_config.get("logDriver") == "awslogs":
                options = log_config.get("options", {})
                log_group = options.get("awslogs-group")
                log_stream_prefix = options.get("awslogs-stream-prefix", "ecs")
                break
        
        if not log_group:
            return {"error": "No CloudWatch logs configured for this service"}
        
        # Find the most recent log stream
        try:
            streams_response = logs.describe_log_streams(
                logGroupName=log_group,
                orderBy="LastEventTime",
                descending=True,
                limit=1
            )
            
            if not streams_response.get("logStreams"):
                return {"error": "No log streams found"}
            
            log_stream = streams_response["logStreams"][0]["logStreamName"]
            
            return {
                "log_group": log_group,
                "log_stream": log_stream
            }
            
        except Exception as e:
            return {"error": f"Failed to get log stream: {str(e)}"}
            
    except Exception as e:
        return {"error": f"Failed to get log target: {str(e)}"}

@app.websocket("/ws/logs")
async def websocket_logs(websocket: WebSocket):
    """WebSocket endpoint for streaming CloudWatch logs"""
    await websocket.accept()
    
    try:
        # Get parameters from query string
        query_params = websocket.query_params
        log_group = query_params.get("log_group")
        log_stream = query_params.get("log_stream")
        profile = query_params.get("profile", None)
        region = query_params.get("region", "us-east-1")
        auth_method = query_params.get("auth_method", "access_key")
        aws_access_key_id = query_params.get("aws_access_key_id")
        aws_secret_access_key = query_params.get("aws_secret_access_key")
        aws_session_token = query_params.get("aws_session_token")
        interval = int(query_params.get("interval", 3))
        start_time = query_params.get("start_time")  # ISO format timestamp
        end_time = query_params.get("end_time")  # ISO format timestamp
        
        if not log_group or not log_stream:
            await websocket.send_text(json.dumps({"error": "Missing log_group or log_stream parameter"}))
            await websocket.close()
            return
        
        # Create CloudWatch logs client with provided auth method (profile or access_key)
        session = get_boto3_session(
            profile,
            region,
            auth_method,
            aws_access_key_id,
            aws_secret_access_key,
            aws_session_token,
        )
        logs = session.client("logs", config=BOTO3_CONFIG)
        
        # Get initial logs
        try:
            response = logs.get_log_events(
                logGroupName=log_group,
                logStreamName=log_stream,
                startFromHead=False,
                limit=50
            )
            
            for event in response.get("events", []):
                message = event.get("message", "")
                timestamp = event.get("timestamp", 0)
                await websocket.send_text(json.dumps({
                    "message": message,
                    "timestamp": timestamp
                }))
                
        except Exception as e:
            await websocket.send_text(json.dumps({"error": f"Failed to get initial logs: {str(e)}"}))
        
        # Stream new logs
        last_token = None
        while True:
            try:
                # Get new log events
                params = {
                    "logGroupName": log_group,
                    "logStreamName": log_stream,
                    "startFromHead": False,
                    "limit": 10
                }
                # Only add nextToken if it's not None
                if last_token is not None:
                    params["nextToken"] = last_token
                
                response = logs.get_log_events(**params)
                
                events = response.get("events", [])
                
                if events:
                    last_token = response.get("nextForwardToken")
                    
                    for event in events:
                        message = event.get("message", "")
                        timestamp = event.get("timestamp", 0)
                        await websocket.send_text(json.dumps({
                            "message": message,
                            "timestamp": timestamp
                        }))
                
                await asyncio.sleep(interval)
                
            except WebSocketDisconnect:
                break
            except Exception as e:
                await websocket.send_text(json.dumps({"error": f"Failed to stream logs: {str(e)}"}))
                break
                
    except Exception as e:
        await websocket.send_text(json.dumps({"error": f"WebSocket error: {str(e)}"}))
    finally:
        await websocket.close()

@app.post("/historical_logs")
def get_historical_logs_post(request: HistoricalLogsRequest):
    """Get historical CloudWatch logs (POST version)"""
    return get_historical_logs_impl(
        request.cluster, request.service, request.start_time, request.end_time,
        request.limit, request.profile, request.region, request.auth_method,
        request.aws_access_key_id, request.aws_secret_access_key, request.aws_session_token
    )

@app.get("/historical_logs")
def get_historical_logs(
    cluster: str,
    service: str,
    start_time: str = None,  # ISO format: 2025-01-09T10:00:00Z
    end_time: str = None,    # ISO format: 2025-01-09T11:00:00Z
    limit: int = 1000,
    profile: Optional[str] = None,
    region: str = "us-east-1",
    auth_method: str = "access_key",
    aws_access_key_id: Optional[str] = None,
    aws_secret_access_key: Optional[str] = None,
    aws_session_token: Optional[str] = None
):
    """Get historical CloudWatch logs (GET version for backward compatibility)"""
    return get_historical_logs_impl(
        cluster, service, start_time, end_time, limit, profile, region, auth_method,
        aws_access_key_id, aws_secret_access_key, aws_session_token
    )

def get_historical_logs_impl(
    cluster: str,
    service: str,
    start_time: str = None,  # ISO format: 2025-01-09T10:00:00Z
    end_time: str = None,    # ISO format: 2025-01-09T11:00:00Z
    limit: int = 1000,
    profile: Optional[str] = None,
    region: str = "us-east-1",
    auth_method: str = "access_key",
    aws_access_key_id: Optional[str] = None,
    aws_secret_access_key: Optional[str] = None,
    aws_session_token: Optional[str] = None
):
    """Get historical CloudWatch logs using CloudWatch Insights (like ECS Console)"""
    try:
        session = get_boto3_session(profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)
        logs = session.client("logs", config=BOTO3_CONFIG)
        ecs = session.client("ecs", config=BOTO3_CONFIG)
        
        # First, get the log group from the ECS service (like ECS Console does)
        try:
            # Get service details to find task definition
            svc_response = ecs.describe_services(cluster=cluster, services=[service])
            if not svc_response["services"]:
                raise HTTPException(status_code=404, detail="Service not found")
            
            service_info = svc_response["services"][0]
            current_td_arn = service_info.get("taskDefinition")
            
            if not current_td_arn:
                raise HTTPException(status_code=404, detail="No task definition found for service")
            
            # Get task definition to find log configuration
            td_response = ecs.describe_task_definition(taskDefinition=current_td_arn)
            task_definition = td_response.get("taskDefinition", {})
            
            # Find the log group from container definitions
            log_group = None
            for container in task_definition.get("containerDefinitions", []):
                log_config = container.get("logConfiguration")
                if log_config and log_config.get("logDriver") == "awslogs":
                    log_group = log_config.get("options", {}).get("awslogs-group")
                    if log_group:
                        break
            
            if not log_group:
                raise HTTPException(status_code=404, detail="No CloudWatch logs configured for this service")
            
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to get service log configuration: {str(e)}")
        
        # Convert ISO timestamps to CloudWatch Insights format (milliseconds)
        start_timestamp = None
        end_timestamp = None
        
        try:
            if start_time:
                if start_time.endswith('Z'):
                    start_time = start_time.replace('Z', '+00:00')
                # Convert to milliseconds (CloudWatch Insights requires milliseconds)
                start_timestamp = int(datetime.fromisoformat(start_time).timestamp() * 1000)
            if end_time:
                if end_time.endswith('Z'):
                    end_time = end_time.replace('Z', '+00:00')
                # Convert to milliseconds (CloudWatch Insights requires milliseconds)
                end_timestamp = int(datetime.fromisoformat(end_time).timestamp() * 1000)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"Invalid timestamp format: {str(e)}")
        
        # If no time range specified, default to last 1 hour
        if not start_timestamp and not end_timestamp:
            end_timestamp = int(datetime.now().timestamp() * 1000)  # milliseconds
            start_timestamp = end_timestamp - (3600 * 1000)  # 1 hour ago in milliseconds
        elif not start_timestamp:
            start_timestamp = end_timestamp - (3600 * 1000)  # 1 hour before end time
        elif not end_timestamp:
            end_timestamp = start_timestamp + (3600 * 1000)  # 1 hour after start time
        
        print(f"DEBUG: Query time range (ms): {start_timestamp} to {end_timestamp}")
        print(f"DEBUG: Query time range (human): {datetime.fromtimestamp(start_timestamp/1000)} to {datetime.fromtimestamp(end_timestamp/1000)}")
        print(f"DEBUG: Log group: {log_group}")
        
        # Use CloudWatch Insights to query logs (like ECS Console does)
        # This automatically handles multiple log streams and provides unified results
        query_string = """
        fields @timestamp, @message
        | filter @message != ""
        | sort @timestamp desc
        | limit 1000
        """
        
        try:
            # Try CloudWatch Insights first
            start_query_params = {
                "logGroupName": log_group,
                "startTime": start_timestamp,
                "endTime": end_timestamp,
                "queryString": query_string
            }
            
            print(f"DEBUG: Starting CloudWatch Insights query with params: {start_query_params}")
            query_response = logs.start_query(**start_query_params)
            query_id = query_response["queryId"]
            
            # Wait for query to complete and get results
            max_attempts = 10  # 10 seconds timeout
            attempt = 0
            
            while attempt < max_attempts:
                results_response = logs.get_query_results(queryId=query_id)
                status = results_response["status"]
                
                if status == "Complete":
                    break
                elif status == "Failed":
                    print(f"DEBUG: CloudWatch Insights query failed, falling back to log streams")
                    raise Exception("CloudWatch Insights query failed")
                
                time.sleep(1)
                attempt += 1
            
            if attempt >= max_attempts:
                print(f"DEBUG: CloudWatch Insights query timeout, falling back to log streams")
                raise Exception("CloudWatch Insights query timeout")
            
            # Process CloudWatch Insights results
            results = results_response.get("results", [])
            formatted_logs = []
            
            print(f"DEBUG: CloudWatch Insights query status: {status}, results count: {len(results)}")
            
            for result in results:
                # CloudWatch Insights returns results as array of field objects
                # Each field has a 'field' name and 'value'
                timestamp_value = None
                message_value = None
                
                for field in result:
                    field_name = field.get("field", "")
                    field_value = field.get("value", "")
                    
                    if field_name == "@timestamp":
                        timestamp_value = field_value
                    elif field_name == "@message":
                        message_value = field_value
                
                if message_value:
                    # Parse timestamp if available
                    timestamp_ms = 0
                    if timestamp_value:
                        try:
                            # CloudWatch Insights returns timestamp as ISO string or epoch
                            if isinstance(timestamp_value, (int, float)):
                                timestamp_ms = int(timestamp_value)
                            else:
                                # Try parsing as ISO string
                                dt = datetime.fromisoformat(timestamp_value.replace('Z', '+00:00'))
                                timestamp_ms = int(dt.timestamp() * 1000)
                        except:
                            pass
                    
                    formatted_time = timestamp_value.split('.')[0] if timestamp_value and '.' in timestamp_value else timestamp_value
                    formatted_logs.append({
                        "message": message_value,
                        "timestamp": timestamp_ms,
                        "formatted_time": formatted_time or datetime.fromtimestamp(timestamp_ms/1000).strftime('%Y-%m-%d %H:%M:%S') if timestamp_ms else ""
                    })
            
            print(f"DEBUG: CloudWatch Insights returned {len(formatted_logs)} logs")
            return {
                "logs": formatted_logs,
                "total": len(formatted_logs),
                "log_group": log_group,
                "query_id": query_id,
                "method": "cloudwatch_insights"
            }
            
        except Exception as insights_error:
            print(f"DEBUG: CloudWatch Insights failed: {insights_error}")
            print(f"DEBUG: Error type: {type(insights_error).__name__}")
            import traceback
            print(f"DEBUG: Traceback: {traceback.format_exc()}")
            print(f"DEBUG: Falling back to log streams method")
            
            # Fallback to log streams method
            try:
                # Get recent log streams
                streams_response = logs.describe_log_streams(
                    logGroupName=log_group,
                    orderBy="LastEventTime",
                    descending=True,
                    limit=10  # Increased from 5 to get more streams
                )
                
                print(f"DEBUG: Found {len(streams_response.get('logStreams', []))} log streams")
                
                all_logs = []
                
                for stream in streams_response.get("logStreams", []):
                    stream_name = stream["logStreamName"]
                    last_event_time = stream.get("lastEventTimestamp", 0)
                    first_event_time = stream.get("firstEventTimestamp", 0)
                    
                    # Check if stream has any events in our time range
                    # Stream has events in range if: last_event >= start_time OR first_event <= end_time
                    if last_event_time < start_timestamp and first_event_time > end_timestamp:
                        print(f"DEBUG: Skipping stream {stream_name} - no events in time range (first: {first_event_time}, last: {last_event_time}, range: {start_timestamp} to {end_timestamp})")
                        continue
                    
                    print(f"DEBUG: Querying log stream: {stream_name} (first: {first_event_time}, last: {last_event_time}, range: {start_timestamp} to {end_timestamp})")
                    
                    # Determine if we should start from head based on time range
                    # If the time range is closer to the first event, start from head
                    time_range_span = end_timestamp - start_timestamp
                    mid_point = start_timestamp + (time_range_span / 2)
                    start_from_head = (mid_point - first_event_time) < (last_event_time - mid_point)
                    
                    # Get logs from this stream - try with time range parameters first
                    try:
                        events_response = logs.get_log_events(
                            logGroupName=log_group,
                            logStreamName=stream_name,
                            startTime=start_timestamp,
                            endTime=end_timestamp,
                            startFromHead=start_from_head,
                            limit=1000
                        )
                    except Exception as e:
                        # If startTime/endTime not supported or fails, get all and filter
                        print(f"DEBUG: get_log_events with time range failed, getting all events: {e}")
                        events_response = logs.get_log_events(
                            logGroupName=log_group,
                            logStreamName=stream_name,
                            startFromHead=start_from_head,
                            limit=1000
                        )
                    
                    stream_logs = events_response.get("events", [])
                    print(f"DEBUG: Stream {stream_name} returned {len(stream_logs)} events (before filtering)")
                    
                    # Filter events by time range (in case API didn't filter properly)
                    filtered_events = []
                    for event in stream_logs:
                        message = event.get("message", "")
                        timestamp = event.get("timestamp", 0)
                        
                        # Filter by time range
                        if timestamp < start_timestamp or timestamp > end_timestamp:
                            continue
                        
                        if message:
                            # Convert timestamp to readable format
                            formatted_time = datetime.fromtimestamp(timestamp / 1000).strftime('%Y-%m-%d %H:%M:%S')
                            
                            filtered_events.append({
                                "message": message,
                                "timestamp": timestamp,
                                "formatted_time": formatted_time
                            })
                    
                    print(f"DEBUG: Stream {stream_name} has {len(filtered_events)} events after time range filtering")
                    all_logs.extend(filtered_events)
                
                # Sort by timestamp descending
                all_logs.sort(key=lambda x: x["timestamp"], reverse=True)
                
                # Limit to requested number
                all_logs = all_logs[:limit]
                
                print(f"DEBUG: Log streams method returned {len(all_logs)} logs (after limit)")
                return {
                    "logs": all_logs,
                    "total": len(all_logs),
                    "log_group": log_group,
                    "method": "log_streams"
                }
                
            except Exception as stream_error:
                print(f"DEBUG: Log streams method also failed: {stream_error}")
                raise HTTPException(status_code=500, detail=f"Both CloudWatch Insights and log streams failed: {str(stream_error)}")
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get historical logs: {str(e)}")

@app.post("/deployment_history")
def get_deployment_history_post(request: DeploymentHistoryRequest):
    """Get deployment history with optional filtering and status updates (POST version)"""
    return get_deployment_history_impl(
        request.cluster, request.service, request.limit, request.profile, 
        request.region, request.auth_method, request.aws_access_key_id, 
        request.aws_secret_access_key, request.aws_session_token
    )

@app.get("/deployment_history")
def get_deployment_history(cluster: str = None, service: str = None, limit: int = 50, profile: Optional[str] = None, region: str = "us-east-1", auth_method: str = "access_key", aws_access_key_id: Optional[str] = None, aws_secret_access_key: Optional[str] = None, aws_session_token: Optional[str] = None):
    """Get deployment history with optional filtering and status updates (GET version for backward compatibility)"""
    return get_deployment_history_impl(cluster, service, limit, profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)

def get_deployment_history_impl(cluster: str = None, service: str = None, limit: int = 50, profile: Optional[str] = None, region: str = "us-east-1", auth_method: str = "access_key", aws_access_key_id: Optional[str] = None, aws_secret_access_key: Optional[str] = None, aws_session_token: Optional[str] = None):
    """Get deployment history with optional filtering and status updates"""
    try:
        filtered_history = deployment_history.copy()
        
        # Filter by cluster if provided
        if cluster:
            filtered_history = [d for d in filtered_history if d.get("cluster") == cluster]
        
        # Filter by service if provided
        if service:
            filtered_history = [d for d in filtered_history if d.get("service") == service]
        
        # Update status for all non-terminal deployments (up to 100 to avoid performance issues)
        non_terminal_deployments = [d for d in filtered_history if d.get("status") in ["IN_PROGRESS", "PENDING", "UNKNOWN"]]
        # Limit to first 100 non-terminal deployments to avoid overwhelming the system
        deployments_to_update = non_terminal_deployments[:100]
        for deployment in deployments_to_update:
            update_deployment_status(deployment["deployment_id"], profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)
        
        # Limit results
        filtered_history = filtered_history[:limit]
        
        return {
            "deployments": filtered_history,
            "total": len(filtered_history)
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get deployment history: {str(e)}")

@app.post("/deployment_history/{deployment_id}/refresh")
def refresh_deployment_status(deployment_id: str, request: Optional[RefreshDeploymentRequest] = Body(None), profile: Optional[str] = None, region: str = "us-east-1", auth_method: str = "access_key", aws_access_key_id: Optional[str] = None, aws_secret_access_key: Optional[str] = None, aws_session_token: Optional[str] = None):
    """Refresh status for a specific deployment"""
    # Support both POST body and query params for backward compatibility
    if request:
        profile = request.profile
        region = request.region
        auth_method = request.auth_method
        aws_access_key_id = request.aws_access_key_id
        aws_secret_access_key = request.aws_secret_access_key
        aws_session_token = request.aws_session_token
    try:
        update_deployment_status(deployment_id, profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)
        
        # Find and return the updated deployment
        deployment = next((d for d in deployment_history if d.get("deployment_id") == deployment_id), None)
        
        if not deployment:
            raise HTTPException(status_code=404, detail="Deployment not found")
        
        return deployment
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to refresh deployment status: {str(e)}")

@app.get("/deployment_history/{deployment_id}")
def get_deployment_details(deployment_id: str):
    """Get details for a specific deployment"""
    try:
        deployment = next((d for d in deployment_history if d.get("deployment_id") == deployment_id), None)
        
        if not deployment:
            raise HTTPException(status_code=404, detail="Deployment not found")
        
        return deployment
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get deployment details: {str(e)}")

@app.post("/rollback/{deployment_id}")
def rollback_deployment(deployment_id: str, request: Optional[RollbackRequest] = Body(None), profile: Optional[str] = None, region: str = "us-east-1", auth_method: str = "access_key", aws_access_key_id: Optional[str] = None, aws_secret_access_key: Optional[str] = None, aws_session_token: Optional[str] = None):
    """Rollback to a previous deployment"""
    # Support both POST body and query params for backward compatibility
    if request:
        profile = request.profile
        region = request.region
        auth_method = request.auth_method
        aws_access_key_id = request.aws_access_key_id
        aws_secret_access_key = request.aws_secret_access_key
        aws_session_token = request.aws_session_token
    try:
        # Find the deployment to rollback to
        target_deployment = next((d for d in deployment_history if d.get("deployment_id") == deployment_id), None)
        
        if not target_deployment:
            raise HTTPException(status_code=404, detail="Deployment not found")
        
        cluster = target_deployment.get("cluster")
        service = target_deployment.get("service")
        
        if not cluster or not service:
            raise HTTPException(status_code=400, detail="Invalid deployment data")
        
        session = get_boto3_session(profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)
        ecs = session.client("ecs", config=BOTO3_CONFIG)
        
        # Get current service to find the task definition to rollback to
        svc_response = ecs.describe_services(cluster=cluster, services=[service])
        if not svc_response["services"]:
            raise HTTPException(status_code=404, detail="Service not found")
        
        current_td_arn = svc_response["services"][0].get("taskDefinition")
        
        # For rollback, we need to find the previous task definition
        # This is a simplified rollback - in production you'd want to track task definition history
        td_response = ecs.describe_task_definition(taskDefinition=current_td_arn)
        current_td = td_response.get("taskDefinition", {})
        
        # Get task definition revisions to find the previous one
        family = current_td.get("family")
        if not family:
            raise HTTPException(status_code=400, detail="Could not determine task definition family")
        
        revisions_response = ecs.list_task_definitions(
            familyPrefix=family,
            status="ACTIVE",
            sort="DESC",
            maxItems=10
        )
        
        task_definitions = revisions_response.get("taskDefinitionArns", [])
        if len(task_definitions) < 2:
            raise HTTPException(status_code=400, detail="No previous version available for rollback")
        
        # Use the second most recent task definition (previous version)
        rollback_td_arn = task_definitions[1]
        
        # Update service to use the previous task definition
        update_response = ecs.update_service(
            cluster=cluster,
            service=service,
            taskDefinition=rollback_td_arn
        )
        
        # Create rollback deployment record
        rollback_data = {
            "cluster": cluster,
            "service": service,
            "message": f"Rollback to deployment {deployment_id}",
            "deployment_type": "rollback",
            "new_task_definition": rollback_td_arn,
            "service_arn": update_response["service"]["serviceArn"],
            "deployment_id": f"rollback-{cluster}-{service}-{int(time.time())}",
            "original_deployment_id": deployment_id
        }
        
        # Save rollback to deployment history
        save_deployment_history(rollback_data)
        
        return {
            "message": "Rollback started successfully",
            "deployment_id": rollback_data["deployment_id"],
            "service_arn": update_response["service"]["serviceArn"],
            "rollback_to": rollback_td_arn,
            "original_deployment_id": deployment_id
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Rollback failed: {str(e)}")

@app.post("/service_image_info")
def get_service_image_info_post(request: ServiceImageInfoRequest):
    """Get current and latest image information for a service (POST version)"""
    return get_service_image_info_impl(
        request.cluster, request.service, request.profile, request.region, 
        request.auth_method, request.aws_access_key_id, 
        request.aws_secret_access_key, request.aws_session_token
    )

@app.get("/service_image_info")
def get_service_image_info(cluster: str, service: str, profile: Optional[str] = None, region: str = "us-east-1", auth_method: str = "access_key", aws_access_key_id: Optional[str] = None, aws_secret_access_key: Optional[str] = None, aws_session_token: Optional[str] = None):
    """Get current and latest image information for a service (GET version for backward compatibility)"""
    return get_service_image_info_impl(cluster, service, profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)

def get_service_image_info_impl(cluster: str, service: str, profile: Optional[str] = None, region: str = "us-east-1", auth_method: str = "access_key", aws_access_key_id: Optional[str] = None, aws_secret_access_key: Optional[str] = None, aws_session_token: Optional[str] = None):
    """Get current and latest image information for a service"""
    try:
        session = get_boto3_session(profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)
        ecs = session.client("ecs", config=BOTO3_CONFIG)
        # ECR client will be created dynamically based on image region
        
        # Get service details
        svc_response = ecs.describe_services(cluster=cluster, services=[service])
        if not svc_response["services"]:
            raise HTTPException(status_code=404, detail="Service not found")
        
        service_info = svc_response["services"][0]
        current_td_arn = service_info.get("taskDefinition")
        
        if not current_td_arn:
            raise HTTPException(status_code=404, detail="No task definition found for service")
        
        # Get current task definition
        td_response = ecs.describe_task_definition(taskDefinition=current_td_arn)
        current_td = td_response.get("taskDefinition", {})
        
        container_image_info = []
        
        for container in current_td.get("containerDefinitions", []):
            container_name = container.get("name")
            current_image_uri = container.get("image", "")
            
            # Skip non-ECR images
            if not (current_image_uri and ".dkr.ecr." in current_image_uri):
                container_image_info.append({
                    "container_name": container_name,
                    "current_image": current_image_uri,
                    "latest_image": current_image_uri,
                    "has_updates": False,
                    "uses_latest_tag": False
                })
                continue
            
            try:
                # Extract ECR region, account, and repository name from image URI
                ecr_region, account_id, repo_name = extract_ecr_info(current_image_uri)
                if not ecr_region or not repo_name:
                    continue
                
                # Create ECR client for the correct region
                ecr = session.client("ecr", region_name=ecr_region, config=BOTO3_CONFIG)
                
                current_tag = current_image_uri.split(":")[-1]
                
                resp = ecr.describe_images(repositoryName=repo_name, filter={"tagStatus": "TAGGED"})
                images_info = resp.get("imageDetails", [])
                
                if images_info:
                    # Sort by push time to get most recent
                    images_info.sort(key=lambda x: x.get("imagePushedAt", 0), reverse=True)
                    
                    has_updates = False
                    latest_image_uri = current_image_uri
                    uses_latest_tag = (current_tag == "latest")
                    
                    # Check if current tag is "latest"
                    if current_tag == "latest":
                        # For "latest" tag, compare image digests instead of tags
                        current_digest = None
                        latest_digest = None
                        
                        # Find current image digest
                        for img in images_info:
                            if "latest" in img.get("imageTags", []):
                                current_digest = img.get("imageDigest")
                                break
                        
                        # Get latest pushed image digest
                        if images_info:
                            latest_digest = images_info[0].get("imageDigest")
                        
                        # Compare digests to detect updates
                        if current_digest and latest_digest:
                            has_updates = current_digest != latest_digest
                            # Get the latest image URI with "latest" tag
                            base_uri = current_image_uri.split(":")[0]
                            latest_image_uri = f"{base_uri}:latest"
                        else:
                            has_updates = False
                            latest_image_uri = current_image_uri
                    else:
                        # For versioned tags, use existing logic
                        latest_image = images_info[0]
                        latest_tags = latest_image.get("imageTags", [])
                        
                        if latest_tags:
                            latest_tag = latest_tags[0]
                            base_uri = current_image_uri.split(":")[0]
                            latest_image_uri = f"{base_uri}:{latest_tag}"
                            has_updates = current_image_uri != latest_image_uri
                        else:
                            has_updates = False
                            latest_image_uri = current_image_uri
                    
                    container_image_info.append({
                        "container_name": container_name,
                        "current_image": current_image_uri,
                        "latest_image": latest_image_uri,
                        "has_updates": has_updates,
                        "uses_latest_tag": uses_latest_tag
                    })
                else:
                    container_image_info.append({
                        "container_name": container_name,
                        "current_image": current_image_uri,
                        "latest_image": current_image_uri,
                        "has_updates": False,
                        "uses_latest_tag": (current_tag == "latest")
                    })
            except Exception as e:
                # If we can't get latest image info, just use current
                container_image_info.append({
                    "container_name": container_name,
                    "current_image": current_image_uri,
                    "latest_image": current_image_uri,
                    "has_updates": False,
                    "uses_latest_tag": (current_image_uri.split(":")[-1] == "latest"),
                    "error": str(e)
                })
        
        return {
            "service": service,
            "cluster": cluster,
            "task_definition_arn": current_td_arn,
            "container_image_info": container_image_info,
            "has_any_updates": any(ci.get("has_updates", False) for ci in container_image_info)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get service image info: {str(e)}")

@app.post("/task_definition")
def get_task_definition_post(request: TaskDefinitionRequest):
    """Get current task definition for a service (POST version)"""
    return get_task_definition_impl(
        request.cluster, request.service, request.profile, request.region, 
        request.auth_method, request.aws_access_key_id, 
        request.aws_secret_access_key, request.aws_session_token
    )

@app.get("/task_definition")
def get_task_definition(cluster: str, service: str, profile: Optional[str] = None, region: str = "us-east-1", auth_method: str = "access_key", aws_access_key_id: Optional[str] = None, aws_secret_access_key: Optional[str] = None, aws_session_token: Optional[str] = None):
    """Get current task definition for a service (GET version for backward compatibility)"""
    return get_task_definition_impl(cluster, service, profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)

def get_task_definition_impl(cluster: str, service: str, profile: Optional[str] = None, region: str = "us-east-1", auth_method: str = "access_key", aws_access_key_id: Optional[str] = None, aws_secret_access_key: Optional[str] = None, aws_session_token: Optional[str] = None):
    """Get current task definition for a service"""
    try:
        session = get_boto3_session(profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)
        ecs = session.client("ecs", config=BOTO3_CONFIG)
        
        # Get service details to find current task definition
        svc_response = ecs.describe_services(cluster=cluster, services=[service])
        if not svc_response["services"]:
            raise HTTPException(status_code=404, detail="Service not found")
        
        service_info = svc_response["services"][0]
        current_td_arn = service_info.get("taskDefinition")
        
        if not current_td_arn:
            raise HTTPException(status_code=404, detail="No task definition found for service")
        
        # Get task definition details
        td_response = ecs.describe_task_definition(taskDefinition=current_td_arn)
        task_definition = td_response.get("taskDefinition", {})
        
        # Format response with relevant information
        return {
            "task_definition_arn": current_td_arn,
            "family": task_definition.get("family"),
            "revision": task_definition.get("revision"),
            "cpu": task_definition.get("cpu"),
            "memory": task_definition.get("memory"),
            "network_mode": task_definition.get("networkMode"),
            "requires_compatibilities": task_definition.get("requiresCompatibilities", []),
            "execution_role_arn": task_definition.get("executionRoleArn"),
            "task_role_arn": task_definition.get("taskRoleArn"),
            "container_definitions": [
                {
                    "name": c.get("name"),
                    "image": c.get("image"),
                    "cpu": c.get("cpu"),
                    "memory": c.get("memory"),
                    "memory_reservation": c.get("memoryReservation"),
                    "environment": c.get("environment", []),
                    "secrets": c.get("secrets", []),
                    "port_mappings": c.get("portMappings", []),
                    "log_configuration": c.get("logConfiguration"),
                    "essential": c.get("essential", True),
                    "command": c.get("command", []),
                    "entry_point": c.get("entryPoint", [])
                }
                for c in task_definition.get("containerDefinitions", [])
            ],
            "volumes": task_definition.get("volumes", []),
            "placement_constraints": task_definition.get("placementConstraints", []),
            "tags": task_definition.get("tags", [])
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get task definition: {str(e)}")

@app.post("/task_definition/update")
def update_task_definition(data: TaskDefinitionUpdate):
    """Update task definition with new settings and deploy"""
    try:
        session = get_boto3_session(data.profile, data.region, data.auth_method, data.aws_access_key_id, data.aws_secret_access_key, data.aws_session_token)
        ecs = session.client("ecs", config=BOTO3_CONFIG)
        
        # Get current service and task definition
        svc_response = ecs.describe_services(cluster=data.cluster, services=[data.service])
        if not svc_response["services"]:
            raise HTTPException(status_code=404, detail="Service not found")
        
        service_info = svc_response["services"][0]
        current_td_arn = service_info.get("taskDefinition")
        
        if not current_td_arn:
            raise HTTPException(status_code=404, detail="No task definition found for service")
        
        # Get current task definition
        td_response = ecs.describe_task_definition(taskDefinition=current_td_arn)
        current_td = td_response.get("taskDefinition", {})
        
        # Create new task definition with updates
        new_td = current_td.copy()
        
        # Update task-level CPU and memory if provided, or remove if null
        # Check if cpu field was explicitly provided in the request
        if hasattr(data, 'cpu') and 'cpu' in data.__dict__:
            if data.cpu:
                new_td["cpu"] = data.cpu
            else:
                # Remove cpu if explicitly set to empty/null
                if "cpu" in new_td:
                    del new_td["cpu"]
        
        # Check if memory field was explicitly provided in the request
        if hasattr(data, 'memory') and 'memory' in data.__dict__:
            if data.memory:
                new_td["memory"] = data.memory
            else:
                # Remove memory if explicitly set to empty/null
                if "memory" in new_td:
                    del new_td["memory"]
        
        # Update container definitions
        if data.container_updates:
            container_updates_map = {cu.container_name: cu for cu in data.container_updates}
            
            updated_containers = []
            for container in new_td.get("containerDefinitions", []):
                container_name = container.get("name")
                updated_container = container.copy()
                
                if container_name in container_updates_map:
                    update = container_updates_map[container_name]
                    
                    # Update CPU
                    if update.cpu is not None:
                        if update.cpu:
                            updated_container["cpu"] = update.cpu
                        else:
                            # Remove cpu if explicitly set to empty/null
                            if "cpu" in updated_container:
                                del updated_container["cpu"]
                    
                    # Update memory reservation (not memory limit for containers)
                    if update.memory is not None:
                        if update.memory:
                            updated_container["memoryReservation"] = update.memory
                            # Remove memory limit if it exists (containers should use memoryReservation)
                            if "memory" in updated_container:
                                del updated_container["memory"]
                        else:
                            # Remove memoryReservation if explicitly set to empty/null
                            if "memoryReservation" in updated_container:
                                del updated_container["memoryReservation"]
                            if "memory" in updated_container:
                                del updated_container["memory"]
                    
                    # Update image
                    if update.image is not None:
                        updated_container["image"] = update.image
                    
                    # Update environment variables
                    if update.environment_variables:
                        # Merge with existing environment variables
                        existing_env = {env["name"]: env["value"] for env in updated_container.get("environment", [])}
                        existing_env.update(update.environment_variables)
                        updated_container["environment"] = [
                            {"name": name, "value": value} for name, value in existing_env.items()
                        ]
                    
                    # Update secrets
                    if update.secrets:
                        # Merge with existing secrets
                        existing_secrets = {secret["name"]: secret["valueFrom"] for secret in updated_container.get("secrets", [])}
                        existing_secrets.update(update.secrets)
                        updated_container["secrets"] = [
                            {"name": name, "valueFrom": value} for name, value in existing_secrets.items()
                        ]
                
                updated_containers.append(updated_container)
            
            new_td["containerDefinitions"] = updated_containers
        
        # Register new task definition
        register_args = {
            "family": new_td["family"],
            "containerDefinitions": new_td["containerDefinitions"],
            "cpu": new_td.get("cpu"),
            "memory": new_td.get("memory"),
            "networkMode": new_td.get("networkMode"),
            "requiresCompatibilities": new_td.get("requiresCompatibilities"),
            "executionRoleArn": new_td.get("executionRoleArn"),
            "taskRoleArn": new_td.get("taskRoleArn"),
            "volumes": new_td.get("volumes", []),
            "placementConstraints": new_td.get("placementConstraints", []),
            "proxyConfiguration": new_td.get("proxyConfiguration"),
            "inferenceAccelerators": new_td.get("inferenceAccelerators", []),
            "ephemeralStorage": new_td.get("ephemeralStorage"),
        }
        
        # Add tags if they exist
        tags = new_td.get("tags", [])
        if tags:
            register_args["tags"] = tags
        
        # Remove None values
        register_args = {k: v for k, v in register_args.items() if v is not None}
        
        # Register the new task definition
        new_td_response = ecs.register_task_definition(**register_args)
        new_td_arn = new_td_response["taskDefinition"]["taskDefinitionArn"]
        
        # Update service with new task definition
        update_response = ecs.update_service(
            cluster=data.cluster,
            service=data.service,
            taskDefinition=new_td_arn
        )
        
        # Create deployment record
        deployment_data = {
            "cluster": data.cluster,
            "service": data.service,
            "message": "Task definition updated successfully",
            "deployment_type": "task_definition_update",
            "new_task_definition": new_td_arn,
            "service_arn": update_response["service"]["serviceArn"],
            "deployment_id": f"td-update-{data.cluster}-{data.service}-{int(time.time())}",
            "changes": {
                "cpu": data.cpu,
                "memory": data.memory,
                "container_updates": [cu.dict() for cu in data.container_updates]
            }
        }
        
        # Save to deployment history
        save_deployment_history(deployment_data)
        
        return {
            "message": "Task definition updated and deployment started successfully",
            "new_task_definition_arn": new_td_arn,
            "service_arn": update_response["service"]["serviceArn"],
            "deployment_id": deployment_data["deployment_id"]
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update task definition: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
