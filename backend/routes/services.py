"""Service-related routes."""

from typing import Optional
from fastapi import APIRouter, HTTPException
from models.schemas import (
    ServicesRequest,
    ServiceEventsRequest,
    ServiceImageInfoRequest,
    UpdateTaskCountRequest,
    ForceNewDeploymentRequest,
)
from utils.aws import get_boto3_session
from utils.ecr import extract_ecr_info, unified_image_comparison
from services.deployment_history import save_deployment_history
from config.settings import BOTO3_CONFIG
import time

router = APIRouter()


def _list_services_impl(
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


@router.post("/services")
def list_services_post(request: ServicesRequest):
    """List ECS services (POST version)"""
    return _list_services_impl(
        request.cluster, request.profile, request.region, request.auth_method,
        request.aws_access_key_id, request.aws_secret_access_key, request.aws_session_token
    )


@router.get("/services")
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
    return _list_services_impl(cluster, profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)


@router.post("/service/update_count")
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


@router.post("/service/force_new_deployment")
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


@router.post("/service/events")
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


def _get_service_image_info_impl(cluster: str, service: str, profile: Optional[str] = None, region: str = "us-east-1", auth_method: str = "access_key", aws_access_key_id: Optional[str] = None, aws_secret_access_key: Optional[str] = None, aws_session_token: Optional[str] = None):
    """Get current and latest image information for a service"""
    try:
        session = get_boto3_session(profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)
        ecs = session.client("ecs", config=BOTO3_CONFIG)
        
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
                    
                    has_updates, latest_image_uri = unified_image_comparison(
                        current_image_uri,
                        images_info,
                        running_task_digest=None
                    )
                    uses_latest_tag = (current_tag == "latest")
                    
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


@router.post("/service_image_info")
def get_service_image_info_post(request: ServiceImageInfoRequest):
    """Get current and latest image information for a service (POST version)"""
    return _get_service_image_info_impl(
        request.cluster, request.service, request.profile, request.region, 
        request.auth_method, request.aws_access_key_id, 
        request.aws_secret_access_key, request.aws_session_token
    )


@router.get("/service_image_info")
def get_service_image_info(cluster: str, service: str, profile: Optional[str] = None, region: str = "us-east-1", auth_method: str = "access_key", aws_access_key_id: Optional[str] = None, aws_secret_access_key: Optional[str] = None, aws_session_token: Optional[str] = None):
    """Get current and latest image information for a service (GET version for backward compatibility)"""
    return _get_service_image_info_impl(cluster, service, profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)

