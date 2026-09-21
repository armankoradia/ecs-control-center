"""Deployment-related routes."""

from typing import Optional, List
from fastapi import APIRouter, HTTPException, Body, Request
from concurrent.futures import ThreadPoolExecutor, as_completed
from models.schemas import (
    DeployRequest,
    DeploymentStatusRequest,
    DeploymentHistoryRequest,
    RefreshDeploymentRequest,
    RollbackRequest,
    CrossClusterDeployRequest,
)
from utils.aws import get_boto3_session
from utils.ecr import extract_ecr_info, unified_image_comparison
from utils.auth import get_user_from_request
from utils.dynamo import get_history_item, list_history
from services.deployment_history import (
    save_deployment_history,
    update_deployment_status,
    get_deployment_history as _fetch_history_records,
)
from config.settings import BOTO3_CONFIG
import time

router = APIRouter()


def _find_service_by_suffix(ecs, cluster: str, suffix: str, env: Optional[str] = None) -> Optional[str]:
    """
    Return the full ECS service name in *cluster* whose name ends with '-{suffix}'.
    When *env* is given (e.g. 'prod', 'dev') the env segment immediately before the
    suffix must also match, e.g. '-prod-ludicloud-api' must appear in the name.
    Returns None if no matching service is found.
    """
    paginator = ecs.get_paginator("list_services")
    for page in paginator.paginate(cluster=cluster, maxResults=100):
        for arn in page["serviceArns"]:
            name = arn.split("/")[-1]
            if not (name == suffix or name.endswith(f"-{suffix}")):
                continue
            if env and f"-{env}-{suffix}" not in name:
                continue
            return name
    return None


def _deploy_service_to_cluster(
    cluster: str,
    service: str,
    container_name: Optional[str] = None,
    profile: Optional[str] = None,
    region: str = "us-east-1",
    auth_method: str = "access_key",
    aws_access_key_id: Optional[str] = None,
    aws_secret_access_key: Optional[str] = None,
    aws_session_token: Optional[str] = None,
) -> dict:
    """Core deploy logic for a single cluster/service. Creates its own session (thread-safe)."""
    # Each call creates its own boto3 session so this is safe to call from threads
    session = get_boto3_session(profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)
    ecs = session.client("ecs", config=BOTO3_CONFIG)

    # Check if service exists and is active in this cluster
    svc_response = ecs.describe_services(cluster=cluster, services=[service])
    services_list = svc_response.get("services", [])
    active_services = [s for s in services_list if s.get("status") == "ACTIVE"]

    if not active_services:
        return {"skipped": True, "reason": "Service not found or inactive in cluster"}

    svc = active_services[0]
    td_arn = svc["taskDefinition"]
    td = ecs.describe_task_definition(taskDefinition=td_arn)["taskDefinition"]

    # Check if any container uses "latest" tag
    has_latest_tag = False
    for c in td["containerDefinitions"]:
        current_image_uri = c.get("image", "")
        if current_image_uri and ".dkr.ecr." in current_image_uri:
            if current_image_uri.split(":")[-1] == "latest":
                has_latest_tag = True
                break

    if has_latest_tag:
        update_response = ecs.update_service(
            cluster=cluster,
            service=service,
            forceNewDeployment=True
        )
        deployment_data = {
            "cluster": cluster,
            "service": service,
            "region": region,
            "message": "Force new deployment started - ECS will pull latest image and start new tasks",
            "deployment_type": "latest_tag_restart",
            "service_arn": update_response["service"]["serviceArn"],
            "deployment_id": f"{cluster}-{service}-{int(time.time())}",
        }
    else:
        # For versioned tags: Update task definition with latest image
        new_container_defs = []
        for c in td["containerDefinitions"]:
            new_c = c.copy()
            current_image_uri = c.get("image", "")

            should_update = (
                (container_name and c["name"] == container_name) or
                (not container_name)
            )

            if should_update and current_image_uri and ".dkr.ecr." in current_image_uri:
                try:
                    ecr_region, account_id, repo_name = extract_ecr_info(current_image_uri)
                    if not ecr_region or not repo_name:
                        new_container_defs.append(new_c)
                        continue

                    ecr = session.client("ecr", region_name=ecr_region, config=BOTO3_CONFIG)
                    resp = ecr.describe_images(repositoryName=repo_name, filter={"tagStatus": "TAGGED"})
                    images_info = resp.get("imageDetails", [])

                    if images_info:
                        images_info.sort(key=lambda x: x.get("imagePushedAt", 0), reverse=True)
                        latest_tags = images_info[0].get("imageTags", [])
                        if latest_tags:
                            new_c["image"] = f"{current_image_uri.split(':')[0]}:{latest_tags[0]}"
                except Exception:
                    pass

            new_container_defs.append(new_c)

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

        update_response = ecs.update_service(
            cluster=cluster,
            service=service,
            taskDefinition=new_td_arn
        )
        deployment_data = {
            "cluster": cluster,
            "service": service,
            "region": region,
            "message": "Deployment started successfully",
            "deployment_type": "versioned_tag_update",
            "new_task_definition": new_td_arn,
            "service_arn": update_response["service"]["serviceArn"],
            "deployment_id": f"{cluster}-{service}-{int(time.time())}",
        }

    save_deployment_history(deployment_data)
    return deployment_data


