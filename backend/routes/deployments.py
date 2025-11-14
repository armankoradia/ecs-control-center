"""Deployment-related routes."""

from typing import Optional
from fastapi import APIRouter, HTTPException, Body
from models.schemas import (
    DeployRequest,
    DeploymentStatusRequest,
    DeploymentHistoryRequest,
    RefreshDeploymentRequest,
    RollbackRequest,
)
from utils.aws import get_boto3_session
from utils.ecr import extract_ecr_info
from services.deployment_history import (
    deployment_history,
    save_deployment_history,
    update_deployment_status,
)
from config.settings import BOTO3_CONFIG
import time

router = APIRouter()


@router.post("/deploy")
def deploy_new_image(data: DeployRequest):
    """Deploy new image with latest ECR version"""
    try:
        session = get_boto3_session(data.profile, data.region, data.auth_method, data.aws_access_key_id, data.aws_secret_access_key, data.aws_session_token)
        ecs = session.client("ecs", config=BOTO3_CONFIG)

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
                        ecr_region, account_id, repo_name = extract_ecr_info(current_image_uri)
                        if not ecr_region or not repo_name:
                            continue
                        
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
            
            save_deployment_history(deployment_data)
            return deployment_data
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Deployment failed: {str(e)}")


def _get_deployment_status_impl(
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


@router.post("/deployment_status")
def get_deployment_status_post(request: DeploymentStatusRequest):
    """Check deployment status (POST version)"""
    return _get_deployment_status_impl(
        request.cluster, request.service, request.profile, request.region, request.auth_method,
        request.aws_access_key_id, request.aws_secret_access_key, request.aws_session_token
    )


@router.get("/deployment_status")
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
    return _get_deployment_status_impl(cluster, service, profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)


def _get_deployment_history_impl(cluster: str = None, service: str = None, limit: int = 50, profile: Optional[str] = None, region: str = "us-east-1", auth_method: str = "access_key", aws_access_key_id: Optional[str] = None, aws_secret_access_key: Optional[str] = None, aws_session_token: Optional[str] = None):
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
        deployments_to_update = non_terminal_deployments[:100]
        for deployment in deployments_to_update:
            try:
                next_refresh_at = deployment.get("next_refresh_at")
                if next_refresh_at:
                    pass
            except Exception:
                pass
            update_deployment_status(deployment["deployment_id"], profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)
        
        # Limit results
        filtered_history = filtered_history[:limit]
        
        return {
            "deployments": filtered_history,
            "total": len(filtered_history)
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get deployment history: {str(e)}")


@router.post("/deployment_history")
def get_deployment_history_post(request: DeploymentHistoryRequest):
    """Get deployment history with optional filtering and status updates (POST version)"""
    return _get_deployment_history_impl(
        request.cluster, request.service, request.limit, request.profile, 
        request.region, request.auth_method, request.aws_access_key_id, 
        request.aws_secret_access_key, request.aws_session_token
    )


@router.get("/deployment_history")
def get_deployment_history(cluster: str = None, service: str = None, limit: int = 50, profile: Optional[str] = None, region: str = "us-east-1", auth_method: str = "access_key", aws_access_key_id: Optional[str] = None, aws_secret_access_key: Optional[str] = None, aws_session_token: Optional[str] = None):
    """Get deployment history with optional filtering and status updates (GET version for backward compatibility)"""
    return _get_deployment_history_impl(cluster, service, limit, profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)


@router.post("/deployment_history/{deployment_id}/refresh")
def refresh_deployment_status(deployment_id: str, request: Optional[RefreshDeploymentRequest] = Body(None), profile: Optional[str] = None, region: str = "us-east-1", auth_method: str = "access_key", aws_access_key_id: Optional[str] = None, aws_secret_access_key: Optional[str] = None, aws_session_token: Optional[str] = None):
    """Refresh status for a specific deployment"""
    if request:
        profile = request.profile
        region = request.region
        auth_method = request.auth_method
        aws_access_key_id = request.aws_access_key_id
        aws_secret_access_key = request.aws_secret_access_key
        aws_session_token = request.aws_session_token
    try:
        update_deployment_status(deployment_id, profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)
        
        deployment = next((d for d in deployment_history if d.get("deployment_id") == deployment_id), None)
        
        if not deployment:
            raise HTTPException(status_code=404, detail="Deployment not found")
        
        return deployment
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to refresh deployment status: {str(e)}")


@router.get("/deployment_history/{deployment_id}")
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


@router.post("/rollback/{deployment_id}")
def rollback_deployment(deployment_id: str, request: Optional[RollbackRequest] = Body(None), profile: Optional[str] = None, region: str = "us-east-1", auth_method: str = "access_key", aws_access_key_id: Optional[str] = None, aws_secret_access_key: Optional[str] = None, aws_session_token: Optional[str] = None):
    """Rollback to a previous deployment"""
    if request:
        profile = request.profile
        region = request.region
        auth_method = request.auth_method
        aws_access_key_id = request.aws_access_key_id
        aws_secret_access_key = request.aws_secret_access_key
        aws_session_token = request.aws_session_token
    try:
        target_deployment = next((d for d in deployment_history if d.get("deployment_id") == deployment_id), None)
        
        if not target_deployment:
            raise HTTPException(status_code=404, detail="Deployment not found")
        
        cluster = target_deployment.get("cluster")
        service = target_deployment.get("service")
        
        if not cluster or not service:
            raise HTTPException(status_code=400, detail="Invalid deployment data")
        
        session = get_boto3_session(profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)
        ecs = session.client("ecs", config=BOTO3_CONFIG)
        
        svc_response = ecs.describe_services(cluster=cluster, services=[service])
        if not svc_response["services"]:
            raise HTTPException(status_code=404, detail="Service not found")
        
        current_td_arn = svc_response["services"][0].get("taskDefinition")
        
        td_response = ecs.describe_task_definition(taskDefinition=current_td_arn)
        current_td = td_response.get("taskDefinition", {})
        
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
        
        rollback_td_arn = task_definitions[1]
        
        update_response = ecs.update_service(
            cluster=cluster,
            service=service,
            taskDefinition=rollback_td_arn
        )
        
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

