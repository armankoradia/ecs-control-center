"""Application settings and configuration."""

from botocore.config import Config

# Optimized boto3 config
BOTO3_CONFIG = Config(
    retries={'max_attempts': 3, 'mode': 'adaptive'},
    max_pool_connections=50
)

