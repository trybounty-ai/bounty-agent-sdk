#!/usr/bin/env node
import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { parseArgs } from "node:util";

import {
  type CallToolResult,
  Client,
  StreamableHTTPClientTransport,
  type Tool,
  UnauthorizedError,
} from "@modelcontextprotocol/client";
import { Server } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import packageJson from "../package.json" with { type: "json" };
import { BountyAuth, type DeviceLogin } from "./auth.js";

const DEFAULT_URL = "https://api.trybounty.ai/buyer/mcp";

const connectTool = {
  name: "bounty_connect",
  title: "Connect Bounty",
  description:
    "Connect the user's Bounty account. Returns a link and code for the user to approve in their browser; Bounty's tools appear once they do.",
  inputSchema: { type: "object" },
  annotations: { readOnlyHint: true, openWorldHint: true },
} satisfies Tool;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { url: { type: "string" } },
});
const auth = new BountyAuth(new URL(values.url ?? process.env.BOUNTY_MCP_URL ?? DEFAULT_URL));

try {
  switch (positionals[0]) {
    case undefined:
      await serve();
      break;
    case "login": {
      const login = await auth.startLogin();
      console.log(`Open ${login.verificationUri} and confirm the code ${login.userCode}.`);
      openBrowser(login.verificationUriComplete);
      await login.approved;
      console.log("Connected to Bounty.");
      break;
    }
    case "logout":
      await auth.logout();
      console.log("Signed out of Bounty.");
      break;
    default:
      console.error("Usage: bounty-mcp [login | logout] [--url <Bounty MCP URL>]");
      process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

// Serves the Bounty MCP server's tools over stdio. Until the user connects an
// account, the only tool is bounty_connect, which starts a device login.
async function serve(): Promise<void> {
  const remote = new Client({ name: "bounty-mcp", version: packageJson.version });
  let connected = false;
  const connectRemote = async () => {
    if (connected) return;
    await remote.connect(new StreamableHTTPClientTransport(auth.serverUrl, { authProvider: auth }));
    connected = true;
  };
  if (await auth.token()) await connectRemote();

  serveStdio(() => {
    const server = new Server(
      { name: "bounty", version: packageJson.version },
      {
        capabilities: { tools: { listChanged: true } },
        instructions:
          remote.getInstructions() ??
          `Bounty's tools appear after the user connects their Bounty account with ${connectTool.name}.`,
      },
    );
    let login: Promise<DeviceLogin> | undefined;

    const signIn = async () => {
      await connectRemote();
      await server.sendToolListChanged();
    };

    const signOut = async () => {
      await remote.close();
      connected = false;
      await server.sendToolListChanged();
    };

    const startLogin = () => {
      const started = auth.startLogin();
      started
        .then(async ({ verificationUriComplete, approved }) => {
          openBrowser(verificationUriComplete);
          await approved;
          await signIn();
        })
        .catch((error: Error) => console.error(`Bounty login failed: ${error.message}`))
        .finally(() => {
          login = undefined;
        });
      return started;
    };

    const connect = async () => {
      if (await auth.token()) {
        await signIn();
        return text(`Connected to Bounty.\n\n${remote.getInstructions() ?? ""}`.trim());
      }
      if (login) {
        const { approved } = await login;
        if (await Promise.race([approved.then(() => true), setTimeout(10_000, false)])) {
          return text("Connected to Bounty. Its tools are now available.");
        }
      } else {
        login = startLogin();
      }
      const { verificationUriComplete, userCode } = await login;
      return text(
        `Ask the user to open ${verificationUriComplete} and confirm the code ${userCode}. Bounty's tools appear once they approve.`,
      );
    };

    server.setRequestHandler("tools/list", async (request) =>
      connected ? await remote.listTools(request.params) : { tools: [connectTool] },
    );

    server.setRequestHandler("tools/call", async (request) => {
      if (request.params.name === connectTool.name) return await connect();
      if (!connected) return text(`Call ${connectTool.name} to connect a Bounty account first.`);
      try {
        return await remote.callTool(request.params);
      } catch (error) {
        if (!(error instanceof UnauthorizedError)) throw error;
        await signOut();
        return text(`The Bounty connection expired. Call ${connectTool.name} to reconnect.`);
      }
    });

    return server;
  });
}

function text(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }] };
}

function openBrowser(url: string): void {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  spawn(command, args, { detached: true, stdio: "ignore" })
    .on("error", () => {})
    .unref();
}