@router.post("/deploy")
def deploy_new_image(data: DeployRequest, request: Request):
    """Deploy new image with latest ECR version"""
    try:
        user = get_user_from_request(request)
        result = _deploy_service_to_cluster(
            cluster=data.cluster,
            service=data.service,
            container_name=data.container_name,
            profile=data.profile,
            region=data.region,
            auth_method=data.auth_method,
            aws_access_key_id=data.aws_access_key_id,
            aws_secret_access_key=data.aws_secret_access_key,
            aws_session_token=data.aws_session_token,
        )
        # Patch the already-written history record with user + region
        from utils.dynamo import update_history_status
        if result.get("deployment_id"):
            update_history_status(result["deployment_id"], "IN_PROGRESS", {
                "username": user["username"],
                "email": user["email"],
                "region": data.region,
            })
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Deployment failed: {str(e)}")



@router.post("/deploy_across_clusters")
def deploy_service_across_clusters(data: CrossClusterDeployRequest, request: Request):
    """Deploy a service across all (or specified) clusters in parallel."""
    try:
        user = get_user_from_request(request)
        # Resolve the list of clusters to deploy to
        clusters_to_deploy: List[str] = data.clusters or []
        if not clusters_to_deploy:
            session = get_boto3_session(
                data.profile, data.region, data.auth_method,
                data.aws_access_key_id, data.aws_secret_access_key, data.aws_session_token
            )
            ecs = session.client("ecs", config=BOTO3_CONFIG)
            paginator = ecs.get_paginator("list_clusters")
            for page in paginator.paginate():
                clusters_to_deploy.extend(
                    arn.split("/")[-1] for arn in page["clusterArns"]
                )

        credentials = dict(
            profile=data.profile,
            region=data.region,
            auth_method=data.auth_method,
            aws_access_key_id=data.aws_access_key_id,
            aws_secret_access_key=data.aws_secret_access_key,
            aws_session_token=data.aws_session_token,
        )

        results = []

        def _deploy_one(cluster_name: str) -> dict:
            try:
                # Each thread creates its own session/client (thread-safe)
                _session = get_boto3_session(
                    credentials["profile"], credentials["region"], credentials["auth_method"],
                    credentials["aws_access_key_id"], credentials["aws_secret_access_key"],
                    credentials["aws_session_token"],
                )
                _ecs = _session.client("ecs", config=BOTO3_CONFIG)

                # Resolve the full service name via suffix + optional env match
                full_service_name = _find_service_by_suffix(_ecs, cluster_name, data.service, data.env)
                if not full_service_name:
                    env_hint = f"-{data.env}-" if data.env else ""
                    return {
                        "cluster": cluster_name,
                        "status": "SKIPPED",
                        "message": f"No service matching '*{env_hint}{data.service}' found in cluster",
                    }

                result = _deploy_service_to_cluster(
                    cluster=cluster_name,
                    service=full_service_name,
                    **credentials,
                )
                if result.get("skipped"):
                    return {"cluster": cluster_name, "status": "SKIPPED", "message": result["reason"]}
                # Patch user info onto the history record written by _deploy_service_to_cluster
                if result.get("deployment_id"):
                    from utils.dynamo import update_history_status
                    update_history_status(result["deployment_id"], "IN_PROGRESS", {
                        "username": user["username"],
                        "email": user["email"],
                    })
                return {
                    "cluster": cluster_name,
                    "service": full_service_name,
                    "status": "SUCCESS",
                    "message": result.get("message", "Deployment started"),
                    "deployment_id": result.get("deployment_id"),
                    "deployment_type": result.get("deployment_type"),
                }
            except Exception as exc:
                return {"cluster": cluster_name, "status": "FAILED", "message": str(exc)}

        # Run all cluster deploys in parallel (cap workers to avoid overwhelming AWS API)
        max_workers = min(len(clusters_to_deploy), 10)
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(_deploy_one, c): c for c in clusters_to_deploy}
            for future in as_completed(futures):
                results.append(future.result())

        succeeded = sum(1 for r in results if r["status"] == "SUCCESS")
        failed = sum(1 for r in results if r["status"] == "FAILED")
        skipped = sum(1 for r in results if r["status"] == "SKIPPED")

        return {
            "service": data.service,
            "results": sorted(results, key=lambda r: r["cluster"]),
            "summary": {
                "total": len(results),
                "succeeded": succeeded,
                "failed": failed,
                "skipped": skipped,
            },
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Cross-cluster deployment failed: {str(e)}")


@router.post("/cross_cluster_service_status")
def get_cross_cluster_service_status(data: CrossClusterDeployRequest):
    """
    Return current-vs-latest image version info for a service suffix across all (or specified) clusters.
    Runs checks in parallel. Used to give a pre-deploy version overview in the UI.
    """
    try:
        clusters_to_check: List[str] = data.clusters or []
        if not clusters_to_check:
            session = get_boto3_session(
                data.profile, data.region, data.auth_method,
                data.aws_access_key_id, data.aws_secret_access_key, data.aws_session_token,
            )
            ecs = session.client("ecs", config=BOTO3_CONFIG)
            paginator = ecs.get_paginator("list_clusters")
            for page in paginator.paginate():
                clusters_to_check.extend(arn.split("/")[-1] for arn in page["clusterArns"])

        credentials = dict(
            profile=data.profile,
            region=data.region,
            auth_method=data.auth_method,
            aws_access_key_id=data.aws_access_key_id,
            aws_secret_access_key=data.aws_secret_access_key,
            aws_session_token=data.aws_session_token,
        )

        def _check_one(cluster_name: str) -> dict:
            base = {"cluster": cluster_name, "service": None}
            try:
                session = get_boto3_session(**credentials)
                ecs = session.client("ecs", config=BOTO3_CONFIG)

                full_service = _find_service_by_suffix(ecs, cluster_name, data.service, data.env)
                if not full_service:
                    return {**base, "status": "NOT_DEPLOYED",
                            "current_tag": None, "latest_tag": None, "has_update": False,
                            "running_count": 0, "desired_count": 0, "uses_latest_tag": False}

                svc_resp = ecs.describe_services(cluster=cluster_name, services=[full_service])
                svcs = [s for s in svc_resp.get("services", []) if s.get("status") == "ACTIVE"]
                if not svcs:
                    return {**base, "service": full_service, "status": "NOT_DEPLOYED",
                            "current_tag": None, "latest_tag": None, "has_update": False,
                            "running_count": 0, "desired_count": 0, "uses_latest_tag": False}

                svc = svcs[0]
                running_count = svc.get("runningCount", 0)
                desired_count = svc.get("desiredCount", 0)
                td_arn = svc["taskDefinition"]
                td = ecs.describe_task_definition(taskDefinition=td_arn)["taskDefinition"]

                current_tag = None
                latest_tag = None
                has_update = False
                uses_latest_tag = False
                current_image_uri = None

                for c in td.get("containerDefinitions", []):
                    image_uri = c.get("image", "")
                    if not (image_uri and ".dkr.ecr." in image_uri):
                        continue
                    current_image_uri = image_uri
                    current_tag = image_uri.split(":")[-1]
                    uses_latest_tag = current_tag == "latest"
                    try:
                        ecr_region, _, repo_name = extract_ecr_info(image_uri)
                        if ecr_region and repo_name:
                            ecr = session.client("ecr", region_name=ecr_region, config=BOTO3_CONFIG)
                            resp = ecr.describe_images(repositoryName=repo_name, filter={"tagStatus": "TAGGED"})
                            images_info = sorted(
                                resp.get("imageDetails", []),
                                key=lambda x: x.get("imagePushedAt", 0),
                                reverse=True,
                            )

                            # Mirror the same running-digest lookup that cluster_overview uses.
                            # For "latest"-tag services the task definition tag is always "latest",
                            # so we must compare the *actual running image digest* against the
                            # newest ECR digest — exactly what unified_image_comparison does when
                            # running_digest_for_service is provided.
                            running_digest_for_service = None
                            if uses_latest_tag:
                                try:
                                    running_task_arns = ecs.list_tasks(
                                        cluster=cluster_name,
                                        serviceName=full_service,
                                        desiredStatus="RUNNING",
                                    ).get("taskArns", [])
                                    if running_task_arns:
                                        task_details = ecs.describe_tasks(
                                            cluster=cluster_name,
                                            tasks=running_task_arns[:1],
                                        ).get("tasks", [])
                                        if task_details:
                                            for tc in task_details[0].get("containers", []):
                                                running_digest_for_service = tc.get("imageDigest")
                                                if running_digest_for_service:
                                                    break
                                except Exception:
                                    pass

                            if images_info:
                                has_update, latest_uri = unified_image_comparison(
                                    image_uri, images_info, running_digest_for_service
                                )
                                latest_tag = latest_uri.split(":")[-1] if latest_uri else current_tag
                    except Exception:
                        pass
                    break  # Only inspect the first ECR container

                if running_count == 0:
                    svc_status = "NO_TASKS"
                elif has_update:
                    svc_status = "UPDATE_AVAILABLE"
                else:
                    svc_status = "UP_TO_DATE"

                return {
                    "cluster": cluster_name,
                    "service": full_service,
                    "current_tag": current_tag,
                    "latest_tag": latest_tag,
                    "has_update": has_update,
                    "running_count": running_count,
                    "desired_count": desired_count,
                    "uses_latest_tag": uses_latest_tag,
                    "status": svc_status,
                }
            except Exception as exc:
                return {**base, "status": "ERROR", "error": str(exc),
                        "current_tag": None, "latest_tag": None, "has_update": False,
                        "running_count": 0, "desired_count": 0, "uses_latest_tag": False}

        max_workers = min(len(clusters_to_check), 10)
        results = []
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(_check_one, c): c for c in clusters_to_check}
            for future in as_completed(futures):
                results.append(future.result())

        results.sort(key=lambda r: r["cluster"])
        updates_available = sum(1 for r in results if r["status"] == "UPDATE_AVAILABLE")
        deployed_count = sum(1 for r in results if r["status"] != "NOT_DEPLOYED")

        return {
            "service_suffix": data.service,
            "clusters": results,
            "summary": {
                "total_clusters": len(results),
                "deployed_in": deployed_count,
                "updates_available": updates_available,
            },
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get service status: {str(e)}")


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


def _get_deployment_history_impl(cluster: str = None, service: str = None, limit: int = 100, profile: Optional[str] = None, region: str = "us-east-1", auth_method: str = "access_key", aws_access_key_id: Optional[str] = None, aws_secret_access_key: Optional[str] = None, aws_session_token: Optional[str] = None):
    """Get deployment history from DynamoDB with optional filtering."""
    try:
        records = _fetch_history_records(cluster=cluster, service=service, limit=limit)

        # Refresh status for any in-progress deployments (cap at 10 to avoid timeout)
        in_progress = [r for r in records if r.get("status") in ("IN_PROGRESS", "PENDING", "UNKNOWN")]
        for record in in_progress[:10]:
            update_deployment_status(
                record["deployment_id"], profile, region, auth_method,
                aws_access_key_id, aws_secret_access_key, aws_session_token,
            )

        # Re-fetch after status updates
        records = _fetch_history_records(cluster=cluster, service=service, limit=limit)
        return {"deployments": records, "total": len(records)}

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
        deployment = get_history_item(deployment_id)
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
        deployment = get_history_item(deployment_id)
        if not deployment:
            raise HTTPException(status_code=404, detail="Deployment not found")
        return deployment
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get deployment details: {str(e)}")


@router.post("/rollback/{deployment_id}")
def rollback_deployment(deployment_id: str, http_request: Request, request: Optional[RollbackRequest] = Body(None), profile: Optional[str] = None, region: str = "us-east-1", auth_method: str = "access_key", aws_access_key_id: Optional[str] = None, aws_secret_access_key: Optional[str] = None, aws_session_token: Optional[str] = None):
    """Rollback to a previous deployment"""
    user = get_user_from_request(http_request)
    if request:
        profile = request.profile
        region = request.region
        auth_method = request.auth_method
        aws_access_key_id = request.aws_access_key_id
        aws_secret_access_key = request.aws_secret_access_key
        aws_session_token = request.aws_session_token
    try:
        target_deployment = get_history_item(deployment_id)
        
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
            "region": region,
            "message": f"Rollback to deployment {deployment_id}",
            "deployment_type": "rollback",
            "action_type": "rollback",
            "new_task_definition": rollback_td_arn,
            "service_arn": update_response["service"]["serviceArn"],
            "deployment_id": f"rollback-{cluster}-{service}-{int(time.time())}",
            "original_deployment_id": deployment_id,
            "username": user["username"],
            "email": user["email"],
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

