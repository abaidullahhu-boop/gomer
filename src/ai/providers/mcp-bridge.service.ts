import { Inject, Injectable, Logger } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/constants';
import { RemoteMcpServer, ToolSpec } from './provider.interface';

/**
 * How long a server's tool list stays cached. Connected apps rarely change their
 * tool surface, and listing costs a full MCP handshake per app per run.
 */
const TOOL_CACHE_TTL_SECONDS = 600;

/**
 * Upper bound on bridged tools per run. Every schema is sent on every request,
 * so an unbounded list would quietly dominate the prompt (and the bill) on
 * workspaces with many connected apps.
 *
 * This is the ceiling on what a run ultimately sends. The relevance router
 * ({@link ToolRouterService}) usually narrows well below it first; this only
 * bites when routing is skipped or declines to filter.
 */
export const MAX_BRIDGED_TOOLS = 60;

/**
 * How many tools the toolset carries *before* relevance routing. The router
 * needs to see the full surface to choose from it, so the initial build keeps
 * more than {@link MAX_BRIDGED_TOOLS}; the final cap is applied afterwards via
 * {@link BridgedToolset.narrowTo}. Still bounded so a pathological workspace
 * cannot produce an unbounded router prompt.
 */
const MAX_CANDIDATE_TOOLS = 200;

/** OpenAI restricts tool names to this shape and length. */
const MAX_TOOL_NAME_LENGTH = 64;

/** A bridged tool, and where to send its calls. */
interface BridgedTool {
  /** Namespaced name exposed to the model, e.g. `slack__send_message`. */
  exposedName: string;
  /** The tool's real name on its MCP server. */
  remoteName: string;
  server: RemoteMcpServer;
}

/** The result of running a bridged tool, shaped like a local tool's result. */
export interface BridgedToolResult {
  content: string;
  isError: boolean;
}

/**
 * A run's bridged toolset: the specs to send to the model, plus the routing
 * needed to execute what it calls back.
 */
export class BridgedToolset {
  constructor(
    private readonly bridge: McpBridgeService,
    private readonly byExposedName: Map<string, BridgedTool>,
    /** App slugs whose tools actually resolved, for the run's "connected apps". */
    readonly apps: string[],
    readonly tools: ToolSpec[],
  ) {}

  has(name: string): boolean {
    return this.byExposedName.has(name);
  }

  /** The app a tool belongs to, for the run's action audit. */
  appFor(name: string): string {
    return this.byExposedName.get(name)?.server.appSlug ?? 'app';
  }

  /**
   * A copy carrying only `keep`, capped to `limit`, with routing and the
   * announced app list recomputed to match. Used after relevance routing so
   * that what the model is told it has, what it is sent, and what it can
   * actually execute all stay in agreement. The incoming order is preserved, so
   * an app-fair candidate list stays app-fair after the cap.
   */
  narrowTo(keep: ToolSpec[], limit: number): BridgedToolset {
    const tools = keep.slice(0, limit);
    const byExposedName = new Map<string, BridgedTool>();
    const apps: string[] = [];
    for (const tool of tools) {
      const routing = this.byExposedName.get(tool.name);
      if (!routing) continue;
      byExposedName.set(tool.name, routing);
      if (!apps.includes(routing.server.appSlug)) apps.push(routing.server.appSlug);
    }
    return new BridgedToolset(this.bridge, byExposedName, apps, tools);
  }

  call(name: string, input: Record<string, unknown>): Promise<BridgedToolResult> {
    const tool = this.byExposedName.get(name);
    if (!tool) {
      return Promise.resolve({ content: `Unknown tool: ${name}`, isError: true });
    }
    return this.bridge.callTool(tool, input);
  }
}

/**
 * Runs the MCP client side ourselves, for providers that cannot.
 *
 * Anthropic accepts remote MCP servers directly and executes those tools on its
 * own infrastructure; every other provider speaks plain function calling, so for
 * those we connect to each Pipedream server, list its tools, present them as
 * ordinary tools, and execute the calls the model makes.
 */
