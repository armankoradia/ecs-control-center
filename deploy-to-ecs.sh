#!/bin/bash

# ECS Deployment Script for ECS DeployMate
# Usage: ./deploy-to-ecs.sh <AWS_REGION> <AWS_ACCOUNT_ID> <ECR_REPOSITORY_PREFIX>

set -e

REGION=${1:-us-east-1}
ACCOUNT_ID=${2:-123456789012}
REPO_PREFIX=${3:-ecs-control-center}
PROFILE=${4:-default}

echo "🚀 Deploying ECS DeployMate to ECS..."
echo "Region: $REGION"
echo "Account ID: $ACCOUNT_ID"
echo "Repository Prefix: $REPO_PREFIX"
echo "Profile: $PROFILE"

# 1. Create ECR repositories
echo "📦 Creating ECR repositories..."
aws ecr create-repository --repository-name $REPO_PREFIX-backend --region $REGION --profile $PROFILE || echo "Backend repository already exists"
aws ecr create-repository --repository-name $REPO_PREFIX-frontend --region $REGION --profile $PROFILE || echo "Frontend repository already exists"

# 2. Get ECR login token
echo "🔐 Logging into ECR..."
aws ecr get-login-password --region $REGION --profile $PROFILE | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com

# 3. Build and push backend image
echo "🏗️ Building and pushing backend image..."
cd backend
docker build --platform linux/amd64 -t $REPO_PREFIX-backend .
docker tag $REPO_PREFIX-backend:latest $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$REPO_PREFIX-backend:latest
docker push $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$REPO_PREFIX-backend:latest
cd ..

# 4. Build and push frontend image
echo "🏗️ Building and pushing frontend image..."
cd frontend
docker build --platform linux/amd64 -t $REPO_PREFIX-frontend .
docker tag $REPO_PREFIX-frontend:latest $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$REPO_PREFIX-frontend:latest
docker push $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$REPO_PREFIX-frontend:latest
