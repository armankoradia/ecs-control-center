"""DynamoDB helper for persistent deployment history."""

import json
import logging
import os
from datetime import datetime, timedelta

import boto3
from botocore.exceptions import ClientError

from config.settings import HISTORY_AWS_REGION

logger = logging.getLogger(__name__)

# Lazy singleton — credentials come from the ECS Task Role automatically
_resource = None
_table = None


def _get_table():
    global _resource, _table
    if _table is not None:
        return _table
    from config.settings import HISTORY_TABLE_NAME
    _resource = boto3.resource("dynamodb", region_name=HISTORY_AWS_REGION)
    _table = _resource.Table(HISTORY_TABLE_NAME)
    return _table


def ensure_table() -> bool:
    """Create the history table if it doesn't exist. Returns True on success."""
    from config.settings import HISTORY_TABLE_NAME
    try:
        db = boto3.resource("dynamodb", region_name=HISTORY_AWS_REGION)
        db.create_table(
            TableName=HISTORY_TABLE_NAME,
            KeySchema=[
                {"AttributeName": "pk",  "KeyType": "HASH"},
                {"AttributeName": "sk",  "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": "pk",  "AttributeType": "S"},
                {"AttributeName": "sk",  "AttributeType": "S"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        # Wait until the table is active
        db.meta.client.get_waiter("table_exists").wait(
            TableName=HISTORY_TABLE_NAME,
            WaiterConfig={"Delay": 2, "MaxAttempts": 15},
        )
        # Enable TTL for automatic 14-day cleanup
        db.meta.client.update_time_to_live(
            TableName=HISTORY_TABLE_NAME,
            TimeToLiveSpecification={"Enabled": True, "AttributeName": "ttl"},
        )
        logger.info("DynamoDB table '%s' created.", HISTORY_TABLE_NAME)
        return True
    except ClientError as e:
        code = e.response["Error"]["Code"]
        if code in ("ResourceInUseException", "ResourceNotFoundException"):
            # Table already exists — that's fine
            return True
        logger.warning("Could not create DynamoDB table: %s", e)
        return False
    except Exception as e:
        logger.warning("DynamoDB table init failed: %s", e)
        return False


def write_history(entry: dict) -> None:
    """
    Persist a history entry. Never raises — a DynamoDB failure must not
    block the deployment that triggered it.

    Table schema:
      pk (S) = "HISTORY"
      sk (S) = deployment_id   ← allows direct Get/Update by id
      timestamp (S)            ← ISO-8601 UTC; used for client-side sorting
      ttl (N)                  ← Unix epoch 14 days out; DynamoDB auto-deletes
    """
    try:
        item = {
            "pk": "HISTORY",
            "sk": entry.get("deployment_id", "unknown"),
            "ttl": int((datetime.utcnow() + timedelta(days=14)).timestamp()),
        }
        for k, v in entry.items():
            if v is None:
                continue
            # DynamoDB doesn't accept Python dicts/lists directly in put_item
            # when mixed with Decimal; serialize complex nested values to JSON.
            if isinstance(v, (dict, list)):
                item[k] = json.dumps(v)
            else:
                item[k] = v

        _get_table().put_item(Item=item)
    except Exception as e:
        logger.warning("Failed to write history to DynamoDB: %s", e)


def update_history_status(deployment_id: str, status: str, extra: dict = None) -> None:
    """Update status (and optional extra fields) for a history entry."""
    try:
        updates = {"#status": status}
        if extra:
            updates.update({f"#{k}": v for k, v in extra.items()})

        expr_names  = {f"#{k}": k for k in (["status"] + list((extra or {}).keys()))}
        expr_values = {f":{k}": v for k, v in ({"status": status} | (extra or {})).items()}
        update_expr = "SET " + ", ".join(f"#{k} = :{k}" for k in (["status"] + list((extra or {}).keys())))

        _get_table().update_item(
            Key={"pk": "HISTORY", "sk": deployment_id},
            UpdateExpression=update_expr,
            ExpressionAttributeNames=expr_names,
            ExpressionAttributeValues=expr_values,
        )
    except Exception as e:
        logger.warning("Failed to update history status in DynamoDB: %s", e)


def get_history_item(deployment_id: str) -> dict | None:
    """Fetch a single history record by deployment_id."""
    try:
        resp = _get_table().get_item(Key={"pk": "HISTORY", "sk": deployment_id})
        item = resp.get("Item")
        if item:
            _deserialize(item)
        return item
    except Exception as e:
        logger.warning("Failed to get history item from DynamoDB: %s", e)
        return None


def list_history(limit: int = 100, cluster: str = None, service: str = None) -> list:
    """
    Return history records newest-first.
    Uses a full table Scan (fine at the scale of an internal tool).
    Client-side filters by cluster/service when provided.
    """
    try:
        from boto3.dynamodb.conditions import Key
        # Query all items for pk="HISTORY" — most efficient access pattern
        kwargs: dict = {
            "KeyConditionExpression": Key("pk").eq("HISTORY"),
            # Fetch more than we need to allow client-side filtering
            "Limit": max(limit * 5, 500),
            "ScanIndexForward": False,  # newest sk last — we sort by timestamp below
        }
        resp = _get_table().query(**kwargs)
        items = resp.get("Items", [])

        # Client-side filtering
        if cluster:
            items = [i for i in items if i.get("cluster") == cluster]
        if service:
            items = [i for i in items if i.get("service") == service]

        # Sort newest-first by timestamp
        items.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
        items = items[:limit]

        for item in items:
            _deserialize(item)

        return items
    except Exception as e:
        logger.warning("Failed to list history from DynamoDB: %s", e)
        return []


def _deserialize(item: dict) -> None:
    """In-place: parse any JSON-serialized fields back to Python objects."""
    for key in ("details", "changes"):
        if key in item and isinstance(item[key], str):
            try:
                item[key] = json.loads(item[key])
            except Exception:
                pass
    # Remove internal DynamoDB keys from API responses
    item.pop("pk", None)
    item.pop("sk", None)
    item.pop("ttl", None)
