const { DynamoDBClient, CreateTableCommand, DescribeTableCommand } = require("@aws-sdk/client-dynamodb");
const { IAMClient, CreateRoleCommand, PutRolePolicyCommand, GetRoleCommand } = require("@aws-sdk/client-iam");
const { LambdaClient, CreateFunctionCommand, UpdateFunctionCodeCommand, UpdateFunctionConfigurationCommand, GetFunctionCommand, AddPermissionCommand } = require("@aws-sdk/client-lambda");
const { ApiGatewayV2Client, CreateApiCommand, CreateStageCommand, CreateIntegrationCommand, CreateRouteCommand, GetApisCommand, GetIntegrationsCommand, GetRoutesCommand } = require("@aws-sdk/client-apigatewayv2");
const { readFileSync, createWriteStream } = require("fs");
const { execSync } = require("child_process");
const { join } = require("path");
const archiver = require("archiver");

function zipFile(srcPath, destZipPath) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(destZipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", () => resolve(archive.pointer()));
    archive.on("error", reject);
    archive.pipe(output);
    archive.file(srcPath, { name: "lambda.js" });
    archive.finalize();
  });
}

const PROJECT_ROOT = join(__dirname, "..");
const REGION = process.env.AWS_REGION || "us-west-2";
const TABLE_NAME = "teamsnap-mcp-tokens";
const FUNCTION_NAME = "teamsnap-mcp";
const ROLE_NAME = "teamsnap-mcp-lambda-role";
const API_NAME = "teamsnap-mcp-api";

const dynamodb = new DynamoDBClient({ region: REGION });
const iam = new IAMClient({ region: REGION });
const lambda = new LambdaClient({ region: REGION });
const apigateway = new ApiGatewayV2Client({ region: REGION });

async function createDynamoDBTable() {
  console.log("Creating DynamoDB table...");

  try {
    await dynamodb.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
    console.log("  Table already exists");
    return;
  } catch (err) {
    if (err.name !== "ResourceNotFoundException") throw err;
  }

  await dynamodb.send(new CreateTableCommand({
    TableName: TABLE_NAME,
    KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }],
    AttributeDefinitions: [{ AttributeName: "pk", AttributeType: "S" }],
    BillingMode: "PAY_PER_REQUEST",
  }));

  console.log("  Table created");

  // Wait for table to be active
  let active = false;
  while (!active) {
    const { Table } = await dynamodb.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
    active = Table?.TableStatus === "ACTIVE";
    if (!active) await new Promise(r => setTimeout(r, 2000));
  }
  console.log("  Table is active");
}

async function createIAMRole() {
  console.log("Creating IAM role...");

  const assumeRolePolicy = {
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Principal: { Service: "lambda.amazonaws.com" },
      Action: "sts:AssumeRole"
    }]
  };

  try {
    const { Role } = await iam.send(new GetRoleCommand({ RoleName: ROLE_NAME }));
    console.log("  Role already exists");
    return Role.Arn;
  } catch (err) {
    if (err.name !== "NoSuchEntityException") throw err;
  }

  await iam.send(new CreateRoleCommand({
    RoleName: ROLE_NAME,
    AssumeRolePolicyDocument: JSON.stringify(assumeRolePolicy),
  }));
  console.log("  Role created");

  // Attach policy
  const policy = {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
        Resource: "arn:aws:logs:*:*:*"
      },
      {
        Effect: "Allow",
        Action: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:Query"],
        Resource: `arn:aws:dynamodb:${REGION}:*:table/${TABLE_NAME}`
      }
    ]
  };

  await iam.send(new PutRolePolicyCommand({
    RoleName: ROLE_NAME,
    PolicyName: "teamsnap-mcp-policy",
    PolicyDocument: JSON.stringify(policy),
  }));
  console.log("  Policy attached");

  // Wait for role propagation
  console.log("  Waiting for IAM propagation...");
  await new Promise(r => setTimeout(r, 10000));

  const { Role } = await iam.send(new GetRoleCommand({ RoleName: ROLE_NAME }));
  return Role.Arn;
}

async function buildLambda() {
  console.log("Building Lambda...");
  execSync("npm run build", { cwd: PROJECT_ROOT, stdio: "inherit" });
  await zipFile(join(PROJECT_ROOT, "dist", "lambda.js"), join(PROJECT_ROOT, "lambda.zip"));
  console.log("  Build complete");
}

