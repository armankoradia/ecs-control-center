from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import boto3
import time
import asyncio
import json
from botocore.exceptions import NoCredentialsError, ClientError
from botocore.config import Config

app = FastAPI()

# Optimized boto3 config
BOTO3_CONFIG = Config(
    retries={'max_attempts': 3, 'mode': 'adaptive'},
    max_pool_connections=50
)

def get_boto3_session(profile="default", region="us-east-1", auth_method="profile"):
    """Get boto3 session with fallback"""
    try:
        if auth_method == "iam_role":
            session = boto3.Session(region_name=region)
            sts = session.client('sts', config=BOTO3_CONFIG)
            sts.get_caller_identity()
            return session
        else:
            session = boto3.Session(profile_name=profile, region_name=region)
            sts = session.client('sts', config=BOTO3_CONFIG)
            sts.get_caller_identity()
            return session
    except (NoCredentialsError, ClientError) as e:
        if auth_method == "iam_role":
            try:
                session = boto3.Session(profile_name="default", region_name=region)
                sts = session.client('sts', config=BOTO3_CONFIG)
                sts.get_caller_identity()
                return session
            except:
                pass
        raise HTTPException(status_code=401, detail=f"Authentication failed: {str(e)}")

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
    container_name: str = None
    profile: str = "default"
    region: str = "us-east-1"
    auth_method: str = "profile"

# Endpoints
@app.get("/")
def root():
    return {"message": "ECS Explorer API - Optimized"}

@app.get("/auth_test")
def test_authentication(profile: str = "default", region: str = "us-east-1", auth_method: str = "profile"):
    """Test authentication method"""
    try:
        session = get_boto3_session(profile, region, auth_method)
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

@app.get("/profiles")
def list_profiles():
    """List available AWS profiles"""
    import os
    creds_path = "/root/.aws/credentials"
    if not os.path.exists(creds_path):
        return []
    profiles = []
    with open(creds_path) as f:
        for line in f:
            line = line.strip()
            if line.startswith("[") and line.endswith("]"):
                profiles.append(line[1:-1])
    return profiles

@app.get("/clusters")
def list_clusters(profile: str = "default", region: str = "us-east-1", auth_method: str = "profile"):
    """List ECS clusters"""
    try:
        session = get_boto3_session(profile, region, auth_method)
        ecs = session.client("ecs", config=BOTO3_CONFIG)
        clusters = []
        paginator = ecs.get_paginator("list_clusters")
        for page in paginator.paginate():
            clusters.extend(page["clusterArns"])
        return clusters
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list clusters: {str(e)}")

@app.get("/services")
def list_services(cluster: str, profile: str = "default", region: str = "us-east-1", auth_method: str = "profile"):
    """List ECS services"""
    try:
        session = get_boto3_session(profile, region, auth_method)
        ecs = session.client("ecs", config=BOTO3_CONFIG)
        services = []
        paginator = ecs.get_paginator("list_services")
        for page in paginator.paginate(cluster=cluster):
            services.extend(page["serviceArns"])
        return [s.split("/")[-1] for s in services]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list services: {str(e)}")

@app.get("/tasks")
def list_tasks(cluster: str, service: str, profile: str = "default", region: str = "us-east-1", auth_method: str = "profile"):
    """List ECS tasks"""
    try:
        session = get_boto3_session(profile, region, auth_method)
        ecs = session.client("ecs", config=BOTO3_CONFIG)
        tasks = ecs.list_tasks(cluster=cluster, serviceName=service)
        return tasks.get("taskArns", [])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list tasks: {str(e)}")

@app.get("/task_count")
def task_count(cluster: str, service: str = None, profile: str = "default", region: str = "us-east-1", auth_method: str = "profile"):
    """Get count of active tasks for a cluster or specific service"""
    try:
        session = get_boto3_session(profile, region, auth_method)
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

