#!/bin/bash

###########################################################################
# ECS Deployment Script for ECS Control Center

# Usage: ./deploy-to-ecs.sh or sh deploy-to-ecs.sh

# This script builds Docker images for the backend and frontend,
# pushes them to AWS ECR, registers ECS task definitions,
# creates an ECS Services, ALB Target Groups, sets up an Application Load Balancer,
# and configures security groups.

#########################################################################

set -e

read -p "Enter AWS Region: " REGION
REGION=${REGION:-us-east-1}

read -p "Enter AWS Account ID: " ACCOUNT_ID
ACCOUNT_ID=${ACCOUNT_ID:-123456789012}

read -p "Enter ECR Repository Prefix: " REPO_PREFIX
REPO_PREFIX=${REPO_PREFIX:-ecs-control-center}

read -p "Enter AWS Profile (default if empty): " PROFILE
PROFILE=${PROFILE:-default}

read -p "Enter VPC ID: " VPC_ID
VPC_ID=${VPC_ID:-vpc-0abcde0123456789a}

read -p "Enter Subnet IDs (space-separated): " SUBNET_IDS
SUBNET_IDS=${SUBNET_IDS:-subnet-aaa,subnet-bbb}

read -p "Enter ACM Certificate ARN for HTTPS (leave empty for HTTP only): " CERT_ARN
CERT_ARN=${CERT_ARN:-aws:acm:us-east-1:123456789012:certificate/abcd-ef01-2345}

read -p "Enter ECS Cluster Name: " CLUSTER_NAME
CLUSTER_NAME=${CLUSTER_NAME:-$REPO_PREFIX-cluster}

