"""Authentication routes - Okta removed for open source version."""

from typing import Optional
from fastapi import APIRouter, Header, HTTPException
from models.schemas import AuthTestRequest
from utils.aws import get_boto3_session
from config.settings import BOTO3_CONFIG

router = APIRouter()


@router.get("/auth_status")
async def auth_status(authorization: str = Header(None)):
    """Check authentication status - Okta removed for open source version"""
    # In the open source version, authentication is handled by AWS credentials only
    # This endpoint is kept for API compatibility
    if not authorization:
        return {"authenticated": False, "error": "No authorization header", "note": "Okta SSO removed - using AWS credentials only"}
    
    # Return a basic response for compatibility
    return {
        "authenticated": True, 
        "user": "aws-credentials",
        "issuer": "local",
        "expires": None,
        "note": "Okta SSO removed - using AWS credentials only"
    }


def _test_authentication_impl(
    profile: Optional[str] = None,
    region: str = "us-east-1",
    auth_method: str = "access_key",
    aws_access_key_id: Optional[str] = None,
    aws_secret_access_key: Optional[str] = None,
    aws_session_token: Optional[str] = None,
):
    """Test authentication method"""
    try:
        session = get_boto3_session(profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)
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


@router.post("/auth_test")
def test_authentication_post(request: AuthTestRequest):
    """Test authentication (POST version)"""
    return _test_authentication_impl(
        request.profile, request.region, request.auth_method,
        request.aws_access_key_id, request.aws_secret_access_key, request.aws_session_token
    )


@router.get("/auth_test")
def test_authentication(
    profile: Optional[str] = None,
    region: str = "us-east-1",
    auth_method: str = "access_key",
    aws_access_key_id: Optional[str] = None,
    aws_secret_access_key: Optional[str] = None,
    aws_session_token: Optional[str] = None,
):
    """Test authentication (GET version for backward compatibility)"""
    return _test_authentication_impl(profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)