@app.get("/task_details")
def task_details(cluster: str, service: str, profile: str = "default", region: str = "us-east-1", auth_method: str = "profile"):
    """Get detailed task information"""
    try:
        session = get_boto3_session(profile, region, auth_method)
        ecs = session.client("ecs", config=BOTO3_CONFIG)
        ecr = session.client("ecr", config=BOTO3_CONFIG)

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
                            repo_part = img_uri.split(".amazonaws.com/")[1]
                            repo_name = repo_part.split(":")[0]
                            current_tag = img_uri.split(":")[-1]
                            
                            resp = ecr.describe_images(repositoryName=repo_name, filter={"tagStatus": "TAGGED"})
                            images_info = resp.get("imageDetails", [])
                            if images_info:
                                images_info.sort(key=lambda x: x.get("imagePushedAt", 0), reverse=True)
                                
                                # Check if current tag is "latest"
                                if current_tag == "latest":
                                    # For "latest" tag, compare image digests
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
                                    
                                    # Compare digests to detect if latest
                                    if current_digest and latest_digest:
                                        is_latest = current_digest == latest_digest
                                        base_uri = img_uri.split(":")[0]
                                        latest_image_uri = f"{base_uri}:latest"
                                    else:
                                        is_latest = False
                                        latest_image_uri = img_uri
                                else:
                                    # For versioned tags, use existing logic
                                    latest_image = images_info[0]
                                    latest_tags = latest_image.get("imageTags", [])
                                    if latest_tags:
                                        latest_tag = latest_tags[0]
                                        base_uri = img_uri.split(":")[0]
                                        latest_image_uri = f"{base_uri}:{latest_tag}"
                                        is_latest = img_uri == latest_image_uri
                                    else:
                                        is_latest = False
                                        latest_image_uri = img_uri
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

        # Handle running tasks
        tasks_desc = ecs.describe_tasks(cluster=cluster, tasks=task_arns)
        for t in tasks_desc.get("tasks", []):
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
                        repo_part = img_uri.split(".amazonaws.com/")[1]
                        repo_name = repo_part.split(":")[0]
                        current_tag = img_uri.split(":")[-1]
                        
                        resp = ecr.describe_images(repositoryName=repo_name, filter={"tagStatus": "TAGGED"})
                        images_info = resp.get("imageDetails", [])
                        if images_info:
                            images_info.sort(key=lambda x: x.get("imagePushedAt", 0), reverse=True)
                            
                            # Check if current tag is "latest"
                            if current_tag == "latest":
                                # For "latest" tag, compare image digests
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
                                
                                # Compare digests to detect if latest
                                if current_digest and latest_digest:
                                    is_latest = current_digest == latest_digest
                                    base_uri = img_uri.split(":")[0]
                                    latest_image_uri = f"{base_uri}:latest"
                                else:
                                    is_latest = False
                                    latest_image_uri = img_uri
                            else:
                                # For versioned tags, use existing logic
                                latest_image = images_info[0]
                                latest_tags = latest_image.get("imageTags", [])
                                if latest_tags:
                                    latest_tag = latest_tags[0]
                                    base_uri = img_uri.split(":")[0]
                                    latest_image_uri = f"{base_uri}:{latest_tag}"
                                    is_latest = img_uri == latest_image_uri
                                else:
                                    is_latest = False
                                    latest_image_uri = img_uri
                    except:
                        pass
                
                images.append({
                    "uri": img_uri,
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
                "status": "RUNNING"
            })
        return results
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get task details: {str(e)}")

@app.post("/deploy")
def deploy_new_image(data: DeployRequest):
    """Deploy new image with latest ECR version"""
    try:
        session = get_boto3_session(data.profile, data.region, data.auth_method)
        ecs = session.client("ecs", config=BOTO3_CONFIG)
        ecr = session.client("ecr", config=BOTO3_CONFIG)

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
            # For "latest" tag: Just stop current tasks, ECS will pull latest automatically
            running_tasks = ecs.list_tasks(
                cluster=data.cluster, 
                serviceName=data.service, 
                desiredStatus="RUNNING"
            ).get("taskArns", [])
            
            if running_tasks:
                # Stop all running tasks
                for task_arn in running_tasks:
                    ecs.stop_task(cluster=data.cluster, task=task_arn)
                
                return {
                    "message": "Deployment started successfully - Stopped running tasks to pull latest image",
                    "deployment_type": "latest_tag_restart",
                    "stopped_tasks": len(running_tasks),
                    "service_arn": svc["serviceArn"],
                    "deployment_id": f"{data.cluster}-{data.service}-{int(time.time())}"
                }
            else:
                return {
                    "message": "No running tasks to restart",
                    "deployment_type": "latest_tag_restart",
                    "stopped_tasks": 0,
                    "service_arn": svc["serviceArn"],
                    "deployment_id": f"{data.cluster}-{data.service}-{int(time.time())}"
                }
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
                        repo_part = current_image_uri.split(".amazonaws.com/")[1]
                        repo_name = repo_part.split(":")[0]
                        
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

            return {
                "message": "Deployment started successfully", 
                "deployment_type": "versioned_tag_update",
                "new_task_definition": new_td_arn,
                "service_arn": update_response["service"]["serviceArn"],
                "deployment_id": f"{data.cluster}-{data.service}-{int(time.time())}"
            }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Deployment failed: {str(e)}")

