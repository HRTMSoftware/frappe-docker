import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { projectRoot } from "./config.js";

const execFileAsync = promisify(execFile);
const commandTimeoutMs = 15 * 60 * 1000;

export const appOpsPhases = {
  frappe_app_status: "observe",
  frappe_migrate_site: "operate",
  frappe_reload_workers: "operate",
} as const;

interface InstanceConfig {
  deployment: "production" | "development";
  frappe_bench: string;
  instance_sites: Array<{ site_name: string }>;
}

async function readInstanceConfig(): Promise<InstanceConfig> {
  const configPath = path.join(projectRoot, "instance.json");
  const value: unknown = JSON.parse(await readFile(configPath, "utf8"));
  if (!value || typeof value !== "object") throw new Error("instance.json must contain an object");
  const config = value as Partial<InstanceConfig>;
  if (config.deployment !== "production" && config.deployment !== "development") {
    throw new Error("instance.json deployment must be production or development");
  }
  if (!config.frappe_bench || !Array.isArray(config.instance_sites)) {
    throw new Error("instance.json must define frappe_bench and instance_sites");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(config.frappe_bench)) {
    throw new Error("instance.json frappe_bench must contain only letters, numbers, underscores, and hyphens");
  }
  return config as InstanceConfig;
}

function configuredSites(config: InstanceConfig): string[] {
  const sites = config.instance_sites.map(item => item?.site_name).filter((name): name is string => Boolean(name));
  if (sites.length === 0) throw new Error("instance.json has no configured sites");
  return sites;
}

async function runCompose(args: string[], timeout = commandTimeoutMs) {
  const command = ["docker", "compose", ...args];
  try {
    const result = await execFileAsync(command[0]!, command.slice(1), {
      cwd: projectRoot,
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      encoding: "utf8",
    });
    return { command: command.join(" "), stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  } catch (error) {
    const failure = error as Error & { code?: string | number; stdout?: string; stderr?: string };
    const details = [failure.stderr?.trim(), failure.stdout?.trim(), failure.message].filter(Boolean).join("\n");
    const accessHint = failure.code === "EACCES" || /permission denied.*docker|docker daemon/i.test(details)
      ? " Check that the MCP process user can access the Docker daemon."
      : "";
    throw new Error(`${command.join(" ")} failed: ${details.slice(0, 6000)}.${accessHint}`);
  }
}

export function registerAppOpsTools(server: McpServer): void {
  server.registerTool("frappe_app_status", {
    title: "Frappe: app service status",
    description: "Read the configured Frappe deployment mode and site list, then report Docker Compose status for the Frappe service.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    const config = await readInstanceConfig();
    const compose = await runCompose(["ps", "--format", "json", "frappe"], 30_000);
    const result = { deployment: config.deployment, bench: config.frappe_bench, sites: configuredSites(config), ...compose };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
  });

  server.registerTool("frappe_migrate_site", {
    title: "Frappe: migrate configured site",
    description:
      "Run `bench --site <site> migrate` inside the Frappe service. This applies patches and schema changes to that site's database. " +
      "Only sites listed in instance.json are accepted; pass confirm=true to execute.",
    inputSchema: {
      site: z.string().min(1).describe("Exact site_name from instance.json"),
      confirm: z.literal(true).describe("Explicitly confirm running the site migration"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  }, async ({ site }) => {
    const config = await readInstanceConfig();
    const allowedSites = configuredSites(config);
    if (!allowedSites.includes(site)) throw new Error(`Site '${site}' is not configured. Allowed sites: ${allowedSites.join(", ")}`);
    const result = await runCompose(["exec", "-T", "frappe", "bench", "--site", site, "migrate"]);
    const output = { operation: "migrate", site, ...result };
    return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }], structuredContent: output };
  });

  server.registerTool("frappe_reload_workers", {
    title: "Frappe: reload workers",
    description:
      "Reload Python and worker code after changes. Production restarts the configured Supervisor web and worker groups, including web, Socket.IO, scheduler, and queue workers. " +
      "Development restarts the Frappe container running `bench start`. This can briefly interrupt requests; pass confirm=true to execute.",
    inputSchema: {
      confirm: z.literal(true).describe("Explicitly confirm restarting the Frappe runtime"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async () => {
    const config = await readInstanceConfig();
    const result = config.deployment === "production"
      ? await runCompose([
        "exec", "-T", "frappe", "sudo", "supervisorctl", "-c", "/tmp/supervisor-merged.tmp", "restart",
        `${config.frappe_bench}-workers:*`, `${config.frappe_bench}-web:*`,
      ], 5 * 60 * 1000)
      : await runCompose(["restart", "frappe"], 5 * 60 * 1000);
    const output = { operation: "reload_workers", deployment: config.deployment, ...result };
    return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }], structuredContent: output };
  });
}
