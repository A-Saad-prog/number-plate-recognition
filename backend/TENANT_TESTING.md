# Tenant isolation smoke test

After migrating, run `create_tenant_admin.py "Test Mall" mall_admin` and `create_tenant_admin.py "Test Society" society_admin`, entering passwords interactively. Configure Mall as 5 levels × 10 spaces, billing enabled, and 3 entry / 1 exit cameras. Configure Society as 2 levels × 20 spaces, billing disabled, and 1 entry / 1 exit camera.

Sign in separately as each admin. The Garage and Admin APIs use the authenticated admin's tenant server-side; they do not accept a tenant identifier from the browser. Confirm each account only sees its own settings, spaces, sessions, vehicles, whitelist, activity, and admin log. Repeating another tenant's space ID or plate against an authenticated API request must return no cross-tenant data or reject the request.