read -p "Enter Fully Qualified Domain Name (FQDN) for frontend (e.g., example.com): " FQDN
FQDN=${FQDN:-https://ecs-control-center.example.com}

echo "🚀 Deploying ECS ControlCenter to ECS with below configuration..."
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
docker build --platform linux/amd64 --build-arg REACT_APP_API_BASE="$FQDN/api" -t $REPO_PREFIX-frontend .
docker tag $REPO_PREFIX-frontend:latest $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$REPO_PREFIX-frontend:latest
docker push $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$REPO_PREFIX-frontend:latest
cd ..

# 5. Process task definition JSON files
echo "📝 Processing task definition JSON files..."
cd deployment_files

# Use parameter expansion to replace variables in the JSON files
eval "cat << EOF
$(cat ecs-control-center-backend-AWS-CLI-input.json)
EOF" > backend-task-def.json

eval "cat << EOF
$(cat ecs-control-center-frontend-AWS-CLI-input.json)
EOF" > frontend-task-def.json

# 6. Register task definitions
echo "📋 Registering task definitions..."
aws ecs register-task-definition \
  --cli-input-json file://backend-task-def.json \
  --region $REGION \
  --profile $PROFILE

aws ecs register-task-definition \
  --cli-input-json file://frontend-task-def.json \
  --region $REGION \
  --profile $PROFILE

# Store task definition ARNs
BACKEND_TASK_DEF_ARN=$(aws ecs describe-task-definition \
  --task-definition ecs-control-center-backend \
  --query 'taskDefinition.taskDefinitionArn' \
  --output text \
  --region $REGION \
  --profile $PROFILE)

FRONTEND_TASK_DEF_ARN=$(aws ecs describe-task-definition \
  --task-definition ecs-control-center-frontend \
  --query 'taskDefinition.taskDefinitionArn' \
  --output text \
  --region $REGION \
  --profile $PROFILE)

# Clean up temporary files
rm backend-task-def.json frontend-task-def.json

echo "✅ Task definitions registered successfully!"

# 8. Create security groups
echo "🔒 Creating security groups..."
ALB_SG_ID=$(aws ec2 create-security-group \
  --group-name "$REPO_PREFIX-alb-sg" \
  --description "Security group for ALB" \
  --vpc-id $VPC_ID \
  --region $REGION \
  --profile $PROFILE \
  --output text)

ECS_SG_ID=$(aws ec2 create-security-group \
  --group-name "$REPO_PREFIX-ecs-sg" \
  --description "Security group for ECS tasks" \
  --vpc-id $VPC_ID \
  --region $REGION \
  --profile $PROFILE \
  --output text)

# Allow inbound traffic
aws ec2 authorize-security-group-ingress \
  --group-id $ALB_SG_ID \
  --protocol tcp \
  --port 80 \
  --cidr 0.0.0.0/0 \
  --region $REGION \
  --profile $PROFILE

# If TLS is enabled (certificate provided), allow HTTPS (443) on ALB SG
if [ -n "$CERT_ARN" ]; then
  aws ec2 authorize-security-group-ingress \
    --group-id $ALB_SG_ID \
    --protocol tcp \
    --port 443 \
    --cidr 0.0.0.0/0 \
    --region $REGION \
    --profile $PROFILE || true
fi

aws ec2 authorize-security-group-ingress \
  --group-id $ECS_SG_ID \
  --protocol tcp \
  --port 0-65535 \
  --source-group $ALB_SG_ID \
  --region $REGION \
  --profile $PROFILE

# 9. Create Application Load Balancer
echo "⚖️ Creating Application Load Balancer..."
ALB_ARN=$(aws elbv2 create-load-balancer \
  --name "$REPO_PREFIX-alb" \
  --subnets $SUBNET_IDS \
  --security-groups $ALB_SG_ID \
  --scheme internet-facing \
  --type application \
  --query 'LoadBalancers[0].LoadBalancerArn' \
  --output text \
  --region $REGION \
  --profile $PROFILE)

# 10. Create target groups
echo "🎯 Creating target groups..."
BACKEND_TG_ARN=$(aws elbv2 create-target-group \
  --name "$REPO_PREFIX-backend-tg" \
  --protocol HTTP \
  --port 8000 \
  --vpc-id $VPC_ID \
  --target-type ip \
  --health-check-path /health \
  --health-check-interval-seconds 30 \
  --health-check-timeout-seconds 5 \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 5 \
  --query 'TargetGroups[0].TargetGroupArn' \
  --output text \
  --region $REGION \
  --profile $PROFILE)

FRONTEND_TG_ARN=$(aws elbv2 create-target-group \
  --name "$REPO_PREFIX-frontend-tg" \
  --protocol HTTP \
  --port 3000 \
  --vpc-id $VPC_ID \
  --target-type ip \
  --health-check-path / \
  --health-check-interval-seconds 30 \
  --health-check-timeout-seconds 5 \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 5 \
  --query 'TargetGroups[0].TargetGroupArn' \
  --output text \
  --region $REGION \
  --profile $PROFILE)

# 11. Create ALB listeners
echo "👂 Creating ALB listeners..."

if [ -n "$CERT_ARN" ]; then
  echo "🔐 ACM Certificate ARN provided. Creating HTTPS (443) listener and HTTP->HTTPS redirect on port 80."

  # Create HTTPS listener (443) using provided certificate and forward to frontend TG by default
  HTTPS_LISTENER_ARN=$(aws elbv2 create-listener \
    --load-balancer-arn $ALB_ARN \
    --protocol HTTPS \
    --port 443 \
    --certificates CertificateArn=$CERT_ARN \
    --default-actions Type=forward,TargetGroupArn=$FRONTEND_TG_ARN \
    --query 'Listeners[0].ListenerArn' \
    --output text \
    --region $REGION \
    --profile $PROFILE)

  # Create path-based routing for backend on the HTTPS listener
  aws elbv2 create-rule \
    --listener-arn $HTTPS_LISTENER_ARN \
    --priority 10 \
    --conditions Field=path-pattern,Values='/api/*' \
    --actions Type=forward,TargetGroupArn=$BACKEND_TG_ARN \
    --region $REGION \
    --profile $PROFILE

  # Create HTTP listener that redirects to HTTPS
  aws elbv2 create-listener \
    --load-balancer-arn $ALB_ARN \
    --protocol HTTP \
    --port 80 \
    --default-actions Type=redirect,RedirectConfig='{"Protocol":"HTTPS","Port":"443","StatusCode":"HTTP_301"}' \
    --region $REGION \
    --profile $PROFILE

else
  echo "⚠️ No ACM certificate ARN provided. Creating HTTP (80) listener that forwards to frontend."

  aws elbv2 create-listener \
    --load-balancer-arn $ALB_ARN \
    --protocol HTTP \
    --port 80 \
    --default-actions Type=forward,TargetGroupArn=$FRONTEND_TG_ARN \
    --region $REGION \
    --profile $PROFILE

  LISTENER_ARN=$(aws elbv2 describe-listeners \
    --load-balancer-arn $ALB_ARN \
    --query 'Listeners[?Port==`80`].[ListenerArn]' \
    --output text \
    --region $REGION \
    --profile $PROFILE)

  # Add path-based routing for backend on HTTP listener
  aws elbv2 create-rule \
    --listener-arn $LISTENER_ARN \
    --priority 10 \
    --conditions Field=path-pattern,Values='/api/*' \
    --actions Type=forward,TargetGroupArn=$BACKEND_TG_ARN \
    --region $REGION \
    --profile $PROFILE

fi

# 13. Create ECS services
echo "🔄 Creating ECS services..."
aws ecs create-service \
  --cluster $CLUSTER_NAME \
  --service-name "$REPO_PREFIX-backend" \
  --task-definition $BACKEND_TASK_DEF_ARN \
  --desired-count 2 \
  --launch-type EC2 \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_IDS],securityGroups=[$ECS_SG_ID],assignPublicIp=ENABLED}" \
  --load-balancers "targetGroupArn=$BACKEND_TG_ARN,containerName=backend,containerPort=8000" \
  --region $REGION \
  --profile $PROFILE

aws ecs create-service \
  --cluster $CLUSTER_NAME \
  --service-name "$REPO_PREFIX-frontend" \
  --task-definition $FRONTEND_TASK_DEF_ARN \
  --desired-count 2 \
  --launch-type EC2 \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_IDS],securityGroups=[$ECS_SG_ID],assignPublicIp=ENABLED}" \
  --load-balancers "targetGroupArn=$FRONTEND_TG_ARN,containerName=frontend,containerPort=3000" \
  --region $REGION \
  --profile $PROFILE

# Get ALB DNS name
ALB_DNS=$(aws elbv2 describe-load-balancers \
  --load-balancer-arns $ALB_ARN \
  --query 'LoadBalancers[0].DNSName' \
  --output text \
  --region $REGION \
  --profile $PROFILE)

echo "✅ Deployment completed successfully!"
if [ -n "$CERT_ARN" ]; then
  echo "🌐 Application Load Balancer DNS: https://$ALB_DNS"
  echo "📱 Frontend URL: https://$ALB_DNS"
  echo "🔗 Backend API URL: https://$ALB_DNS/api"
  echo "🔁 HTTP (port 80) is configured to redirect to HTTPS (port 443)."
else
  echo "🌐 Application Load Balancer DNS: http://$ALB_DNS"
  echo "📱 Frontend URL: http://$ALB_DNS"
  echo "🔗 Backend API URL: http://$ALB_DNS/api"
fi
cd ..
