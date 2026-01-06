#!/bin/bash
set -e

FUNCTION_NAME="teamsnap-mcp"
REGION="us-east-1"
ACCOUNT_ID="530350706205"
ROLE_NAME="teamsnap-mcp-lambda-role"

echo "==> Creating IAM role..."
aws iam create-role \
  --role-name $ROLE_NAME \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "lambda.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }' 2>/dev/null || echo "Role may already exist"

echo "==> Attaching policies..."
aws iam attach-role-policy \
  --role-name $ROLE_NAME \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole 2>/dev/null || true

aws iam attach-role-policy \
  --role-name $ROLE_NAME \
  --policy-arn arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess 2>/dev/null || true

echo "==> Waiting for role to propagate..."
sleep 10

echo "==> Installing Lambda dependencies..."
cd "$(dirname "$0")/lambda"
npm install --omit=dev

echo "==> Packaging Lambda..."
zip -r ../function.zip . -x "*.git*"

cd ..

echo "==> Creating/Updating Lambda function..."
if aws lambda get-function --function-name $FUNCTION_NAME 2>/dev/null; then
  echo "Updating existing function..."
  aws lambda update-function-code \
    --function-name $FUNCTION_NAME \
    --zip-file fileb://function.zip
else
  echo "Creating new function..."
  aws lambda create-function \
    --function-name $FUNCTION_NAME \
    --runtime nodejs20.x \
    --role arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME} \
    --handler index.handler \
    --zip-file fileb://function.zip \
    --timeout 30 \
    --memory-size 256 \
    --environment "Variables={TEAMSNAP_CLIENT_ID=${TEAMSNAP_CLIENT_ID},TEAMSNAP_CLIENT_SECRET=${TEAMSNAP_CLIENT_SECRET},DYNAMODB_TABLE=teamsnap-mcp-tokens}"
fi

echo "==> Waiting for function to be ready..."
aws lambda wait function-active --function-name $FUNCTION_NAME

echo "==> Creating/Getting API Gateway..."
API_ID=$(aws apigatewayv2 get-apis --query "Items[?Name=='teamsnap-mcp-api'].ApiId" --output text)

if [ -z "$API_ID" ] || [ "$API_ID" == "None" ]; then
  echo "Creating new API Gateway..."
  API_ID=$(aws apigatewayv2 create-api \
    --name teamsnap-mcp-api \
    --protocol-type HTTP \
    --target arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${FUNCTION_NAME} \
    --query 'ApiId' --output text)

  echo "==> Adding Lambda permission for API Gateway..."
  aws lambda add-permission \
    --function-name $FUNCTION_NAME \
    --statement-id apigateway-invoke \
    --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:${REGION}:${ACCOUNT_ID}:${API_ID}/*" 2>/dev/null || true
fi

API_URL="https://${API_ID}.execute-api.${REGION}.amazonaws.com"

echo ""
echo "=========================================="
echo "✅ Deployment complete!"
echo "=========================================="
echo ""
echo "API URL: $API_URL"
echo ""
echo "Callback URL for TeamSnap: ${API_URL}/callback"
echo ""
echo "To authenticate, visit: ${API_URL}/auth"
echo ""

# Clean up
rm -f function.zip
