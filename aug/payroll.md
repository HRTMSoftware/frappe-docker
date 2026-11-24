# Payroll validation sequence

## Payroll preview MCP tool

Call `hrtmpay_calculate_payroll` to run the HrtmPay calculator without creating or changing payroll documents.

- `employee` is optional. For an employee, the tool loads submitted year-to-date totals and the effective PAYE engine and allowance; supplied YTD values can reproduce a different history. Without an employee, provide `engine`, `date_of_birth` (unless `only_pension_income` is true), and the period inputs to run a manual case.
- The inputs mirror the Hub calculator: gross, frequency, period start/end, engine, employee, date of birth, annual allowance, pension-only status, prior YTD gross/NIS/HSG/PAYE, period number, and cleanup status. The tool passes them to HrtmPay's preview API; HrtmPay validates engine keys and performs the calculation.
- Review `calculation.rules_applied`, `calculation.nis_breakdown`, and `employee_context` to see the effective rules and inputs used. HrtmPay currently has no numeric compliance score; the tool returns the statutory rule evidence used by the calculator.

The tool calls `hrtmpay.api.calculate_preview` and `hrtmpay.api.get_calculator_employee_data`, so the running site's HrtmPay version and permissions control the result.

## Browser payroll validation sequence

Browser login, Frappe form/list/child-table inspection, and network diagnostics are available. Add focused browser workflows for company and departments, employees, holiday lists and assignments, salary components, salary structures, salary structure assignments, overtime configuration, payroll entries, salary slips, and reconciliation checks. Implement each workflow in a focused module under `mcp/src/`, register its tools, update its feature manifest, and regenerate the catalog.

For every workflow: inspect current records, diagnose missing links, create or update only the intended records, reopen to verify, then run an end-to-end test on a disposable employee and pay period. Record the expected and actual NIS, HSG, PAYE, gross, deductions, employer contributions, and net pay. Check both the UI and the resulting submitted documents before treating a payroll run as validated.
