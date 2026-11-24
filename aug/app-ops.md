# Frappe App Operations Guide

These tools run a fixed set of Docker Compose and Bench operations from the workspace root. The MCP process user must be able to access the Docker daemon.

## Status

Call `frappe_app_status` before maintenance to check deployment mode, configured sites, and whether the `frappe` service is running.

## Migrate a site

Call `frappe_migrate_site` with the exact site name from `instance.json` and `confirm: true`. This runs `bench --site <site> migrate` inside the Frappe container. Frappe migration can apply patches and alter the site's schema, so only run it after code and database backups or in the intended development environment.

## Reload workers

Call `frappe_reload_workers` with `confirm: true` after changing Python code. In production mode this restarts the configured Supervisor worker and web groups, including the scheduler, queue workers, gunicorn, and Socket.IO. In development mode it restarts the `frappe` Compose service running `bench start`. Requests may be briefly interrupted.

## Access requirements

The tools do not accept arbitrary shell commands, Compose services, or site paths. They use the repository's `instance.json`, pass arguments without a shell, and reject sites absent from `instance_sites`. Configure Docker daemon access for the user that launches the MCP server; without it, operations return the Docker permission error and a setup hint.
