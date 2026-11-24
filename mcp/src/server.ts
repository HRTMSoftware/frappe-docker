import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BrowserSession } from "./browser-session.js";
import { loadConfig } from "./config.js";
import { registerBrowserTools } from "./tools.js";
import { registerBrowserExtras } from "./browser-extras.js";
import { registerFrappeTools } from "./frappe-tools.js";
import { registerFrappeApiTools } from "./frappe-api-tools.js";
import { instrumentToolUsage } from "./tool-usage.js";
import { registerToolUsageOverview } from "./tool-usage-tool.js";
import { registerAppOpsTools } from "./app-ops-tools.js";

const session = new BrowserSession(await loadConfig());
const server = new McpServer(
  { name: "frappe-browser", version: "0.1.0" },
  { instructions: "Call browser_status, then browser_login if needed before browser work. Use browser_snapshot or browser_screenshot to inspect the live Frappe UI before interacting. For payroll previews use hrtmpay_calculate_payroll; it returns a side effect free HrtmPay calculation and its statutory rule details. All navigation stays on the configured site. Browser state is saved locally; do not enter secrets in generic fill tools." },
);

instrumentToolUsage(server, session.config.password ? [session.config.password] : []);
registerBrowserTools(server, session);
registerBrowserExtras(server, session);
registerFrappeTools(server, session);
registerFrappeApiTools(server, session.config);
registerAppOpsTools(server);
registerToolUsageOverview(server);
await server.connect(new StdioServerTransport());

process.on("SIGINT", () => { void session.close().finally(() => process.exit(0)); });
process.on("SIGTERM", () => { void session.close().finally(() => process.exit(0)); });
