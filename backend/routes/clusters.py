"""Cluster-related routes."""

from typing import Optional
from fastapi import APIRouter, HTTPException
from models.schemas import ClustersRequest, ClusterOverviewRequest
from utils.aws import get_boto3_session
from utils.ecr import extract_ecr_info, unified_image_comparison
from config.settings import BOTO3_CONFIG

router = APIRouter()


def _list_clusters_impl(
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


@router.post("/clusters")
def list_clusters_post(request: ClustersRequest):
    """List ECS clusters (POST version)"""
    return _list_clusters_impl(
        request.profile, request.region, request.auth_method,
        request.aws_access_key_id, request.aws_secret_access_key, request.aws_session_token
    )


@router.get("/clusters")
def list_clusters(
    profile: Optional[str] = None,
    region: str = "us-east-1",
    auth_method: str = "access_key",
    aws_access_key_id: Optional[str] = None,
    aws_secret_access_key: Optional[str] = None,
    aws_session_token: Optional[str] = None,
):
    """List ECS clusters (GET version for backward compatibility)"""
    return _list_clusters_impl(profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)


def _get_cluster_overview_impl(
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


@router.post("/cluster_overview")
def get_cluster_overview_post(request: ClusterOverviewRequest):
    """Get cluster overview (POST version)"""
    return _get_cluster_overview_impl(
        request.cluster, request.profile, request.region, request.auth_method,
        request.aws_access_key_id, request.aws_secret_access_key, request.aws_session_token
    )


@router.get("/cluster_overview")
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
    return _get_cluster_overview_impl(cluster, profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)

