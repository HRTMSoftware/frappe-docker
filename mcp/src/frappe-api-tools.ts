import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BrowserConfig } from "./config.js";

export const frappeApiPhases = {
  frappe_get_list:   "observe",
  frappe_get_doc:    "observe",
  frappe_save_doc:   "interact",
  frappe_submit_doc: "interact",
  frappe_cancel_doc: "interact",
  frappe_call:       "interact",
  hrtmpay_calculate_payroll: "observe",
} as const;

interface ApiSession {
  cookie: string | null;
}

function apiSession(): ApiSession {
  return { cookie: null };
}

async function frappeRequest(
  config: BrowserConfig,
  session: ApiSession,
  path: string,
  options: {
    method?: string;
    params?: Record<string, string>;
    body?: Record<string, unknown>;
  } = {},
): Promise<unknown> {
  const { method = "GET", params, body } = options;

  let url = `${config.baseUrl}${path}`;
  if (params) {
    url += `?${new URLSearchParams(Object.entries(params)).toString()}`;
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (session.cookie) headers["Cookie"] = session.cookie;

  const init: RequestInit = { method, headers };
  if (body) {
    headers["Content-Type"] = "application/json";
    (init as RequestInit & { body: string }).body = JSON.stringify(body);
  }

  const res = await fetch(url, init);

  const setCookie = res.headers.get("set-cookie");
  if (setCookie && !session.cookie) {
    const sid = setCookie.split(";")[0];
    if (sid?.includes("sid=")) session.cookie = sid;
  }

  if (!res.ok) {
    let detail = "";
    try {
      const errBody = await res.json() as Record<string, unknown>;
      detail = (errBody.exception as string) || JSON.stringify(errBody);
    } catch {
      detail = await res.text();
    }
    throw new Error(`Frappe API ${res.status}: ${detail}`);
  }

  return res.json();
}

async function login(config: BrowserConfig, session: ApiSession): Promise<void> {
  if (session.cookie) return;
  if (!config.password) throw new Error("FRAPPE_UI_PASSWORD / FRAPPE_ADMIN_PASSWORD not set");
  await frappeRequest(config, session, "/api/method/login", {
    method: "POST",
    body: { usr: config.username, pwd: config.password },
  });
}

function json(value: unknown) {
  const text = JSON.stringify(value, null, 2);
  const structuredContent = Array.isArray(value) ? { items: value } : (value as Record<string, unknown>);
  return { content: [{ type: "text" as const, text }], structuredContent };
}

export function registerFrappeApiTools(server: McpServer, config: BrowserConfig): void {
  const withSession = async (fn: (s: ApiSession) => Promise<unknown>) => {
    const s = apiSession();
    await login(config, s);
    return fn(s);
  };

  server.registerTool("frappe_get_list", {
    title: "Frappe: list documents",
    description:
      "Return a list of documents for a given DocType. Supports filtering, field selection, ordering, and pagination.",
    inputSchema: {
      doctype:  z.string().min(1).describe("e.g. 'Salary Structure'"),
      fields:   z.array(z.string()).optional().describe("Fields to return, default ['name']"),
      filters:  z.array(z.tuple([z.string(), z.string(), z.string()])).optional()
                  .describe("Array of [field, operator, value] filter tuples"),
      order_by: z.string().optional().describe("e.g. 'creation desc'"),
      limit:    z.number().int().min(1).max(500).default(100),
      start:    z.number().int().min(0).default(0).describe("Pagination offset"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ doctype, fields, filters, order_by, limit, start }) =>
    json(await withSession(async s => {
      const params: Record<string, string> = {
        doctype,
        limit_page_length: String(limit),
        limit_start: String(start),
      };
      if (fields)   params.fields   = JSON.stringify(fields);
      if (filters)  params.filters  = JSON.stringify(filters);
      if (order_by) params.order_by = order_by;
      const res = await frappeRequest(config, s, "/api/method/frappe.client.get_list", { params }) as Record<string, unknown>;
      return res.message;
    })));

  server.registerTool("frappe_get_doc", {
    title: "Frappe: get document",
    description: "Fetch a single Frappe document by DocType and name, including all child tables.",
    inputSchema: {
      doctype: z.string().min(1),
      name:    z.string().min(1),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ doctype, name }) =>
    json(await withSession(async s => {
      const res = await frappeRequest(config, s, "/api/method/frappe.client.get", {
        params: { doctype, name },
      }) as Record<string, unknown>;
      return res.message;
    })));

  server.registerTool("frappe_save_doc", {
    title: "Frappe: save (insert or update) document",
    description:
      "Insert a new document or update an existing one. Omit 'name' to insert; include 'name' to update. " +
      "The doc object must contain 'doctype'. Returns the saved document.",
    inputSchema: {
      doc: z.record(z.string(), z.unknown())
             .describe("Document object with at least 'doctype' and 'name' (for update)"),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, async ({ doc }) =>
    json(await withSession(async s => {
      const doctype = (doc as Record<string, unknown>).doctype as string;
      const name    = (doc as Record<string, unknown>).name as string | undefined;
      let res: Record<string, unknown>;
      if (name) {
        res = await frappeRequest(config, s,
          `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`, {
          method: "PUT",
          body: { data: JSON.stringify(doc) },
        }) as Record<string, unknown>;
      } else {
        res = await frappeRequest(config, s,
          `/api/resource/${encodeURIComponent(doctype)}`, {
          method: "POST",
          body: { data: JSON.stringify(doc) },
        }) as Record<string, unknown>;
      }
      return res.data;
    })));

  server.registerTool("frappe_submit_doc", {
    title: "Frappe: submit document",
    description: "Submit a saved Frappe document (docstatus 0 → 1). Document must exist in Draft state.",
    inputSchema: {
      doctype: z.string().min(1),
      name:    z.string().min(1),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, async ({ doctype, name }) =>
    json(await withSession(async s => {
      const getRes = await frappeRequest(config, s, "/api/method/frappe.client.get", {
        params: { doctype, name },
      }) as Record<string, unknown>;
      const doc = getRes.message as Record<string, unknown>;
      doc.docstatus = 1;
      const putRes = await frappeRequest(config, s,
        `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`, {
        method: "PUT",
        body: { data: JSON.stringify(doc) },
      }) as Record<string, unknown>;
      return { submitted: true, name, doctype, doc: putRes.data };
    })));

  server.registerTool("frappe_cancel_doc", {
    title: "Frappe: cancel document",
    description:
      "Cancel a submitted Frappe document (docstatus 1 → 2). " +
      "Returns cancelled: false if the document is not in Submitted state.",
    inputSchema: {
      doctype: z.string().min(1),
      name:    z.string().min(1),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, async ({ doctype, name }) =>
    json(await withSession(async s => {
      const getRes = await frappeRequest(config, s, "/api/method/frappe.client.get", {
        params: { doctype, name },
      }) as Record<string, unknown>;
      const doc = getRes.message as Record<string, unknown>;
      if (doc.docstatus !== 1) {
        return { cancelled: false, name, doctype, reason: `docstatus is ${doc.docstatus as number}, expected 1` };
      }
      doc.docstatus = 2;
      const putRes = await frappeRequest(config, s,
        `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`, {
        method: "PUT",
        body: { data: JSON.stringify(doc) },
      }) as Record<string, unknown>;
      return { cancelled: true, name, doctype, doc: putRes.data };
    })));

  server.registerTool("frappe_call", {
    title: "Frappe: call whitelisted method",
    description:
      "Call any Frappe whitelisted server-side method (frappe.client.*, custom app methods, etc.). " +
      "Pass 'method' as the dotted Python path and optional 'args' as a key/value object.",
    inputSchema: {
      method: z.string().min(1).describe("Dotted method path, e.g. 'frappe.client.get_value'"),
      args:   z.record(z.string(), z.unknown()).optional()
                .describe("Keyword arguments to pass to the method"),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, async ({ method, args }) =>
    json(await withSession(async s => {
      const res = await frappeRequest(config, s, `/api/method/${method}`, {
        method: "POST",
        body: { ...(args ?? {}) },
      }) as Record<string, unknown>;
      return res;
    })));

  server.registerTool("hrtmpay_calculate_payroll", {
    title: "HrtmPay: calculate payroll preview",
    description:
      "Run HrtmPay's side effect free payroll preview for an employee or explicit test case. " +
      "When employee is supplied, load submitted year-to-date payroll totals and use the employee's effective PAYE engine and allowance. " +
      "Without employee, provide engine and date_of_birth (unless only_pension_income is true) to reproduce an edge case. " +
      "Returns NIS, HSG, PAYE, net pay, effective NIS table breakdown, and statutory rules applied. Does not create or update payroll documents.",
    inputSchema: {
      gross: z.number().nonnegative().describe("Gross earnings for this payroll period"),
      frequency: z.enum(["weekly", "fortnightly", "monthly", "bimonthly"]),
      period_start: z.string().date(),
      period_end: z.string().date(),
      employee: z.string().min(1).optional().describe("Employee ID; loads YTD history, date of birth, allowance, and assigned PAYE engine"),
      engine: z.string().min(1).optional().describe("PAYE engine key from HrtmPay; validation is handled by HrtmPay"),
      date_of_birth: z.string().date().optional(),
      only_pension_income: z.boolean().optional(),
      annual_personal_allowance: z.number().nonnegative().optional(),
      ytd_gross: z.number().nonnegative().optional(),
      ytd_nis: z.number().nonnegative().optional(),
      ytd_hsg: z.number().nonnegative().optional(),
      ytd_paye_withheld: z.number().nonnegative().optional(),
      period_index: z.number().int().min(1).optional(),
      cleanup: z.boolean().optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async input => json(await withSession(async s => {
    let employeeData: Record<string, unknown> | undefined;
    if (input.employee) {
      const response = await frappeRequest(config, s, "/api/method/hrtmpay.api.get_calculator_employee_data", {
        method: "POST",
        body: {
          employee: input.employee,
          period_start: input.period_start,
          period_end: input.period_end,
        },
      }) as Record<string, unknown>;
      employeeData = response.message as Record<string, unknown>;
    } else if (!input.engine) {
      throw new Error("engine is required when employee is not supplied");
    }

    const ytd = (employeeData?.ytd ?? {}) as Record<string, unknown>;
    const response = await frappeRequest(config, s, "/api/method/hrtmpay.api.calculate_preview", {
      method: "POST",
      body: {
        gross: input.gross,
        frequency: input.frequency,
        period_start: input.period_start,
        period_end: input.period_end,
        employee: input.employee,
        engine: input.engine ?? employeeData?.paye_engine,
        date_of_birth: input.date_of_birth ?? employeeData?.date_of_birth,
        only_pension_income: input.only_pension_income ?? employeeData?.only_pension_income ?? 0,
        annual_personal_allowance: input.annual_personal_allowance ?? employeeData?.assigned_allowance_total ?? 0,
        ytd_gross: input.ytd_gross ?? ytd.gross ?? 0,
        ytd_nis: input.ytd_nis ?? ytd.nis ?? 0,
        ytd_hsg: input.ytd_hsg ?? ytd.hsg ?? 0,
        ytd_paye_withheld: input.ytd_paye_withheld ?? ytd.paye ?? 0,
        period_index: input.period_index ?? employeeData?.period_index ?? 1,
        cleanup: input.cleanup ?? 0,
      },
    }) as Record<string, unknown>;
    return {
      calculation: response.message,
      employee_context: employeeData ? {
        employee: employeeData.employee,
        paye_engine: employeeData.paye_engine,
        paye_engine_assignment: employeeData.paye_engine_assignment,
        paye_engine_is_default: employeeData.paye_engine_is_default,
        assigned_allowance_total: employeeData.assigned_allowance_total,
        allowance_assignments: employeeData.allowance_assignments,
        ytd: employeeData.ytd,
        prior_slip_count: employeeData.prior_slip_count,
        period_index: employeeData.period_index,
      } : null,
      compliance_score: null,
      compliance_score_note: "HrtmPay does not currently calculate a numeric compliance score; use the returned statutory rules, effective tables, and audit details to assess the case.",
    };
  })));
}
