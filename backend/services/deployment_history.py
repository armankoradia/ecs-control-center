"""Deployment history service — backed by DynamoDB for persistence across restarts."""

import time
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from utils.aws import get_boto3_session
from utils.dynamo import (
    get_history_item,
    list_history,
    update_history_status,
    write_history,
)
from config.settings import BOTO3_CONFIG


def save_deployment_history(deployment_data: Dict[str, Any]) -> str:
    """Persist a deployment event and return its deployment_id."""
    deployment_id = deployment_data.get("deployment_id", f"deploy-{int(time.time())}")

    entry = {
        "deployment_id": deployment_id,
        "timestamp": datetime.utcnow().isoformat(),
        "cluster": deployment_data.get("cluster"),
        "service": deployment_data.get("service"),
        "region": deployment_data.get("region"),
        "deployment_type": deployment_data.get("deployment_type"),
        "action_type": deployment_data.get("action_type", deployment_data.get("deployment_type")),
        "status": "IN_PROGRESS",
        "message": deployment_data.get("message"),
        "service_arn": deployment_data.get("service_arn"),
        "new_task_definition": deployment_data.get("new_task_definition"),
        "username": deployment_data.get("username", "unknown"),
        "email": deployment_data.get("email", "unknown"),
        "details": deployment_data.get("details"),
    }

    write_history(entry)
    return deployment_id


def update_deployment_status(
    deployment_id: str,
    profile: str,
    region: str,
    auth_method: str,
    aws_access_key_id: Optional[str] = None,
    aws_secret_access_key: Optional[str] = None,
    aws_session_token: Optional[str] = None,
):
    """Poll ECS and update the deployment status in DynamoDB."""
    try:
        item = get_history_item(deployment_id)
        if not item:
            return

        cluster = item.get("cluster")
        service = item.get("service")
        action_type = item.get("action_type") or item.get("deployment_type", "")

        if not cluster or not service:
            return

        # global_deploy records have no single service/cluster to poll — mark COMPLETED.
        if cluster == "MULTI-CLUSTER" or action_type == "global_deploy":
            update_history_status(deployment_id, "COMPLETED", {
                "last_checked_at": datetime.utcnow().isoformat(),
            })
            return

        # Always use the region the deployment was actually made in, not the
        # region the user happens to have selected when viewing history.
        effective_region = item.get("region") or region

        session = get_boto3_session(
            profile, effective_region, auth_method,
            aws_access_key_id, aws_secret_access_key, aws_session_token,
        )
        ecs = session.client("ecs", config=BOTO3_CONFIG)

        try:
            svc_response = ecs.describe_services(cluster=cluster, services=[service])
        except Exception as e:
            if item.get("status") != "COMPLETED":
                update_history_status(deployment_id, "UNKNOWN", {"status_error": str(e)})
            return

        if not svc_response.get("services"):
            if item.get("status") not in ("COMPLETED", "FAILED"):
                update_history_status(deployment_id, "UNKNOWN", {"status_error": "Service not found"})
            return

        svc = svc_response["services"][0]
        running_count = svc.get("runningCount", 0)
        desired_count = svc.get("desiredCount", 0)
        pending_count = svc.get("pendingCount", 0)

        primary = next(
            (d for d in svc.get("deployments", []) if d.get("status") == "PRIMARY"),
            None,
        )

        if primary:
            rollout = primary.get("rolloutState", "")
            if rollout == "FAILED":
                new_status = "FAILED"
            elif rollout == "COMPLETED":
                new_status = "COMPLETED"
            elif rollout in ("IN_PROGRESS", "PENDING", "STARTED"):
                new_status = "IN_PROGRESS"
            else:
                new_status = "COMPLETED" if running_count >= desired_count > 0 else "IN_PROGRESS"
        else:
            if running_count == 0:
                new_status = "PENDING"
            elif running_count < desired_count or pending_count > 0:
                new_status = "IN_PROGRESS"
            else:
                new_status = "COMPLETED"

        update_history_status(deployment_id, new_status, {
            "running_count": running_count,
            "desired_count": desired_count,
            "pending_count": pending_count,
            "last_checked_at": datetime.utcnow().isoformat(),
        })

    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("update_deployment_status error: %s", e)


def get_deployment_history(
    cluster: str = None,
    service: str = None,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    """Return history records (newest first), optionally filtered."""
    return list_history(limit=limit, cluster=cluster, service=service)
