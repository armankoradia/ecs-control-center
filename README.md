# ECS Control Center

A modern web application for managing Amazon ECS clusters, services, and tasks with AWS Access Key authentication.

## Features

- 🔐 **AWS Access Key Authentication** - Simple and secure credential-based authentication
- 📊 **Cluster Overview** - Monitor and manage ECS clusters with bulk deployment capabilities
- 🔄 **Smart Deployment** - Automatic handling of both numbered tags and "latest" tag deployments
- 📝 **Live & Historical Logs** - View container logs in real-time or query historical logs with timezone support
- 🚀 **Bulk Operations** - Deploy all services or restart services with "latest" tags
- 🌐 **Multi-Region Support** - Work across different AWS regions
- 📈 **Real-time Metrics** - Monitor cluster and service performance
- ⚙️ **Task Definition Editor** - Edit and update ECS task definitions with real-time validation
- 🎯 **Resource Management** - Flexible CPU/Memory allocation at task or container level
- 📋 **Deployment History & Rollback** - Track deployments and rollback to previous versions
- 🔄 **Auto Image Updates** - Automatically populate latest Docker images when available
- 🛡️ **Smart Validation** - Prevents invalid configurations and ensures proper resource allocation
- ⏰ **Timezone Support** - View logs in multiple timezones (UTC, EST, PST, IST, EET, etc.)

## Tech Stack

- **Frontend**: React 18, Tailwind CSS, Axios
- **Backend**: FastAPI, Python 3.9+
- **AWS Authentication**: AWS Access Key / Secret Key / Session Token
- **AWS Integration**: Boto3
- **Containerization**: Docker & Docker Compose

## Prerequisites

- Node.js 16+ and npm
- Python 3.9+
- Docker and Docker Compose
- AWS Account with ECS access
- AWS Access Key ID and Secret Access Key (with appropriate permissions)

## Quick Start

### 1. Clone the Repository

```bash
git clone <repository-url>
cd ecs-control-center
```

### 2. Environment Configuration

Create a `.env` file in the root directory if needed for custom API base URLs:

```bash
# Optional: Only needed if you want to customize API endpoints
# Create .env file
nano .env
```

**Example `.env` file (optional):**
```env
# Frontend Environment Variables (React requires REACT_APP_ prefix)
REACT_APP_API_BASE=http://localhost:8000
```

**Note:** 
- The `.env` file is optional for local development
- Default API base URL is `http://localhost:8000`
- For production, update `REACT_APP_API_BASE` to your production API URL
- The `.env` file is already in `.gitignore` so it won't be committed

### 3. Run the Application

```bash
docker-compose build && docker-compose up -d 
```

The application will be available at:
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000

## AWS Configuration

### 1. AWS Credentials

The application uses AWS Access Key authentication:

- **Access Key ID** (required) - Your AWS Access Key ID (starts with AKIA or ASIA)
- **Secret Access Key** (required) - Your AWS Secret Access Key
- **Session Token** (optional) - Required only for temporary credentials (ASIA keys)

**Security Note:** 
- Credentials are stored in browser `localStorage` (client-side only)
- Credentials are never stored on the server
- Each user session has isolated credentials
- See [SECURITY.md](SECURITY.md) for detailed security information

### 2. Required AWS Permissions