async function deployLambda(roleArn) {
  console.log("Deploying Lambda...");

  const zipFile = readFileSync(join(PROJECT_ROOT, "lambda.zip"));

  const config = {
    FunctionName: FUNCTION_NAME,
    Runtime: "nodejs20.x",
    Handler: "lambda.handler",
    Role: roleArn,
    Timeout: 30,
    MemorySize: 256,
    Environment: {
      Variables: {
        DYNAMODB_TABLE: TABLE_NAME,
        TEAMSNAP_CLIENT_ID: process.env.TEAMSNAP_CLIENT_ID || "",
        TEAMSNAP_CLIENT_SECRET: process.env.TEAMSNAP_CLIENT_SECRET || "",
      }
    }
  };

  let functionExists = false;
  try {
    await lambda.send(new GetFunctionCommand({ FunctionName: FUNCTION_NAME }));
    functionExists = true;
  } catch (err) {
    if (err.name !== "ResourceNotFoundException") throw err;
  }

  if (functionExists) {
    await lambda.send(new UpdateFunctionCodeCommand({
      FunctionName: FUNCTION_NAME,
      ZipFile: zipFile,
    }));
    console.log("  Code updated");

    await new Promise(r => setTimeout(r, 5000));

    await lambda.send(new UpdateFunctionConfigurationCommand(config));
    console.log("  Config updated");
  } else {
    await lambda.send(new CreateFunctionCommand({
      ...config,
      Code: { ZipFile: zipFile },
    }));
    console.log("  Function created");
  }

  // Wait for function to be active
  let ready = false;
  while (!ready) {
    const { Configuration } = await lambda.send(new GetFunctionCommand({ FunctionName: FUNCTION_NAME }));
    ready = Configuration?.State === "Active";
    if (!ready) await new Promise(r => setTimeout(r, 2000));
  }
  console.log("  Function is active");

  const accountId = roleArn.split(":")[4];
  return `arn:aws:lambda:${REGION}:${accountId}:function:${FUNCTION_NAME}`;
}

async function createAPIGateway(lambdaArn) {
  console.log("Creating API Gateway...");

  const { Items: apis } = await apigateway.send(new GetApisCommand({}));
  let api = apis?.find(a => a.Name === API_NAME);

  if (!api) {
    api = await apigateway.send(new CreateApiCommand({
      Name: API_NAME,
      ProtocolType: "HTTP",
    }));
    console.log("  API created");
  } else {
    console.log("  API already exists");
  }

  const apiId = api.ApiId;

  // Create integration
  const { Items: integrations } = await apigateway.send(new GetIntegrationsCommand({ ApiId: apiId }));
  let integration = integrations?.find(i => i.IntegrationUri === lambdaArn);

  if (!integration) {
    integration = await apigateway.send(new CreateIntegrationCommand({
      ApiId: apiId,
      IntegrationType: "AWS_PROXY",
      IntegrationUri: lambdaArn,
      PayloadFormatVersion: "2.0",
    }));
    console.log("  Integration created");
  }

  // Create routes
  const { Items: routes } = await apigateway.send(new GetRoutesCommand({ ApiId: apiId }));
  const routeKeys = ["GET /", "GET /callback", "POST /mcp", "DELETE /mcp", "GET /health"];

  for (const routeKey of routeKeys) {
    if (!routes?.find(r => r.RouteKey === routeKey)) {
      await apigateway.send(new CreateRouteCommand({
        ApiId: apiId,
        RouteKey: routeKey,
        Target: `integrations/${integration.IntegrationId}`,
      }));
      console.log(`  Route ${routeKey} created`);
    }
  }

  // Create stage
  try {
    await apigateway.send(new CreateStageCommand({
      ApiId: apiId,
      StageName: "$default",
      AutoDeploy: true,
    }));
    console.log("  Stage created");
  } catch (err) {
    if (!err.message?.includes("already exists")) throw err;
  }

  // Add Lambda permission
  const accountId = lambdaArn.split(":")[4];
  try {
    await lambda.send(new AddPermissionCommand({
      FunctionName: FUNCTION_NAME,
      StatementId: `apigateway-invoke-${Date.now()}`,
      Action: "lambda:InvokeFunction",
      Principal: "apigateway.amazonaws.com",
      SourceArn: `arn:aws:execute-api:${REGION}:${accountId}:${apiId}/*/*`,
    }));
    console.log("  Lambda permission added");
  } catch (err) {
    if (!err.message?.includes("already exists")) {
      console.log("  Lambda permission may already exist");
    }
  }

  const endpoint = `https://${apiId}.execute-api.${REGION}.amazonaws.com`;
  return endpoint;
}

async function main() {
  console.log("\n🚀 TeamSnap MCP AWS Deployment\n");

  await createDynamoDBTable();
  const roleArn = await createIAMRole();
  await buildLambda();
  const lambdaArn = await deployLambda(roleArn);
  const endpoint = await createAPIGateway(lambdaArn);

  console.log(`\n✅ Deployment complete!\n`);
  console.log(`📍 API Endpoint: ${endpoint}`);
  console.log(`   Callback URL: ${endpoint}/callback`);
  console.log(`   MCP Endpoint: ${endpoint}/mcp\n`);
  console.log(`📋 Next steps:`);
  console.log(`   1. Update TeamSnap app redirect URI to: ${endpoint}/callback`);
  console.log(`   2. Configure Claude Desktop with the MCP endpoint\n`);
}

main().catch(err => {
  console.error("Deployment failed:", err);
  process.exit(1);
});
