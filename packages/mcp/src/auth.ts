import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";

import {
  type AuthorizationServerMetadata,
  type AuthProvider,
  discoverOAuthServerInfo,
  OAuthError,
  OAuthErrorCode,
  type OAuthTokens,
  parseErrorResponse,
  refreshAuthorization,
  registerClient,
} from "@modelcontextprotocol/client";
import * as z from "zod";

const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const SCOPE = "openid offline_access";
const EXPIRY_MARGIN_MS = 60_000;

const credentialsSchema = z.object({
  clientId: z.string(),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(),
});
type Credentials = z.infer<typeof credentialsSchema>;
const credentialsFileSchema = z.record(z.string(), credentialsSchema);

const deviceMetadataSchema = z.object({
  device_authorization_endpoint: z.string(),
  token_endpoint: z.string(),
});

const deviceAuthorizationSchema = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri: z.string(),
  verification_uri_complete: z.string().optional(),
  expires_in: z.number(),
  interval: z.number().default(5),
});
type DeviceAuthorization = z.infer<typeof deviceAuthorizationSchema>;

const deviceTokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
});

interface AuthorizationServer {
  url: string;
  metadata: AuthorizationServerMetadata;
  deviceAuthorizationEndpoint: string;
  tokenEndpoint: string;
  resource: string;
}

export interface DeviceLogin {
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  approved: Promise<void>;
}

