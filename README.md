# ECS Explorer 🚀

A modern, high-performance web application for managing and monitoring AWS ECS (Elastic Container Service) clusters, services, and tasks. Built with React and FastAPI, it provides an intuitive interface for deploying containerized applications and monitoring their health.

## ✨ Features

### 🔐 **Dual Authentication Support**
- **AWS Profile**: For local development with AWS CLI configured profiles
- **IAM Role**: For AWS deployments (EC2, ECS, Lambda) with attached IAM roles
- **Real-time Authentication Testing**: Verify credentials with detailed identity information

### 📊 **Cluster Management**
- **Cluster Overview**: High-level view of all services in a cluster
- **Service Status**: Monitor running, stopped, and failed services
- **Update Detection**: Automatically detect when new container images are available
- **Bulk Operations**: Deploy multiple services simultaneously

### 🐳 **Container Operations**
- **Image Management**: View current and latest container image versions
- **Smart Deployment**: Intelligent deployment based on image tagging strategy
  - **Versioned Tags**: Update task definitions for semantic versioned images
  - **Latest Tags**: Restart tasks to pull latest images automatically
- **ECR Integration**: Seamless integration with Amazon Elastic Container Registry
- **Image Digest Comparison**: Accurate update detection using image digests for "latest" tags
- **One-Click Deployment**: Deploy latest images from ECR with a single click
- **Task Monitoring**: Real-time task status and health monitoring
- **Stopped Task Analysis**: View detailed information about failed tasks

### 🚀 **Deployment Features**
- **Smart Deployment Strategy**: 
  - **Versioned Images**: Full task definition updates with new image versions
  - **Latest Tag Images**: Efficient task restart for automatic latest image pulling
- **Bulk Operations**: Deploy or restart multiple services simultaneously
- **Step-by-Step Tracking**: Visual deployment progress with 4-stage tracking
- **Real-time Status**: Live updates on deployment progress
- **Error Handling**: Detailed error messages and troubleshooting information
- **Rollback Support**: Easy rollback to previous task definitions

### 🎨 **Modern UI/UX**
- **Dark/Light Mode**: Toggle between themes for better user experience
- **Responsive Design**: Works seamlessly on desktop and mobile devices
- **Intuitive Interface**: Clean, modern design with collapsible sections
- **Performance Optimized**: Caching and lazy loading for fast interactions

## 🛠️ Tech Stack

### **Backend**
- **FastAPI**: Modern, fast web framework for building APIs
- **Python 3.11**: Latest Python version for optimal performance
- **Boto3**: AWS SDK for Python for ECS/ECR integration
- **Pydantic**: Data validation and settings management
- **Uvicorn**: ASGI server for production deployment

### **Frontend**
- **React 18**: Modern React with hooks and functional components
- **Tailwind CSS**: Utility-first CSS framework for rapid UI development
- **Axios**: Promise-based HTTP client for API communication
- **Custom Hooks**: Optimized with useCallback and useMemo for performance

### **Infrastructure**
- **Docker**: Containerized application for easy deployment
- **Docker Compose**: Multi-container orchestration
- **AWS Integration**: Native AWS services integration
- **Proxy Configuration**: Seamless frontend-backend communication

## 🚀 Quick Start

### **Prerequisites**
- Docker and Docker Compose installed
- AWS credentials configured (for local development)
- Git (to clone the repository)

### **1. Clone the Repository**
```bash
git clone <repository-url>
cd ecs-explorer
```

### **2. Configure AWS Credentials**
For local development, ensure your AWS credentials are configured:

```bash
# Option 1: AWS CLI configuration
aws configure

# Option 2: Environment variables
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key
export AWS_DEFAULT_REGION=us-east-1
```

### **3. Run the Application**
```bash
# Build and start all services
docker-compose up --build

# Or run in background
docker-compose up -d --build
```

### **4. Access the Application**
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Documentation**: http://localhost:8000/docs

## 📖 Usage Guide

### **Getting Started**
1. **Select Authentication Method**: Choose between AWS Profile or IAM Role
2. **Select Region**: Choose your AWS region (e.g., us-east-1, eu-central-1)
3. **Select Cluster**: Pick the ECS cluster you want to manage
4. **View Services**: See all services in the cluster with their status

### **Deploying Applications**

#### **For Versioned Images (e.g., v1.2.3, v2.0.1)**
1. **Select a Service**: Click on a service from the cluster overview
2. **Check for Updates**: The app automatically detects if newer images are available
3. **Deploy**: Click the "Deploy" button to update the task definition with the latest image
4. **Monitor Progress**: Watch the real-time deployment status

#### **For Latest Tag Images**
1. **Select a Service**: Click on a service from the cluster overview
2. **Check for Updates**: The app compares image digests to detect newer "latest" images
3. **Restart**: Click the "Restart" button to stop current tasks and let ECS pull the latest image
4. **Monitor Progress**: Watch the real-time restart status

#### **Bulk Operations**
1. **Cluster Overview**: View all services with their update status
2. **Bulk Deploy**: Deploy all services with versioned image updates
3. **Bulk Restart**: Restart all services using "latest" tag images
4. **Mixed Operations**: Handle both deployment types simultaneously

### **Monitoring Tasks**
1. **View Running Tasks**: See all currently running tasks
2. **Check Stopped Tasks**: View details of failed or stopped tasks
3. **Analyze Errors**: Get detailed error messages and exit codes
4. **Monitor Health**: Track CPU, memory, and other resource usage

## 🏷️ Image Tagging Strategies

