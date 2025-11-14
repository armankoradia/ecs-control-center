"""Pydantic schemas for API requests."""

from pydantic import BaseModel
from typing import Optional, List, Dict


class BaseAWSRequest(BaseModel):
    """Base request model with common AWS authentication fields."""
    profile: Optional[str] = None
    region: str = "us-east-1"
    auth_method: str = "access_key"
    aws_access_key_id: Optional[str] = None
    aws_secret_access_key: Optional[str] = None
    aws_session_token: Optional[str] = None


class DeployRequest(BaseAWSRequest):
    """Request model for deploying a new image."""
    cluster: str
    service: str
    container_name: Optional[str] = None


class ContainerUpdate(BaseModel):
    """Model for updating container configuration."""
    container_name: str
    cpu: Optional[int] = None
    memory: Optional[int] = None  # This will be used as memoryReservation for containers
    image: Optional[str] = None
    environment_variables: Optional[Dict[str, str]] = None
    secrets: Optional[Dict[str, str]] = None


class TaskDefinitionUpdate(BaseAWSRequest):
    """Request model for updating task definition."""
    cluster: str
    service: str
    container_updates: List[ContainerUpdate] = []
    cpu: Optional[str] = None
    memory: Optional[str] = None


class DeploymentHistoryRequest(BaseAWSRequest):
    """Request model for getting deployment history."""
    cluster: Optional[str] = None
    service: Optional[str] = None
    limit: int = 50


class RefreshDeploymentRequest(BaseAWSRequest):
    """Request model for refreshing deployment status."""
    pass


class RollbackRequest(BaseAWSRequest):
    """Request model for rolling back a deployment."""
    pass


class TaskDefinitionRequest(BaseAWSRequest):
    """Request model for getting task definition."""
    cluster: str
    service: str


class ServiceImageInfoRequest(BaseAWSRequest):
    """Request model for getting service image information."""
    cluster: str
    service: str


class ClustersRequest(BaseAWSRequest):
    """Request model for listing clusters."""
    pass


class ServicesRequest(BaseAWSRequest):
    """Request model for listing services."""
    cluster: str


class TasksRequest(BaseAWSRequest):
    """Request model for listing tasks."""
    cluster: str
    service: str


class TaskDetailsRequest(BaseAWSRequest):
    """Request model for getting task details."""
    cluster: str
    service: str


class ClusterOverviewRequest(BaseAWSRequest):
    """Request model for getting cluster overview."""
    cluster: str


class DeploymentStatusRequest(BaseAWSRequest):
    """Request model for getting deployment status."""
    cluster: str
    service: str


class TaskCountRequest(BaseAWSRequest):
    """Request model for getting task count."""
    cluster: str
    service: Optional[str] = None


class AuthTestRequest(BaseAWSRequest):
    """Request model for testing authentication."""
    pass


class LogTargetRequest(BaseAWSRequest):
    """Request model for getting log target."""
    cluster: str
    service: str


class HistoricalLogsRequest(BaseAWSRequest):
    """Request model for getting historical logs."""
    cluster: str
    service: str
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    limit: int = 1000


class UpdateTaskCountRequest(BaseAWSRequest):
    """Request model for updating task count."""
    cluster: str
    service: str
    desired_count: int


class ForceNewDeploymentRequest(BaseAWSRequest):
    """Request model for forcing a new deployment."""
    cluster: str
    service: str


class ServiceEventsRequest(BaseAWSRequest):
    """Request model for getting service events."""
    cluster: str
    service: str

