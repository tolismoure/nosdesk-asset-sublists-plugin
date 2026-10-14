# Permissions and roles

## Plugin grants are separate from account roles

| Plugin | Requested grants |
| --- | --- |
| Asset Sublists | asset:read, storage:plugin |
| Asset History | asset:read, asset:history:read |

Administration → Plugins shows each manifest's requested permissions. An awaiting-consent plugin needs Approve & enable; requested permissions alone are not proof of recorded consent. A locally signed installation uses the supported instance trust/consent path. Active state, manifest permission and consented permission are checked by the server.

The Sublists plugin has no added administrator-only taxonomy policy. Host access, asset authorization, plugin runtime availability and SDK grants still apply.

## History requires all gates

1. Authenticated membership with workspace Admin or Owner authority.
2. Platform audit authority: platform_admin or audit_reviewer.
3. audit:read credential scope, or the full scope browser sessions carry.
4. An active, approved Asset History plugin with asset:history:read.

| Platform role | Workspace role | Approved history grant | Result |
| --- | --- | --- | --- |
| user | admin | Yes | Denied by upstream audit gate |
| audit_reviewer | admin/owner | Yes | Allowed with audit:read/full scope |
| platform_admin | admin/owner | Yes | Allowed with audit:read/full scope |
| audit_reviewer | member | Yes | Denied by workspace administration gate |
| audit_reviewer | admin/owner | No | Denied by plugin grant gate |

Choosing Admin in the People role picker grants workspace administration; it does not make the account a platform administrator. Choosing the single Audit Reviewer tier in that picker can also change workspace membership to member. Preserve the intended workspace role when assigning the separate platform role.

Audit Reviewer grants access to Nosdesk's wider audit surface as well as this viewer. It is not a permission restricted solely to asset history. This extension deliberately keeps upstream audit authorization instead of bypassing it. After a role change, sign out and back in to obtain fresh session claims.

## Diagnose without changing roles

Run within a PostgreSQL session with authorized read access:

~~~sql
BEGIN READ ONLY;
SELECT u.uuid, u.name, u.platform_role, wm.workspace_id, wm.role AS workspace_role
FROM users u
JOIN workspace_members wm ON wm.user_uuid = u.uuid
WHERE u.deleted_at IS NULL AND wm.removed_at IS NULL;

SELECT workspace_id, name, state, manifest->'permissions' AS requested_permissions,
       consented_permissions AS approved_permissions
FROM plugins
WHERE name IN ('asset-categories','asset-history');
ROLLBACK;
~~~

Filter account queries to the intended user's UUID/email before sharing output. Do not paste password hashes, MFA secrets, tokens, expanded Compose environments or private signing keys. Prefer an authorized account-management workflow; version 1.1.0's bundled CLI does not provide a general platform-role-setting command. Any necessary server-side maintenance should target exactly one verified account, preserve its workspace role, set audit context, and use a transaction. This repository does not auto-promote accounts during plugin installation.
