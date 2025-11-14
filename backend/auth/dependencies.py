"""Authentication dependencies - Okta removed for open source version."""

from fastapi import HTTPException, Header

# Okta JWT verification removed for open source version
# jwt_verifier is not available in this branch

async def verify_token(authorization: str = Header(None)):
    """Token verification stub - Okta removed for open source version"""
    # In the open source version, authentication is handled by AWS credentials only
    # This function is kept for API compatibility but does not verify tokens
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header missing")
    
    # Return a basic claims structure for compatibility
    # In production, implement your own authentication mechanism here
    return {"sub": "anonymous", "iss": "local", "exp": None}

