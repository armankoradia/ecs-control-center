"""Task definition-related routes."""

from typing import Optional
from fastapi import APIRouter, HTTPException
from models.schemas import TaskDefinitionRequest, TaskDefinitionUpdate
from utils.aws import get_boto3_session
from services.deployment_history import save_deployment_history
from config.settings import BOTO3_CONFIG
import time

router = APIRouter()


def _get_task_definition_impl(cluster: str, service: str, profile: Optional[str] = None, region: str = "us-east-1", auth_method: str = "access_key", aws_access_key_id: Optional[str] = None, aws_secret_access_key: Optional[str] = None, aws_session_token: Optional[str] = None):
    """Get current task definition for a service"""
    try:
        session = get_boto3_session(profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)
        ecs = session.client("ecs", config=BOTO3_CONFIG)
        
        svc_response = ecs.describe_services(cluster=cluster, services=[service])
        if not svc_response["services"]:
            raise HTTPException(status_code=404, detail="Service not found")
        
        service_info = svc_response["services"][0]
        current_td_arn = service_info.get("taskDefinition")
        
        if not current_td_arn:
            raise HTTPException(status_code=404, detail="No task definition found for service")
        
        td_response = ecs.describe_task_definition(taskDefinition=current_td_arn)
        task_definition = td_response.get("taskDefinition", {})
        
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


@router.post("/task_definition")
def get_task_definition_post(request: TaskDefinitionRequest):
    """Get current task definition for a service (POST version)"""
    return _get_task_definition_impl(
        request.cluster, request.service, request.profile, request.region, 
        request.auth_method, request.aws_access_key_id, 
        request.aws_secret_access_key, request.aws_session_token
    )


@router.get("/task_definition")
def get_task_definition(cluster: str, service: str, profile: Optional[str] = None, region: str = "us-east-1", auth_method: str = "access_key", aws_access_key_id: Optional[str] = None, aws_secret_access_key: Optional[str] = None, aws_session_token: Optional[str] = None):
    """Get current task definition for a service (GET version for backward compatibility)"""
    return _get_task_definition_impl(cluster, service, profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)


@router.post("/task_definition/update")
def update_task_definition(data: TaskDefinitionUpdate):
    """Update task definition with new settings and deploy"""
    try:
        session = get_boto3_session(data.profile, data.region, data.auth_method, data.aws_access_key_id, data.aws_secret_access_key, data.aws_session_token)
        ecs = session.client("ecs", config=BOTO3_CONFIG)
        
        svc_response = ecs.describe_services(cluster=data.cluster, services=[data.service])
        if not svc_response["services"]:
            raise HTTPException(status_code=404, detail="Service not found")
        
        service_info = svc_response["services"][0]
        current_td_arn = service_info.get("taskDefinition")
        
        if not current_td_arn:
            raise HTTPException(status_code=404, detail="No task definition found for service")
        
        td_response = ecs.describe_task_definition(taskDefinition=current_td_arn)
        current_td = td_response.get("taskDefinition", {})
        
        new_td = current_td.copy()
        
        if hasattr(data, 'cpu') and 'cpu' in data.__dict__:
            if data.cpu:
                new_td["cpu"] = data.cpu
            else:
                if "cpu" in new_td:
                    del new_td["cpu"]
        
        if hasattr(data, 'memory') and 'memory' in data.__dict__:
            if data.memory:
                new_td["memory"] = data.memory
            else:
                if "memory" in new_td:
                    del new_td["memory"]
        
        if data.container_updates:
            container_updates_map = {cu.container_name: cu for cu in data.container_updates}
            
            updated_containers = []
            for container in new_td.get("containerDefinitions", []):
                container_name = container.get("name")
                updated_container = container.copy()
                
                if container_name in container_updates_map:
                    update = container_updates_map[container_name]
                    
                    if update.cpu is not None:
                        if update.cpu:
                            updated_container["cpu"] = update.cpu
                        else:
                            if "cpu" in updated_container:
                                del updated_container["cpu"]
                    
                    if update.memory is not None:
                        if update.memory:
                            updated_container["memoryReservation"] = update.memory
                            if "memory" in updated_container:
                                del updated_container["memory"]
                        else:
                            if "memoryReservation" in updated_container:
                                del updated_container["memoryReservation"]
                            if "memory" in updated_container:
                                del updated_container["memory"]
                    
                    if update.image is not None:
                        updated_container["image"] = update.image
                    
                    if update.environment_variables:
                        existing_env = {env["name"]: env["value"] for env in updated_container.get("environment", [])}
                        existing_env.update(update.environment_variables)
                        updated_container["environment"] = [
                            {"name": name, "value": value} for name, value in existing_env.items()
                        ]
                    
                    if update.secrets:
                        existing_secrets = {secret["name"]: secret["valueFrom"] for secret in updated_container.get("secrets", [])}
                        existing_secrets.update(update.secrets)
                        updated_container["secrets"] = [
                            {"name": name, "valueFrom": value} for name, value in existing_secrets.items()
                        ]
                
                updated_containers.append(updated_container)
            
            new_td["containerDefinitions"] = updated_containers
        
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
        
        tags = new_td.get("tags", [])
        if tags:
            register_args["tags"] = tags
        
        register_args = {k: v for k, v in register_args.items() if v is not None}
        
        new_td_response = ecs.register_task_definition(**register_args)
        new_td_arn = new_td_response["taskDefinition"]["taskDefinitionArn"]
        
        update_response = ecs.update_service(
            cluster=data.cluster,
            service=data.service,
            taskDefinition=new_td_arn
        )
        
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

