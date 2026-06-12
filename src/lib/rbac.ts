export const APP_ROLES = ["owner", "admin", "manager", "cashier", "kitchen", "waiter"] as const;

export type AppRole = (typeof APP_ROLES)[number];

export const ADMIN_ROLES = ["owner", "admin"] as const satisfies readonly AppRole[];
export const MANAGER_ROLES = ["owner", "admin", "manager"] as const satisfies readonly AppRole[];

export const APP_PERMISSIONS = [
  "dashboard:view",
  "pos:use",
  "orders:view",
  "orders:manage",
  "orders:adjust",
  "orders:admin",
  "receipts:view",
  "customers:view",
  "customers:manage",
  "menu:manage",
  "inventory:view",
  "inventory:manage",
  "expenses:view",
  "expenses:manage",
  "staff:manage",
  "settings:manage",
  "branches:manage",
] as const;

export type AppPermission = (typeof APP_PERMISSIONS)[number];

export type RoleLike = { role: AppRole };

const ALL_PERMISSIONS = APP_PERMISSIONS;

export const ROLE_PERMISSIONS: Record<AppRole, readonly AppPermission[]> = {
  owner: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS,
  manager: [
    "dashboard:view",
    "pos:use",
    "orders:view",
    "orders:manage",
    "orders:adjust",
    "receipts:view",
    "customers:view",
    "customers:manage",
    "menu:manage",
    "inventory:view",
    "inventory:manage",
    "expenses:view",
    "expenses:manage",
  ],
  cashier: ["pos:use", "orders:view", "orders:manage", "receipts:view", "customers:view"],
  waiter: ["pos:use", "orders:view", "receipts:view", "customers:view"],
  kitchen: ["orders:view", "receipts:view"],
};

const DEFAULT_PATH_BY_ROLE: Record<AppRole, string> = {
  owner: "/dashboard",
  admin: "/dashboard",
  manager: "/dashboard",
  cashier: "/pos",
  waiter: "/pos",
  kitchen: "/orders",
};

const ROLE_PRIORITY = ["owner", "admin", "manager", "cashier", "waiter", "kitchen"] as const;

export const ROUTE_PERMISSIONS: Array<{
  path: string;
  permissions: readonly AppPermission[];
}> = [
  { path: "/dashboard", permissions: ["dashboard:view"] },
  { path: "/pos", permissions: ["pos:use"] },
  { path: "/orders", permissions: ["orders:view"] },
  { path: "/receipt", permissions: ["receipts:view"] },
  { path: "/customers", permissions: ["customers:view"] },
  { path: "/promotions", permissions: ["customers:manage"] },
  { path: "/menu", permissions: ["menu:manage"] },
  { path: "/inventory", permissions: ["inventory:view"] },
  { path: "/expenses", permissions: ["expenses:view"] },
  { path: "/staff", permissions: ["staff:manage"] },
  { path: "/settings", permissions: ["settings:manage"] },
  { path: "/branches", permissions: ["branches:manage"] },
];

export function rolesInclude(
  roles: ReadonlyArray<RoleLike> | null | undefined,
  allowedRoles: readonly AppRole[],
) {
  return !!roles?.some((role) => allowedRoles.includes(role.role));
}

export function isAdminRole(roles: ReadonlyArray<RoleLike> | null | undefined) {
  return rolesInclude(roles, ADMIN_ROLES);
}

export function isManagerRole(roles: ReadonlyArray<RoleLike> | null | undefined) {
  return rolesInclude(roles, MANAGER_ROLES);
}

export function hasPermission(
  roles: ReadonlyArray<RoleLike> | null | undefined,
  permission: AppPermission,
) {
  return !!roles?.some((role) => ROLE_PERMISSIONS[role.role]?.includes(permission));
}

export function hasAnyPermission(
  roles: ReadonlyArray<RoleLike> | null | undefined,
  permissions: readonly AppPermission[],
) {
  return permissions.some((permission) => hasPermission(roles, permission));
}

export function hasOperationalAccess(roles: ReadonlyArray<RoleLike> | null | undefined) {
  return !!roles?.length;
}

export function permissionsForPath(path: string) {
  return (
    ROUTE_PERMISSIONS.find(
      (route) => path === route.path || path.startsWith(`${route.path}/`),
    )?.permissions ?? []
  );
}

export function canAccessPath(roles: ReadonlyArray<RoleLike> | null | undefined, path: string) {
  const permissions = permissionsForPath(path);
  return permissions.length === 0 || hasAnyPermission(roles, permissions);
}

export function firstAllowedPath(roles: ReadonlyArray<RoleLike> | null | undefined) {
  if (!roles?.length) return "/";
  const roleSet = new Set(roles.map((role) => role.role));
  for (const role of ROLE_PRIORITY) {
    if (roleSet.has(role)) return DEFAULT_PATH_BY_ROLE[role];
  }
  return "/";
}
