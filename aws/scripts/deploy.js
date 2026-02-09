import { DynamoDBClient, CreateTableCommand, DescribeTableCommand, ResourceNotFoundException } from "@aws-sdk/client-dynamodb";
import { IAMClient, CreateRoleCommand, PutRolePolicyCommand, GetRoleCommand } from "@aws-sdk/client-iam";
import { LambdaClient, CreateFunctionCommand, UpdateFunctionCodeCommand, UpdateFunctionConfigurationCommand, GetFunctionCommand, AddPermissionCommand, ResourceNotFoundException as LambdaResourceNotFoundException } from "@aws-sdk/client-lambda";
import { ApiGatewayV2Client, CreateApiCommand, CreateStageCommand, CreateIntegrationCommand, CreateRouteCommand, GetApisCommand, GetIntegrationsCommand, GetRoutesCommand } from "@aws-sdk/client-apigatewayv2";
import { readFileSync, createWriteStream } from "fs";
import { execSync } from "child_process";
import archiver from "archiver";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
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
    if (!(err instanceof ResourceNotFoundException)) throw err;
  }

  await dynamodb.send(new CreateTableCommand({
    TableName: TABLE_NAME,
    KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }],
    AttributeDefinitions: [{ AttributeName: "pk", AttributeType: "S" }],
    BillingMode: "PAY_PER_REQUEST",
    TimeToLiveSpecification: { Enabled: true, AttributeName: "ttl" },
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
    await iam.send(new GetRoleCommand({ RoleName: ROLE_NAME }));
    console.log("  Role already exists");
  } catch (err) {
    if (err.name !== "NoSuchEntityException") throw err;

    await iam.send(new CreateRoleCommand({
      RoleName: ROLE_NAME,
      AssumeRolePolicyDocument: JSON.stringify(assumeRolePolicy),
    }));
    console.log("  Role created");
  }

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

  // Wait for role to be available
  await new Promise(r => setTimeout(r, 10000));

  const { Role } = await iam.send(new GetRoleCommand({ RoleName: ROLE_NAME }));
  return Role.Arn;
}

async function buildLambda() {
  console.log("Building Lambda...");
  execSync("npm run build", { cwd: PROJECT_ROOT, stdio: "inherit" });

  // Create zip using archiver
  console.log("  Creating zip...");
  await new Promise((resolve, reject) => {
    const output = createWriteStream(join(PROJECT_ROOT, "lambda.zip"));
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", resolve);
    archive.on("error", reject);

    archive.pipe(output);
    archive.file(join(PROJECT_ROOT, "dist/lambda.js"), { name: "lambda.js" });
    archive.finalize();
  });
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

  try {
    await lambda.send(new GetFunctionCommand({ FunctionName: FUNCTION_NAME }));

    // Update existing
    await lambda.send(new UpdateFunctionCodeCommand({
      FunctionName: FUNCTION_NAME,
      ZipFile: zipFile,
    }));
    console.log("  Code updated");

    // Wait a moment for update to complete
    await new Promise(r => setTimeout(r, 5000));

    await lambda.send(new UpdateFunctionConfigurationCommand(config));
    console.log("  Config updated");
  } catch (err) {
    if (!(err instanceof LambdaResourceNotFoundException)) throw err;

    // Create new
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

  return `arn:aws:lambda:${REGION}:${roleArn.split(":")[4]}:function:${FUNCTION_NAME}`;
}

async function createAPIGateway(lambdaArn) {
  console.log("Creating API Gateway...");

  // Check if API exists
  const { Items: apis } = await apigateway.send(new GetApisCommand({}));
  let api = apis?.find(a => a.Name === API_NAME);

  if (!api) {
    const result = await apigateway.send(new CreateApiCommand({
      Name: API_NAME,
      ProtocolType: "HTTP",
    }));
    api = result;
    console.log("  API created");
  } else {
    console.log("  API already exists");
  }

  const apiId = api.ApiId;

  // Create/update integration
  const { Items: integrations } = await apigateway.send(new GetIntegrationsCommand({ ApiId: apiId }));
  let integration = integrations?.find(i => i.IntegrationUri === lambdaArn);

  if (!integration) {
    const result = await apigateway.send(new CreateIntegrationCommand({
      ApiId: apiId,
      IntegrationType: "AWS_PROXY",
      IntegrationUri: lambdaArn,
      PayloadFormatVersion: "2.0",
    }));
    integration = result;
    console.log("  Integration created");
  }

  // Create routes if they don't exist
  const { Items: routes } = await apigateway.send(new GetRoutesCommand({ ApiId: apiId }));
  const routeKeys = ["GET /", "GET /callback", "POST /mcp", "GET /health"];

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

  // Create default stage if needed
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
      StatementId: "apigateway-invoke",
      Action: "lambda:InvokeFunction",
      Principal: "apigateway.amazonaws.com",
      SourceArn: `arn:aws:execute-api:${REGION}:${accountId}:${apiId}/*/*`,
    }));
    console.log("  Lambda permission added");
  } catch (err) {
    if (!err.message?.includes("already exists")) throw err;
  }

  const endpoint = `https://${apiId}.execute-api.${REGION}.amazonaws.com`;
  console.log(`\n✅ Deployment complete!`);
  console.log(`\n📍 API Endpoint: ${endpoint}`);
  console.log(`   Callback URL: ${endpoint}/callback`);
  console.log(`   MCP Endpoint: ${endpoint}/mcp`);

  return endpoint;
}

async function main() {
  console.log("TeamSnap MCP AWS Deployment\n");

  await createDynamoDBTable();
  const roleArn = await createIAMRole();
  await buildLambda();
  const lambdaArn = await deployLambda(roleArn);
  const endpoint = await createAPIGateway(lambdaArn);

  console.log(`\n📋 Next steps:`);
  console.log(`   1. Update TeamSnap app redirect URI to: ${endpoint}/callback`);
  console.log(`   2. Configure Claude Desktop with the MCP endpoint`);
}

main().catch(console.error);
