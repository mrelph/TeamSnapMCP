#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ClaudeConfig {
  mcpServers?: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
}

function getClaudeConfigPath(): string {
  const platform = process.platform;
  if (platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  } else if (platform === "win32") {
    return join(process.env.APPDATA || "", "Claude", "claude_desktop_config.json");
  } else {
    return join(homedir(), ".config", "claude", "claude_desktop_config.json");
  }
}

function main() {
  const configPath = getClaudeConfigPath();
  const configDir = dirname(configPath);

  console.log("TeamSnap MCP - One-Click Install\n");

  // Ensure config directory exists
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
    console.log(`Created config directory: ${configDir}`);
  }

  // Load existing config or create new one
  let config: ClaudeConfig = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf8"));
      console.log("Found existing Claude config");
    } catch {
      console.log("Creating new Claude config");
    }
  }

  // Initialize mcpServers if needed
  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  // Find the path to our server
  // When installed globally, use the package name
  // When running locally, use the full path
  const serverCommand = "npx";
  const serverArgs = ["@teamsnap/mcp-server"];

  // Check if already configured
  if (config.mcpServers["teamsnap"]) {
    console.log("\n⚠️  TeamSnap MCP is already configured.");
    console.log("   Current config:", JSON.stringify(config.mcpServers["teamsnap"], null, 2));

    const readline = require("readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question("\nOverwrite existing config? (y/N): ", (answer: string) => {
      rl.close();
      if (answer.toLowerCase() === "y") {
        addConfig();
      } else {
        console.log("No changes made.");
        process.exit(0);
      }
    });
    return;
  }

  addConfig();

  function addConfig() {
    config.mcpServers!["teamsnap"] = {
      command: serverCommand,
      args: serverArgs,
    };

    writeFileSync(configPath, JSON.stringify(config, null, 2));

    console.log("\n✅ TeamSnap MCP has been added to Claude Desktop!");
    console.log(`   Config file: ${configPath}`);
    console.log("\n📋 Next steps:");
    console.log("   1. Restart Claude Desktop");
    console.log("   2. Ask Claude to authenticate with TeamSnap");
    console.log("   3. Start managing your teams!\n");
    console.log("💡 You'll need your TeamSnap OAuth credentials from:");
    console.log("   https://developer.teamsnap.com\n");
  }
}

main();