Your AWS credentials need the following permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecs:ListClusters",
        "ecs:ListServices",
        "ecs:ListTasks",
        "ecs:DescribeClusters",
        "ecs:DescribeServices",
        "ecs:DescribeTasks",
        "ecs:DescribeTaskDefinition",
        "ecs:RegisterTaskDefinition",
        "ecs:UpdateService",
        "ecs:StopTask",
        "ecr:DescribeRepositories",
        "ecr:DescribeImages",
        "ecr:GetAuthorizationToken",
        "ecr:BatchGetImage",
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams",
        "logs:GetLogEvents",
        "cloudwatch:GetMetricStatistics"
      ],
      "Resource": "*"
    }
  ]
}
```

**Additional Permissions for Task Definition Editor:**
- `ecs:RegisterTaskDefinition` - Create new task definition revisions
- `ecs:UpdateService` - Update services with new task definitions
- `ecr:DescribeRepositories` - List ECR repositories for image updates
- `ecr:DescribeImages` - Get image metadata for latest version detection
- `secretsmanager:GetSecretValue` - Access secrets for task definitions
- `secretsmanager:DescribeSecret` - Validate secret ARNs

## Usage

### 1. Authentication

1. **Start the application**
2. **Enter AWS Credentials**:
   - **Access Key ID**: Your AWS Access Key ID
   - **Secret Access Key**: Your AWS Secret Access Key
   - **Session Token** (optional): Required only for temporary credentials
3. **Click "Save Credentials"** to authenticate
4. **Select Region** - Choose the AWS region you want to work with

### 2. Using the Application

1. **Enter AWS Credentials** - Provide your Access Key ID, Secret Key, and optional Session Token
2. **Select Region** - Choose the AWS region
3. **Select Cluster** - Choose an ECS cluster from the dropdown
4. **Cluster Overview** - View all services and their status
5. **Bulk Operations** - Deploy all services or restart services with "latest" tags
6. **Individual Deployment** - Deploy or restart specific services
7. **Task Definition Editing** - Edit task definitions with advanced resource management
8. **Deployment History** - Track deployments and perform rollbacks
9. **View Metrics & Logs** - Monitor performance and access real-time or historical logs

#### Key Features

- **Simple Authentication**: Just enter your AWS credentials - no complex setup required
- **Smart Deployment Detection**: Automatically detects if services use numbered tags or "latest" tags
- **Bulk Operations**: "Deploy All" for services with numbered tags, "Restart All" for "latest" tag services
- **Progress Tracking**: Real-time status updates during bulk operations
- **Advanced Task Management**: Complete task definition editing with validation
- **Resource Flexibility**: Choose between task-level or container-level resource allocation
- **Deployment Control**: Track history and perform safe rollbacks
- **Historical Logs**: Query CloudWatch logs with custom time ranges and timezone support

## Deployment Features

### Smart ECR Image Handling

The application intelligently handles both types of ECR images:

- **Numbered Tags** (e.g., `v1.2.3`): Updates task definition with new image URI
- **Latest Tags** (e.g., `latest`): Stops running tasks to force ECS to pull the new image with updated digest

### Bulk Operations

- **Deploy All**: Deploys all services with numbered tag updates
- **Restart All**: Restarts all services using "latest" tags with available updates
- **Progress Tracking**: Real-time status updates with success/failure counts

## Logs Features

### Live Logs

- **Real-time Streaming**: View container logs as they're generated
- **WebSocket Connection**: Efficient real-time log streaming
- **Auto-refresh**: Configurable refresh intervals (1-60 seconds)
- **Download**: Export logs to a text file

### Historical Logs

- **Time Range Selection**: Quick ranges (1h, 2h, 6h, 12h, 24h) or custom date/time
- **CloudWatch Insights**: Uses CloudWatch Insights for efficient log querying
- **Timezone Support**: View logs in multiple timezones:
  - UTC (Coordinated Universal Time)
  - EST (Eastern Standard Time)
  - PST (Pacific Standard Time)
  - IST (Indian Standard Time)
  - EET (Eastern European Time)
  - And more...
- **Fallback Mechanism**: Automatically falls back to direct log stream queries if Insights fails

## Task Definition Editor

### Advanced Task Definition Management

The Task Definition Editor provides comprehensive control over ECS task definitions with intelligent validation and real-time updates.

#### Key Features

- **⚙️ Complete Task Definition Editing**: Modify CPU, Memory, Environment Variables, Secrets, and Docker Images
- **🎯 Flexible Resource Management**: Choose between task-level or container-level resource allocation
- **🔄 Auto Image Updates**: Automatically populate latest Docker image URIs when updates are available
- **🛡️ Smart Validation**: Ensures valid configurations and prevents deployment failures
- **📋 Real-time Deployment**: Updates task definitions and deploys changes immediately
- **📊 Deployment Status**: Live tracking of deployment progress and status

#### Resource Management Options

**Task-Level Resources:**
- Set CPU and Memory at the task level
- All containers share the allocated resources
- Suitable for simple single-container services

**Container-Level Resources:**
- Set CPU and Memory for individual containers
- Fine-grained control over resource allocation
- Uses `memoryReservation` for optimal container management
- Suitable for multi-container services

**Validation Rules:**
- At least one level (task or container) must specify CPU/Memory
- Prevents invalid configurations that would cause deployment failures
- Real-time validation with clear error messages

#### Usage Workflow

1. **Select Service**: Choose an ECS service from the Cluster Overview
2. **Open Task Details**: Click on the service to view detailed information
3. **Edit Task Definition**: Click "⚙️ Edit Task Definition" button
4. **Configure Resources**: 
   - Clear task-level values to use container-level resources
   - Or set container-level values while keeping task-level resources
5. **Update Images**: Latest available images are automatically populated
6. **Modify Environment**: Add/remove environment variables and secrets
7. **Deploy Changes**: Click "🚀 Update & Deploy" to apply changes
8. **Monitor Progress**: Watch real-time deployment status and progress

#### Advanced Features

**Auto Image Population:**
- When editing a service with available image updates, the latest image URI is automatically populated
- Visual indicators show which containers have update availability
- Users can easily update to the latest versions

**Secrets Management:**
- View existing AWS Secrets Manager ARNs
- Add new secrets with proper ARN format validation
- Remove secrets by clearing the fields

**Environment Variables:**
- Add/remove environment variables dynamically
- Proper key-value pair validation
- Support for both simple values and complex configurations

**Deployment Integration:**
- Seamless integration with ECS service updates
- Real-time deployment status tracking
- Automatic service refresh after successful deployment
- Error handling with clear feedback messages

## Deployment History & Rollback

### Track and Manage Deployments

The application provides comprehensive deployment tracking and rollback capabilities for better operational control.

#### Features

- **📋 Deployment History**: Track all deployments with timestamps and status
- **🔄 One-Click Rollback**: Rollback to previous task definition revisions
- **📊 Status Monitoring**: Real-time deployment status tracking
- **🎯 Selective Rollback**: Choose specific task definition revisions to rollback to

#### How It Works

1. **Automatic Tracking**: All deployments are automatically tracked in memory
2. **Status Updates**: Real-time monitoring of deployment progress (PENDING, IN_PROGRESS, COMPLETED, FAILED)
3. **Rollback Options**: Access rollback functionality from the deployment history
4. **Safe Rollback**: Validates task definition compatibility before rollback

#### Usage

1. **View History**: Access deployment history from the service details
2. **Monitor Status**: Track current deployment progress in real-time
3. **Rollback**: Click rollback button next to any previous deployment
4. **Confirm**: Confirm rollback to previous task definition revision

## Troubleshooting

### Common Issues

#### AWS Authentication Errors
- **Invalid Credentials**: Verify your Access Key ID and Secret Access Key are correct
- **Expired Credentials**: If using temporary credentials (ASIA keys), ensure the Session Token is provided and not expired
- **Insufficient Permissions**: Check that your AWS credentials have the required IAM permissions (see AWS Configuration section)
- **Region Issues**: Ensure the selected region is correct and accessible with your credentials
- **Network Errors**: If you see "Network Error", check that credentials are being sent correctly (they're sent in POST request bodies, not URL parameters)

#### Deployment Errors
- Check that the ECS service has the required IAM permissions
- Verify that the ECR repository exists and is accessible
- Ensure the task definition is valid

#### Task Definition Editor Issues
- **Validation Errors**: Ensure either task-level or container-level CPU/Memory is specified
- **Image Update Issues**: Verify ECR repository access and image tag availability
- **Secrets Management**: Check AWS Secrets Manager ARN format and permissions
- **Resource Allocation**: Ensure total container resources don't exceed task limits

#### Deployment History Issues
- **Missing History**: Deployment history is stored in memory and resets on application restart
- **Rollback Failures**: Verify that the target task definition revision still exists in AWS
- **Status Updates**: Check network connectivity for real-time status updates

## Production Deployment

The application is designed to run on AWS ECS with:
- Access Key authentication for AWS API access
- Load balancer for high availability
- HTTPS for secure credential transmission

### Prerequisites
- AWS CLI configured with appropriate permissions
- ECR repositories for storing Docker images
- ECS cluster (Fargate recommended)
- SSL/TLS certificate for HTTPS (required for secure credential transmission)

### Key ECS Features
- **Access Key Authentication**: Users provide their own AWS credentials
- **Multi-Container Task**: Both frontend and backend in single task
- **Fargate Compatible**: Serverless container execution
- **CloudWatch Logging**: Centralized logging
- **Stateless Backend**: No credential storage on the server

### Authentication for Production
- Users enter their AWS Access Key credentials directly in the web interface
- Credentials are stored only in browser `localStorage` (client-side)
- Backend never stores credentials - each request includes credentials in the request body
- HTTPS is required to protect credentials in transit

## Security Considerations

- **HTTPS Required**: Always use HTTPS in production to protect credentials in transit
- **AWS IAM**: Use least-privilege IAM policies for Access Keys
- **Credential Storage**: Credentials are stored in browser `localStorage` only (client-side)
- **Multi-User Isolation**: Each browser session has isolated credentials
- **No Server Storage**: Backend is stateless and never stores credentials
- **Session Tokens**: Temporary credentials (ASIA keys) require Session Tokens
- **Shared Computers**: Users should clear credentials when using shared computers
- **Environment Variables**: Never commit sensitive data to version control

For detailed security information, see [SECURITY.md](SECURITY.md).
