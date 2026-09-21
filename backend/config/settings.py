"""Application settings and configuration."""

import os
from botocore.config import Config

# Optimized boto3 config
BOTO3_CONFIG = Config(
    retries={'max_attempts': 3, 'mode': 'adaptive'},
    max_pool_connections=50
)

# Dynatrace configuration (optional - log queries just report "not configured" if unset)
DYNATRACE_ENV_URL = os.getenv('DYNATRACE_ENV_URL', '').strip()
# For classic tenants: an API token (dt0s01.*) used with "Api-Token" header.
# For Grail tenants: an OAuth client secret (dt0c01.*) exchanged for a Bearer token.
DYNATRACE_API_TOKEN = os.getenv('DYNATRACE_API_TOKEN', '').strip()
DYNATRACE_CLIENT_ID = os.getenv('DYNATRACE_CLIENT_ID', '').strip()
# Optional: urn:dtaccount:<account-uuid> — required by some Dynatrace Platform tenants.
# Find it in Account Management → the UUID in the URL: account.dynatrace.com/a/<uuid>/...
DYNATRACE_ACCOUNT_URN = os.getenv('DYNATRACE_ACCOUNT_URN', '').strip()
# DYNATRACE_SSO_URL can be overridden for managed/dedicated SSO endpoints.
DYNATRACE_SSO_URL = os.getenv('DYNATRACE_SSO_URL', 'https://sso.dynatrace.com/sso/oauth2/token').strip()
# Optional prefix used when matching a Dynatrace host-group by tenant name
# (dt.host_group.id), e.g. "MYORG.ECS." if your host groups are named
# "MYORG.ECS.<tenant>". Leave unset to match on the tenant name alone.
DYNATRACE_HOSTGROUP_PREFIX = os.getenv('DYNATRACE_HOSTGROUP_PREFIX', '').strip()
# Optional leading/trailing segment stripped from the ECS cluster name to
# derive the "tenant" used in the Hostgroup filter above, e.g. with prefix
# "myorg" and suffix "cluster", cluster "myorg-acme-cluster" -> tenant
# "acme". Leave either unset to skip stripping that side. Only relevant if
# you use the Hostgroup filter — Container ID / Image URI don't need this.
DYNATRACE_TENANT_CLUSTER_PREFIX = os.getenv('DYNATRACE_TENANT_CLUSTER_PREFIX', '').strip()
DYNATRACE_TENANT_CLUSTER_SUFFIX = os.getenv('DYNATRACE_TENANT_CLUSTER_SUFFIX', '').strip()

# DynamoDB — persistent deployment history
# The table is auto-created on backend startup if it doesn't exist.
HISTORY_TABLE_NAME = os.getenv('HISTORY_TABLE_NAME', 'ecs-control-center-history')
HISTORY_AWS_REGION = os.getenv('HISTORY_AWS_REGION', 'us-east-1')