@app.get("/deployment_status")
def get_deployment_status(cluster: str, service: str, profile: str = "default", region: str = "us-east-1", auth_method: str = "profile"):
    """Check deployment status"""
    try:
        session = get_boto3_session(profile, region, auth_method)
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

@app.get("/cluster_overview")
def get_cluster_overview(cluster: str, profile: str = "default", region: str = "us-east-1", auth_method: str = "profile"):
    """Get cluster overview"""
    try:
        session = get_boto3_session(profile, region, auth_method)
        ecs = session.client("ecs", config=BOTO3_CONFIG)
        ecr = session.client("ecr", config=BOTO3_CONFIG)
        
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
                                    repo_part = image_uri.split(".amazonaws.com/")[1]
                                    repo_name = repo_part.split(":")[0]
                                    current_tag = image_uri.split(":")[-1]
                                    
                                    resp = ecr.describe_images(repositoryName=repo_name, filter={"tagStatus": "TAGGED"})
                                    images_info = resp.get("imageDetails", [])
                                    
                                    if images_info:
                                        # Sort by push time to get most recent
                                        images_info.sort(key=lambda x: x.get("imagePushedAt", 0), reverse=True)
                                        
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
                                                base_uri = image_uri.split(":")[0]
                                                latest_image_uri = f"{base_uri}:latest"
                                            else:
                                                has_updates = False
                                                latest_image_uri = image_uri
                                        else:
                                            # For versioned tags, use existing logic
                                            latest_image = images_info[0]
                                            latest_tags = latest_image.get("imageTags", [])
                                            
                                            if latest_tags:
                                                latest_tag = latest_tags[0]
                                                base_uri = image_uri.split(":")[0]
                                                latest_image_uri = f"{base_uri}:{latest_tag}"
                                                has_updates = image_uri != latest_image_uri
                                            else:
                                                has_updates = False
                                                latest_image_uri = image_uri
                            except:
                                pass
                            break
                except:
                    pass
            
            # Determine if service uses "latest" tags
            uses_latest_tag = False
            if current_td_arn:
                try:
                    # Use cached task definition (already fetched above)
                    if current_td_arn in td_cache:
                        current_td = td_cache[current_td_arn]
                    else:
                        # Fallback: fetch if not in cache (shouldn't happen normally)
                        td_response = ecs.describe_task_definition(taskDefinition=current_td_arn)
                        current_td = td_response.get("taskDefinition", {})
                    
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

@app.get("/log-target")
def get_log_target(cluster: str, service: str, profile: str = "default", region: str = "us-east-1", auth_method: str = "profile"):
    """Get CloudWatch log group and stream for a service"""
    try:
        session = get_boto3_session(profile, region, auth_method)
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
        profile = query_params.get("profile", "default")
        region = query_params.get("region", "us-east-1")
        interval = int(query_params.get("interval", 3))
        
        if not log_group or not log_stream:
            await websocket.send_text(json.dumps({"error": "Missing log_group or log_stream parameter"}))
            await websocket.close()
            return
        
        # Create CloudWatch logs client
        session = get_boto3_session(profile, region, "profile")
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
                response = logs.get_log_events(
                    logGroupName=log_group,
                    logStreamName=log_stream,
                    startFromHead=False,
                    limit=10,
                    startTime=last_token
                )
                
                events = response.get("events", [])
                if events:
                    last_token = events[-1].get("nextToken")
                    
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
