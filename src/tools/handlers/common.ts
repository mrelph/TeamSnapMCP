import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function success(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

export function error(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

export function empty(reason: "not_authorized" | "not_found" | "no_data"): CallToolResult {
  return success({ empty: true, reason });
}

export function getViewerTZ(): string | undefined {
  return process.env.TEAMSNAP_TIMEZONE || undefined;
}

export type ToolArgs = Record<string, unknown>;

export function requireString(args: ToolArgs, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`${key} is required`);
  }
  return v;
}

export function requireExactlyOne(args: ToolArgs, keys: string[]): { key: string; value: string } {
  const present = keys.filter((k) => typeof args[k] === "string" && (args[k] as string).length > 0);
  if (present.length !== 1) {
    throw new Error(`exactly one of ${keys.join(", ")} is required`);
  }
  return { key: present[0], value: args[present[0]] as string };
}