@Injectable()
export class McpBridgeService {
  private readonly logger = new Logger(McpBridgeService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Resolve every server's tools into one namespaced toolset.
   *
   * A server that cannot be reached is dropped rather than failing the run —
   * matching how the Anthropic path degrades — so a broken connector costs the
   * user that app, not the whole answer.
   */
  async buildToolset(servers: RemoteMcpServer[]): Promise<BridgedToolset> {
    const byExposedName = new Map<string, BridgedTool>();
    const tools: ToolSpec[] = [];
    const apps: string[] = [];

    const listings = await Promise.all(
      servers.map(async (server) => ({ server, tools: await this.listTools(server) })),
    );

    // Take one tool from each app in turn rather than draining them in order.
    // Filling greedily let the first app or two consume the whole budget, so
    // later apps contributed nothing and the model simply could not act on them
    // — while still being told they were connected.
    const queues = listings
      .filter((listing) => listing.tools.length > 0)
      .map((listing) => ({ server: listing.server, remaining: [...listing.tools] }));
    const contributed = new Set<string>();

    while (tools.length < MAX_CANDIDATE_TOOLS && queues.some((queue) => queue.remaining.length)) {
      for (const queue of queues) {
        if (tools.length >= MAX_CANDIDATE_TOOLS) break;
        const remote = queue.remaining.shift();
        if (!remote) continue;
        const exposedName = this.exposedName(queue.server.appSlug, remote.name, byExposedName);
        byExposedName.set(exposedName, {
          exposedName,
          remoteName: remote.name,
          server: queue.server,
        });
        tools.push({
          name: exposedName,
          description: remote.description,
          parameters: remote.parameters,
        });
        // Only claim an app once it has a tool the model can actually call;
        // announcing one with nothing behind it invites confident nonsense.
        if (!contributed.has(queue.server.appSlug)) {
          contributed.add(queue.server.appSlug);
          apps.push(queue.server.appSlug);
        }
      }
    }

    const total = listings.reduce((sum, listing) => sum + listing.tools.length, 0);
    // Only a workspace past the candidate ceiling loses tools before the model
    // ever sees them; below it, relevance routing (not this cap) does the
    // narrowing, so there is nothing to warn about.
    if (total > MAX_CANDIDATE_TOOLS) {
      const perApp = queues
        .map((queue) => `${queue.server.appSlug}:${queue.remaining.length} dropped`)
        .join(', ');
      this.logger.warn(
        `Connected apps expose ${total} tools; capping candidates at ${tools.length} across ${apps.length} apps before routing (${perApp})`,
      );
    }

    return new BridgedToolset(this, byExposedName, apps, tools);
  }

  /**
   * Prefix with the app slug so two apps can both expose e.g. `list_items`, and
   * keep the result inside the character set and length providers accept.
   */
  private exposedName(
    appSlug: string,
    remoteName: string,
    taken: Map<string, BridgedTool>,
  ): string {
    const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_');
    let name = `${sanitize(appSlug)}__${sanitize(remoteName)}`.slice(0, MAX_TOOL_NAME_LENGTH);
    // Truncation can collide; a numeric suffix keeps names unique.
    let suffix = 2;
    while (taken.has(name)) {
      const tail = `_${suffix}`;
      name = `${name.slice(0, MAX_TOOL_NAME_LENGTH - tail.length)}${tail}`;
      suffix += 1;
    }
    return name;
  }

  private async listTools(server: RemoteMcpServer): Promise<ToolSpec[]> {
    const cacheKey = `mcp:tools:${server.name}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as ToolSpec[];
    } catch (error) {
      // A cache miss must never be fatal; fall through to a live listing.
      this.logger.debug(`Tool cache read failed for ${server.name}: ${String(error)}`);
    }

    let client: Client | null = null;
    try {
      client = await this.connect(server);
      const listed = await client.listTools();
      const tools: ToolSpec[] = listed.tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? tool.name,
        parameters: tool.inputSchema,
      }));
      try {
        await this.redis.set(cacheKey, JSON.stringify(tools), 'EX', TOOL_CACHE_TTL_SECONDS);
      } catch {
        // Caching is an optimisation, not a requirement.
      }
      return tools;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not list tools for ${server.appSlug}, skipping it: ${message}`);
      return [];
    } finally {
      await this.close(client);
    }
  }

  /** Execute one bridged call. Failures become readable results, never throws. */
  async callTool(tool: BridgedTool, input: Record<string, unknown>): Promise<BridgedToolResult> {
    let client: Client | null = null;
    try {
      client = await this.connect(tool.server);
      const result = await client.callTool({ name: tool.remoteName, arguments: input });
      const content = Array.isArray(result.content)
        ? result.content
            .map((block) => (block.type === 'text' ? block.text : `[${block.type}]`))
            .join('\n')
        : JSON.stringify(result);
      return { content: content || 'Done.', isError: Boolean(result.isError) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Bridged tool ${tool.exposedName} failed: ${message}`);
      return { content: `Tool failed: ${message}`, isError: true };
    } finally {
      await this.close(client);
    }
  }

  private async connect(server: RemoteMcpServer): Promise<Client> {
    const transport = new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: server.authorizationToken
        ? { headers: { Authorization: `Bearer ${server.authorizationToken}` } }
        : undefined,
    });
    const client = new Client({ name: 'gomer', version: '1.0.0' });
    await client.connect(transport);
    return client;
  }

  private async close(client: Client | null): Promise<void> {
    if (!client) return;
    try {
      await client.close();
    } catch {
      // Nothing useful to do if teardown fails; the socket will time out.
    }
  }
}