### **Versioned Tags (Semantic Versioning)**
For images with versioned tags like `v1.2.3`, `2.0.1`, `latest-stable`:
- **Detection**: Compares current image tag with latest available tag
- **Deployment**: Updates task definition with new image URI
- **Process**: Full ECS service update with new task definition
- **UI Indicator**: Green "Deploy" button for versioned updates

### **Latest Tags**
For images using `latest` tag strategy:
- **Detection**: Compares image digests to detect newer pushes
- **Deployment**: Restarts running tasks to pull latest image
- **Process**: ECS automatically pulls the latest image on restart
- **UI Indicator**: Blue "Restart" button for latest tag services
- **Efficiency**: Faster deployment as no task definition update needed

### **Mixed Environments**
The application intelligently handles clusters with both tagging strategies:
- **Automatic Detection**: Identifies which services use which strategy
- **Bulk Operations**: Separate "Deploy All" and "Restart All" buttons
- **Visual Indicators**: Clear badges showing "latest" tag usage
- **Unified Interface**: Single view for managing all deployment types

## 🔧 Configuration

### **Environment Variables**
```bash
# AWS Configuration
AWS_SHARED_CREDENTIALS_FILE=/root/.aws/credentials
AWS_CONFIG_FILE=/root/.aws/config

# Application Configuration
BACKEND_PORT=8000
FRONTEND_PORT=3000
```

### **AWS Permissions Required**
The application requires the following AWS permissions:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "ecs:ListClusters",
                "ecs:ListServices",
                "ecs:DescribeServices",
                "ecs:ListTasks",
                "ecs:DescribeTasks",
                "ecs:DescribeTaskDefinition",
                "ecs:RegisterTaskDefinition",
                "ecs:UpdateService",
                "ecs:StopTask",
                "ecr:DescribeImages",
                "ecr:DescribeRepositories",
                "ecr:GetAuthorizationToken",
                "logs:DescribeLogGroups",
                "logs:DescribeLogStreams",
                "logs:GetLogEvents",
                "sts:GetCallerIdentity"
            ],
            "Resource": "*"
        }
    ]
}
```

## 🏗️ Architecture

### **Backend Architecture**
```
backend/
├── main.py              # FastAPI application with all endpoints
├── requirements.txt     # Python dependencies
└── Dockerfile          # Backend container configuration
```

**Key Endpoints:**
- `GET /clusters` - List all ECS clusters
- `GET /services` - List services in a cluster
- `GET /tasks` - List tasks for a service
- `GET /task_details` - Get detailed task information
- `POST /deploy` - Deploy new container images (supports both versioned and latest tags)
- `GET /deployment_status` - Check deployment progress
- `GET /cluster_overview` - Get cluster-wide overview with update detection
- `GET /task_count` - Get active task counts for metrics
- `GET /auth_test` - Test authentication credentials
- `GET /log-target` - Resolve CloudWatch log targets
- `WS /ws/logs` - WebSocket for real-time log streaming

### **Frontend Architecture**
```
frontend/
├── src/
│   ├── components/      # React components
│   ├── services/        # API service layer
│   ├── utils/          # Utility functions
│   └── App.js          # Main application component
├── public/             # Static assets
└── package.json        # Frontend dependencies
```

**Key Components:**
- `AuthMethodSelector` - Authentication method selection with real-time testing
- `ClusterOverview` - Cluster-wide service overview with bulk operations
- `TaskDetailsPanel` - Detailed task information with smart deployment
- `DeploymentStatusCard` - Real-time deployment tracking
- `MetricsCards` - Dynamic metrics display (clusters, services, tasks)
- `LogsPanel` - Real-time CloudWatch log streaming

## 🚀 Performance Optimizations

### **Backend Optimizations**
- **Session Caching**: LRU cache for AWS client sessions
- **Connection Pooling**: Optimized boto3 configuration
- **Async Endpoints**: Non-blocking API operations
- **Error Handling**: Comprehensive error management

### **Frontend Optimizations**
- **Intelligent Caching**: Multi-level caching with TTL support
- **Component Memoization**: useCallback and useMemo for performance
- **Lazy Loading**: On-demand data fetching
- **Efficient Re-renders**: Optimized state management

## 🔒 Security Features

- **Credential Management**: Secure AWS credential handling
- **CORS Configuration**: Proper cross-origin resource sharing
- **Input Validation**: Pydantic models for data validation
- **Error Sanitization**: Safe error message handling

## 🐛 Troubleshooting

### **Common Issues**

**1. Authentication Errors**
```bash
# Check AWS credentials
aws sts get-caller-identity

# Verify profile configuration
aws configure list
```

**2. Container Build Issues**
```bash
# Rebuild containers
docker-compose down
docker-compose up --build --force-recreate
```

**3. Port Conflicts**
```bash
# Check if ports are in use
lsof -i :3000
lsof -i :8000

# Use different ports
docker-compose up -p 3001:3000 -p 8001:8000
```

**4. Latest Tag Detection Issues**
```bash
# Verify ECR repository has latest tag
aws ecr describe-images --repository-name your-repo --image-ids imageTag=latest

# Check if image digest is different
aws ecr describe-images --repository-name your-repo --query 'imageDetails[0].imageDigest'
```

**5. Task Restart Issues**
```bash
# Check if tasks are running
aws ecs list-tasks --cluster your-cluster --service-name your-service

# Verify ECS service configuration
aws ecs describe-services --cluster your-cluster --services your-service
```

### **Debug Mode**
```bash
# Run with debug logging
docker-compose up --build --force-recreate
docker-compose logs -f backend
docker-compose logs -f frontend
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 📞 Support

For support, email ask.arman990@gmail.com or create an issue in the repository.
Feel free to contribute!

---

**Made with ❤️ for the AWS ECS community**
