"""AWS session and client utilities."""

from typing import Optional
import boto3
from fastapi import HTTPException
from botocore.exceptions import NoCredentialsError, ClientError
from config.settings import BOTO3_CONFIG


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

