-- The Worker connects as k3_app. It owns no tables, so row-level security applies to
-- every query it runs. Migrations run as the owning (admin) role, never as k3_app.
--
-- In Neon: create a login role named k3_app in the project, then set its password as the
-- Hyperdrive origin credentials. This migration only grants it table access.

GRANT USAGE ON SCHEMA public TO k3_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO k3_app;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO k3_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO k3_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO k3_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_is_member() TO k3_app;--> statement-breakpoint
-- The audit log is append-only for the application role.
REVOKE UPDATE, DELETE ON audit_log FROM k3_app;