// Signs in to a Bounty MCP server with the OAuth device authorization grant
// (RFC 8628) and keeps its tokens in the user's config directory.
export class BountyAuth implements AuthProvider {
  readonly #path = join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    "bounty",
    "mcp.json",
  );
  #server: Promise<AuthorizationServer> | undefined;

  constructor(readonly serverUrl: URL) {}

  async token(): Promise<string | undefined> {
    const credentials = await this.#read();
    if (
      credentials?.expiresAt !== undefined &&
      credentials.expiresAt - EXPIRY_MARGIN_MS < Date.now()
    ) {
      return (await this.#refresh(credentials))?.accessToken;
    }
    return credentials?.accessToken;
  }

  async onUnauthorized(): Promise<void> {
    const credentials = await this.#read();
    if (credentials) await this.#refresh(credentials);
  }

  async startLogin(): Promise<DeviceLogin> {
    const server = await this.#discover();
    const clientId =
      (await this.#read())?.clientId ?? (await this.#register(server));
    const response = await fetch(server.deviceAuthorizationEndpoint, {
      method: "POST",
      headers: { accept: "application/json" },
      body: new URLSearchParams({
        client_id: clientId,
        scope: SCOPE,
        resource: server.resource,
      }),
    });
    if (!response.ok) throw await parseErrorResponse(response);
    const device = deviceAuthorizationSchema.parse(await response.json());
    return {
      userCode: device.user_code,
      verificationUri: device.verification_uri,
      verificationUriComplete:
        device.verification_uri_complete ?? device.verification_uri,
      approved: this.#poll(server, clientId, device),
    };
  }

  async logout(): Promise<void> {
    await this.#write(undefined);
  }

  #discover(): Promise<AuthorizationServer> {
    this.#server ??= discoverOAuthServerInfo(this.serverUrl).then(
      ({ authorizationServerUrl, authorizationServerMetadata, resourceMetadata }) => {
        const endpoints = deviceMetadataSchema.safeParse(authorizationServerMetadata);
        if (!authorizationServerMetadata || !endpoints.success) {
          throw new Error(
            `${authorizationServerUrl} does not support the device authorization grant.`,
          );
        }
        return {
          url: authorizationServerUrl,
          metadata: authorizationServerMetadata,
          deviceAuthorizationEndpoint: endpoints.data.device_authorization_endpoint,
          tokenEndpoint: endpoints.data.token_endpoint,
          resource: resourceMetadata?.resource ?? this.serverUrl.href,
        };
      },
      (error: Error) => {
        this.#server = undefined;
        throw error;
      },
    );
    return this.#server;
  }

  async #register(server: AuthorizationServer): Promise<string> {
    const client = await registerClient(server.url, {
      metadata: server.metadata,
      clientMetadata: {
        client_name: "Bounty MCP",
        grant_types: [DEVICE_CODE_GRANT, "refresh_token"],
        // AuthKit rejects registrations without a redirect URI, even for
        // clients that never redirect.
        redirect_uris: ["http://127.0.0.1/"],
        token_endpoint_auth_method: "none",
        scope: SCOPE,
      },
    });
    await this.#write({ clientId: client.client_id });
    return client.client_id;
  }

  async #poll(
    server: AuthorizationServer,
    clientId: string,
    device: DeviceAuthorization,
  ): Promise<void> {
    const deadline = Date.now() + device.expires_in * 1000;
    let interval = device.interval;
    while (Date.now() < deadline) {
      await setTimeout(interval * 1000);
      const response = await fetch(server.tokenEndpoint, {
        method: "POST",
        headers: { accept: "application/json" },
        body: new URLSearchParams({
          grant_type: DEVICE_CODE_GRANT,
          device_code: device.device_code,
          client_id: clientId,
          resource: server.resource,
        }),
      });
      if (response.ok) {
        const tokens = deviceTokenSchema.parse(await response.json());
        const credentials = await this.#save(clientId, tokens);
        // AuthKit issues device grant access tokens for its own client and
        // ignores `resource`; a refresh with `resource` returns one for the
        // MCP server.
        await this.#refresh(credentials);
        return;
      }
      const error = await parseErrorResponse(response);
      if (error.code === "slow_down") interval += 5;
      else if (error.code !== "authorization_pending") throw error;
    }
    throw new Error("The code expired before it was approved.");
  }

  async #refresh(credentials: Credentials): Promise<Credentials | undefined> {
    if (!credentials.refreshToken) return undefined;
    const server = await this.#discover();
    try {
      const tokens = await refreshAuthorization(server.url, {
        metadata: server.metadata,
        clientInformation: { client_id: credentials.clientId },
        refreshToken: credentials.refreshToken,
        resource: server.resource,
      });
      return await this.#save(credentials.clientId, {
        ...tokens,
        refresh_token: tokens.refresh_token ?? credentials.refreshToken,
      });
    } catch (error) {
      if (!(error instanceof OAuthError && error.code === OAuthErrorCode.InvalidGrant)) {
        throw error;
      }
      // Another bounty-mcp process may have already used this refresh token.
      const latest = await this.#read();
      if (latest?.refreshToken !== credentials.refreshToken) return latest;
      await this.#write({ clientId: credentials.clientId });
      return undefined;
    }
  }

  #save(
    clientId: string,
    tokens: Pick<OAuthTokens, "access_token" | "refresh_token" | "expires_in">,
  ): Promise<Credentials> {
    const credentials: Credentials = { clientId, accessToken: tokens.access_token };
    if (tokens.refresh_token) credentials.refreshToken = tokens.refresh_token;
    if (tokens.expires_in !== undefined) {
      credentials.expiresAt = Date.now() + tokens.expires_in * 1000;
    }
    return this.#write(credentials).then(() => credentials);
  }

  async #read(): Promise<Credentials | undefined> {
    return (await this.#readFile())[this.serverUrl.href];
  }

  async #readFile(): Promise<z.infer<typeof credentialsFileSchema>> {
    const contents = await readFile(this.#path, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "{}";
      throw error;
    });
    return credentialsFileSchema.parse(JSON.parse(contents));
  }

  async #write(credentials: Credentials | undefined): Promise<void> {
    const file = await this.#readFile();
    if (credentials) file[this.serverUrl.href] = credentials;
    else delete file[this.serverUrl.href];
    await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
    const temporary = `${this.#path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(file, undefined, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, this.#path);
  }
}
