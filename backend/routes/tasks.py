"""Task-related routes."""

from typing import Optional
from fastapi import APIRouter, HTTPException
from models.schemas import TasksRequest, TaskDetailsRequest, TaskCountRequest
from utils.aws import get_boto3_session
from utils.ecr import extract_ecr_info, unified_image_comparison
from config.settings import BOTO3_CONFIG

router = APIRouter()


def _list_tasks_impl(
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


@router.post("/tasks")
def list_tasks_post(request: TasksRequest):
    """List ECS tasks (POST version)"""
    return _list_tasks_impl(
        request.cluster, request.service, request.profile, request.region, request.auth_method,
        request.aws_access_key_id, request.aws_secret_access_key, request.aws_session_token
    )


@router.get("/tasks")
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
    return _list_tasks_impl(cluster, service, profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)


def _task_count_impl(cluster: str, service: str = None, profile: Optional[str] = None, region: str = "us-east-1", auth_method: str = "access_key", aws_access_key_id: Optional[str] = None, aws_secret_access_key: Optional[str] = None, aws_session_token: Optional[str] = None):
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


@router.post("/task_count")
def task_count_post(request: TaskCountRequest):
    """Get count of active tasks (POST version)"""
    return _task_count_impl(
        request.cluster, request.service, request.profile, request.region, request.auth_method,
        request.aws_access_key_id, request.aws_secret_access_key, request.aws_session_token
    )


@router.get("/task_count")
def task_count(cluster: str, service: str = None, profile: Optional[str] = None, region: str = "us-east-1", auth_method: str = "access_key", aws_access_key_id: Optional[str] = None, aws_secret_access_key: Optional[str] = None, aws_session_token: Optional[str] = None):
    """Get count of active tasks (GET version for backward compatibility)"""
    return _task_count_impl(cluster, service, profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)


def _task_details_impl(
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
                            ecr_region, account_id, repo_name = extract_ecr_info(img_uri)
                            if not ecr_region or not repo_name:
                                continue
                            
                            ecr = session.client("ecr", region_name=ecr_region, config=BOTO3_CONFIG)
                            current_tag = img_uri.split(":")[-1]
                            
                            resp = ecr.describe_images(repositoryName=repo_name, filter={"tagStatus": "TAGGED"})
                            images_info = resp.get("imageDetails", [])
                            if images_info:
                                images_info.sort(key=lambda x: x.get("imagePushedAt", 0), reverse=True)
                                
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
                img_uri = c.get("image")
                container_name = c.get("name")
                
                actual_running_image = container_images.get(container_name, img_uri)
                
                is_latest = False
                latest_image_uri = None
                
                if img_uri and ".dkr.ecr." in img_uri:
                    try:
                        ecr_region, account_id, repo_name = extract_ecr_info(img_uri)
                        if not ecr_region or not repo_name:
                            continue
                        
                        ecr = session.client("ecr", region_name=ecr_region, config=BOTO3_CONFIG)
                        current_tag = img_uri.split(":")[-1]
                        
                        resp = ecr.describe_images(repositoryName=repo_name, filter={"tagStatus": "TAGGED"})
                        images_info = resp.get("imageDetails", [])
                        if images_info:
                            images_info.sort(key=lambda x: x.get("imagePushedAt", 0), reverse=True)
                            
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
                
                image_with_digest = actual_running_image
                current_digest = container_digests.get(container_name)
                if current_digest and not "@" in actual_running_image:
                    image_with_digest = f"{actual_running_image}@{current_digest}"
                
                images.append({
                    "uri": image_with_digest,
                    "task_definition_uri": img_uri,
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


@router.post("/task_details")
def task_details_post(request: TaskDetailsRequest):
    """Get detailed task information (POST version)"""
    return _task_details_impl(
        request.cluster, request.service, request.profile, request.region, request.auth_method,
        request.aws_access_key_id, request.aws_secret_access_key, request.aws_session_token
    )


@router.get("/task_details")
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
    return _task_details_impl(cluster, service, profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)

