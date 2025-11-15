"""Logs-related routes."""

from typing import Optional
import json
import asyncio
import time
from datetime import datetime
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from models.schemas import LogTargetRequest, HistoricalLogsRequest
from utils.aws import get_boto3_session
from config.settings import BOTO3_CONFIG

router = APIRouter()


def _get_log_target_impl(cluster: str, service: str, profile: Optional[str] = None, region: str = "us-east-1", auth_method: str = "access_key", aws_access_key_id: Optional[str] = None, aws_secret_access_key: Optional[str] = None, aws_session_token: Optional[str] = None):
    """Get CloudWatch log group and stream for a service"""
    try:
        session = get_boto3_session(profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)
        ecs = session.client("ecs", config=BOTO3_CONFIG)
        logs = session.client("logs", config=BOTO3_CONFIG)
        
        services_response = ecs.describe_services(cluster=cluster, services=[service])
        if not services_response.get("services"):
            return {"error": "Service not found"}
        
        tasks_response = ecs.list_tasks(cluster=cluster, serviceName=service)
        if not tasks_response.get("taskArns"):
            return {"error": "No tasks found for this service"}
        
        tasks_details = ecs.describe_tasks(cluster=cluster, tasks=tasks_response["taskArns"][:1])
        if not tasks_details.get("tasks"):
            return {"error": "No task details found"}
        
        task = tasks_details["tasks"][0]
        task_definition_arn = task.get("taskDefinitionArn")
        
        if not task_definition_arn:
            return {"error": "No task definition found for tasks"}
        
        td_response = ecs.describe_task_definition(taskDefinition=task_definition_arn)
        task_definition = td_response.get("taskDefinition", {})
        
        log_group = None
        for container in task_definition.get("containerDefinitions", []):
            log_config = container.get("logConfiguration", {})
            if log_config.get("logDriver") == "awslogs":
                options = log_config.get("options", {})
                log_group = options.get("awslogs-group")
                break
        
        if not log_group:
            return {"error": "No CloudWatch logs configured for this service"}
        
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


@router.post("/log-target")
def get_log_target_post(request: LogTargetRequest):
    """Get log target for a service (POST version)"""
    return _get_log_target_impl(
        request.cluster, request.service, request.profile, request.region, request.auth_method,
        request.aws_access_key_id, request.aws_secret_access_key, request.aws_session_token
    )


@router.get("/log-target")
def get_log_target(cluster: str, service: str, profile: Optional[str] = None, region: str = "us-east-1", auth_method: str = "access_key", aws_access_key_id: Optional[str] = None, aws_secret_access_key: Optional[str] = None, aws_session_token: Optional[str] = None):
    """Get log target for a service (GET version for backward compatibility)"""
    return _get_log_target_impl(cluster, service, profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)


@router.websocket("/ws/logs")
async def websocket_logs(websocket: WebSocket):
    """WebSocket endpoint for streaming CloudWatch logs"""
    await websocket.accept()
    
    try:
        query_params = websocket.query_params
        log_group = query_params.get("log_group")
        log_stream = query_params.get("log_stream")
        profile = query_params.get("profile", None)
        region = query_params.get("region", "us-east-1")
        auth_method = query_params.get("auth_method", "access_key")
        aws_access_key_id = query_params.get("aws_access_key_id")
        aws_secret_access_key = query_params.get("aws_secret_access_key")
        aws_session_token = query_params.get("aws_session_token")
        interval = int(query_params.get("interval", 3))
        
        if not log_group or not log_stream:
            await websocket.send_text(json.dumps({"error": "Missing log_group or log_stream parameter"}))
            await websocket.close()
            return
        
        session = get_boto3_session(
            profile,
            region,
            auth_method,
            aws_access_key_id,
            aws_secret_access_key,
            aws_session_token,
        )
        logs = session.client("logs", config=BOTO3_CONFIG)
        
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
        
        last_token = None
        while True:
            try:
                params = {
                    "logGroupName": log_group,
                    "logStreamName": log_stream,
                    "startFromHead": False,
                    "limit": 10
                }
                if last_token is not None:
                    params["nextToken"] = last_token
                
                response = logs.get_log_events(**params)
                
                events = response.get("events", [])
                
                if events:
                    last_token = response.get("nextForwardToken")
                    
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


