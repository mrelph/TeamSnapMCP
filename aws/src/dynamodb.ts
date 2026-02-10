import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.DYNAMODB_TABLE || "teamsnap-mcp-tokens";

export interface StoredCredentials {
  userId: string; // "user#default" for single user, or user-specific
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  teamsnapUserId?: string;
  teamsnapEmail?: string;
  clientId: string;
  clientSecret: string;
  createdAt: number;
  updatedAt: number;
}

export async function saveCredentials(credentials: Omit<StoredCredentials, "userId" | "createdAt" | "updatedAt">): Promise<void> {
  const now = Date.now();
  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      userId: "user#default",
      ...credentials,
      createdAt: now,
      updatedAt: now,
    },
  }));
}

export async function loadCredentials(): Promise<StoredCredentials | null> {
  const result = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { userId: "user#default" },
  }));
  return (result.Item as StoredCredentials) || null;
}

export async function clearCredentials(): Promise<void> {
  await docClient.send(new DeleteCommand({
    TableName: TABLE_NAME,
    Key: { userId: "user#default" },
  }));
}

// Store pending OAuth state for callback verification
export async function savePendingAuth(state: string, clientId: string, clientSecret: string): Promise<void> {
  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      userId: `oauth#${state}`,
      clientId,
      clientSecret,
      createdAt: Date.now(),
      ttl: Math.floor(Date.now() / 1000) + 600, // 10 minute TTL
    },
  }));
}

export async function getPendingAuth(state: string): Promise<{ clientId: string; clientSecret: string } | null> {
  const result = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { userId: `oauth#${state}` },
  }));
  if (!result.Item) return null;
  return {
    clientId: result.Item.clientId as string,
    clientSecret: result.Item.clientSecret as string,
  };
}

export async function deletePendingAuth(state: string): Promise<void> {
  await docClient.send(new DeleteCommand({
    TableName: TABLE_NAME,
    Key: { userId: `oauth#${state}` },
  }));
}