def _get_historical_logs_impl(
    cluster: str,
    service: str,
    start_time: str = None,
    end_time: str = None,
    limit: int = 1000,
    profile: Optional[str] = None,
    region: str = "us-east-1",
    auth_method: str = "access_key",
    aws_access_key_id: Optional[str] = None,
    aws_secret_access_key: Optional[str] = None,
    aws_session_token: Optional[str] = None
):
    """Get historical CloudWatch logs using CloudWatch Insights (like ECS Console)"""
    try:
        session = get_boto3_session(profile, region, auth_method, aws_access_key_id, aws_secret_access_key, aws_session_token)
        logs = session.client("logs", config=BOTO3_CONFIG)
        ecs = session.client("ecs", config=BOTO3_CONFIG)
        
        try:
            svc_response = ecs.describe_services(cluster=cluster, services=[service])
            if not svc_response["services"]:
                raise HTTPException(status_code=404, detail="Service not found")
            
            service_info = svc_response["services"][0]
            current_td_arn = service_info.get("taskDefinition")
            
            if not current_td_arn:
                raise HTTPException(status_code=404, detail="No task definition found for service")
            
            td_response = ecs.describe_task_definition(taskDefinition=current_td_arn)
            task_definition = td_response.get("taskDefinition", {})
            
            log_group = None
            for container in task_definition.get("containerDefinitions", []):
                log_config = container.get("logConfiguration")
                if log_config and log_config.get("logDriver") == "awslogs":
                    log_group = log_config.get("options", {}).get("awslogs-group")
                    if log_group:
                        break
            
            if not log_group:
                raise HTTPException(status_code=404, detail="No CloudWatch logs configured for this service")
            
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to get service log configuration: {str(e)}")
        
        start_timestamp = None
        end_timestamp = None
        
        try:
            if start_time:
                if start_time.endswith('Z'):
                    start_time = start_time.replace('Z', '+00:00')
                start_timestamp = int(datetime.fromisoformat(start_time).timestamp() * 1000)
            if end_time:
                if end_time.endswith('Z'):
                    end_time = end_time.replace('Z', '+00:00')
                end_timestamp = int(datetime.fromisoformat(end_time).timestamp() * 1000)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"Invalid timestamp format: {str(e)}")
        
        if not start_timestamp and not end_timestamp:
            end_timestamp = int(datetime.now().timestamp() * 1000)
            start_timestamp = end_timestamp - (3600 * 1000)
        elif not start_timestamp:
            start_timestamp = end_timestamp - (3600 * 1000)
        elif not end_timestamp:
            end_timestamp = start_timestamp + (3600 * 1000)
        
        # Use the user's limit parameter, but cap at CloudWatch Insights max (10,000)
        # CloudWatch Insights has a maximum of 10,000 results per query
        insights_limit = min(limit, 10000)
        query_string = f"""
        fields @timestamp, @message
        | filter @message != ""
        | sort @timestamp desc
        | limit {insights_limit}
        """
        
        try:
            start_query_params = {
                "logGroupName": log_group,
                "startTime": start_timestamp,
                "endTime": end_timestamp,
                "queryString": query_string
            }
            
            query_response = logs.start_query(**start_query_params)
            query_id = query_response["queryId"]
            
            max_attempts = 30  # Increased timeout for larger queries
            attempt = 0
            
            while attempt < max_attempts:
                results_response = logs.get_query_results(queryId=query_id)
                status = results_response["status"]
                
                if status == "Complete":
                    break
                elif status == "Failed":
                    raise Exception("CloudWatch Insights query failed")
                
                time.sleep(1)
                attempt += 1
            
            if attempt >= max_attempts:
                raise Exception("CloudWatch Insights query timeout")
            
            # CloudWatch Insights returns all results at once (up to the limit in the query)
            # No pagination needed - the query limit handles it
            results = results_response.get("results", [])
            
            formatted_logs = []
            
            for result in results:
                timestamp_value = None
                message_value = None
                
                for field in result:
                    field_name = field.get("field", "")
                    field_value = field.get("value", "")
                    
                    if field_name == "@timestamp":
                        timestamp_value = field_value
                    elif field_name == "@message":
                        message_value = field_value
                
                if message_value:
                    timestamp_ms = 0
                    if timestamp_value:
                        try:
                            if isinstance(timestamp_value, (int, float)):
                                timestamp_ms = int(timestamp_value)
                            else:
                                dt = datetime.fromisoformat(timestamp_value.replace('Z', '+00:00'))
                                timestamp_ms = int(dt.timestamp() * 1000)
                        except:
                            pass
                    
                    formatted_time = timestamp_value.split('.')[0] if timestamp_value and '.' in timestamp_value else timestamp_value
                    formatted_logs.append({
                        "message": message_value,
                        "timestamp": timestamp_ms,
                        "formatted_time": formatted_time or datetime.fromtimestamp(timestamp_ms/1000).strftime('%Y-%m-%d %H:%M:%S') if timestamp_ms else ""
                    })
            
            # Apply user's limit if it's less than what we got
            if len(formatted_logs) > limit:
                formatted_logs = formatted_logs[:limit]
            
            return {
                "logs": formatted_logs,
                "total": len(formatted_logs),
                "log_group": log_group,
                "query_id": query_id,
                "method": "cloudwatch_insights"
            }
            
        except Exception as insights_error:
            # Fallback to log streams method
            try:
                # Paginate through ALL log streams that have events in the time range
                all_streams = []
                next_token = None
                max_streams_to_check = 100  # Reasonable limit to prevent excessive API calls
                
                while len(all_streams) < max_streams_to_check:
                    if next_token:
                        streams_response = logs.describe_log_streams(
                            logGroupName=log_group,
                            orderBy="LastEventTime",
                            descending=True,
                            limit=50,  # Get more streams per request
                            nextToken=next_token
                        )
                    else:
                        streams_response = logs.describe_log_streams(
                            logGroupName=log_group,
                            orderBy="LastEventTime",
                            descending=True,
                            limit=50
                        )
                    
                    streams = streams_response.get("logStreams", [])
                    
                    # Filter streams that have events in our time range
                    for stream in streams:
                        last_event_time = stream.get("lastEventTimestamp", 0)
                        first_event_time = stream.get("firstEventTimestamp", 0)
                        
                        # Stream has events in range if it overlaps with our time range
                        if not (last_event_time < start_timestamp or first_event_time > end_timestamp):
                            all_streams.append(stream)
                    
                    next_token = streams_response.get("nextToken")
                    if not next_token:
                        break
                
                all_logs = []
                
                # Process each stream with pagination to get ALL events in time range
                for stream in all_streams:
                    stream_name = stream["logStreamName"]
                    last_event_time = stream.get("lastEventTimestamp", 0)
                    first_event_time = stream.get("firstEventTimestamp", 0)
                    
                    time_range_span = end_timestamp - start_timestamp
                    mid_point = start_timestamp + (time_range_span / 2)
                    start_from_head = (mid_point - first_event_time) < (last_event_time - mid_point)
                    
                    # Paginate through all events in this stream within the time range
                    stream_next_token = None
                    stream_events_collected = 0
                    max_events_per_stream = 10000  # Reasonable limit per stream
                    events_in_range_found = False
                    
                    while stream_events_collected < max_events_per_stream:
                        try:
                            # Build request parameters
                            request_params = {
                                "logGroupName": log_group,
                                "logStreamName": stream_name,
                                "startFromHead": start_from_head,
                                "limit": 10000  # Get more events per request
                            }
                            
                            # Add time range if supported
                            try:
                                request_params["startTime"] = start_timestamp
                                request_params["endTime"] = end_timestamp
                            except:
                                pass  # Some AWS SDK versions may not support these
                            
                            # Add pagination token if we have one
                            if stream_next_token:
                                request_params["nextToken"] = stream_next_token
                            
                            events_response = logs.get_log_events(**request_params)
                            
                        except Exception as e:
                            # If startTime/endTime not supported, try without them
                            try:
                                request_params = {
                                    "logGroupName": log_group,
                                    "logStreamName": stream_name,
                                    "startFromHead": start_from_head,
                                    "limit": 10000
                                }
                                if stream_next_token:
                                    request_params["nextToken"] = stream_next_token
                                events_response = logs.get_log_events(**request_params)
                            except Exception as e2:
                                # Skip this stream if we can't get events
                                break
                        
                        stream_logs = events_response.get("events", [])
                        if not stream_logs:
                            break
                        
                        filtered_events = []
                        for event in stream_logs:
                            message = event.get("message", "")
                            timestamp = event.get("timestamp", 0)
                            
                            # Filter by time range (in case API didn't filter properly)
                            if timestamp < start_timestamp or timestamp > end_timestamp:
                                continue
                            
                            events_in_range_found = True
                            
                            if message:
                                formatted_time = datetime.fromtimestamp(timestamp / 1000).strftime('%Y-%m-%d %H:%M:%S')
                                
                                filtered_events.append({
                                    "message": message,
                                    "timestamp": timestamp,
                                    "formatted_time": formatted_time
                                })
                        
                        all_logs.extend(filtered_events)
                        stream_events_collected += len(stream_logs)
                        
                        # Get next token for pagination
                        stream_next_token = events_response.get("nextForwardToken")
                        if not stream_next_token:
                            break
                        
                        # If we're going backwards and hit events outside our range, we're done
                        # If we're going forwards and hit events outside our range, we're done
                        if events_in_range_found:
                            # Check if we've gone past our time range
                            if start_from_head:
                                # Going forward - if last event is past end_time, we're done
                                if stream_logs and stream_logs[-1].get("timestamp", 0) > end_timestamp:
                                    break
                            else:
                                # Going backward - if last event is before start_time, we're done
                                if stream_logs and stream_logs[-1].get("timestamp", 0) < start_timestamp:
                                    break
                        
                        # Stop if we've collected enough logs (respecting user's limit)
                        if len(all_logs) >= limit * 2:  # Collect a bit more for sorting, then trim
                            break
                    
                    # Stop processing more streams if we have enough logs
                    if len(all_logs) >= limit * 2:
                        break
                
                # Sort by timestamp descending and apply user's limit
                all_logs.sort(key=lambda x: x["timestamp"], reverse=True)
                all_logs = all_logs[:limit]
                
                return {
                    "logs": all_logs,
                    "total": len(all_logs),
                    "log_group": log_group,
                    "method": "log_streams",
                    "streams_checked": len(all_streams)
                }
                
            except Exception as stream_error:
                raise HTTPException(status_code=500, detail=f"Both CloudWatch Insights and log streams failed: {str(stream_error)}")
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get historical logs: {str(e)}")


@router.post("/historical_logs")
def get_historical_logs_post(request: HistoricalLogsRequest):
    """Get historical CloudWatch logs (POST version)"""
    return _get_historical_logs_impl(
        request.cluster, request.service, request.start_time, request.end_time,
        request.limit, request.profile, request.region, request.auth_method,
        request.aws_access_key_id, request.aws_secret_access_key, request.aws_session_token
    )


@router.get("/historical_logs")
def get_historical_logs(
    cluster: str,
    service: str,
    start_time: str = None,
    end_time: str = None,
    limit: int = 1000,
    profile: Optional[str] = None,
    region: str = "us-east-1",
    auth_method: str = "access_key",
    aws_access_key_id: Optional[str] = None,
    aws_secret_access_key: Optional[str] = None,
    aws_session_token: Optional[str] = None
):
    """Get historical CloudWatch logs (GET version for backward compatibility)"""
    return _get_historical_logs_impl(
        cluster, service, start_time, end_time, limit, profile, region, auth_method,
        aws_access_key_id, aws_secret_access_key, aws_session_token
    )