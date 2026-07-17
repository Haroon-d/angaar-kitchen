import {
  createFileRoute,
  Outlet,
  redirect,
  Link,
  useRouterState,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Flame,
  LayoutDashboard,
  ChefHat,
  ScrollText,
  Users,
  UserRound,
  Settings,
  LogOut,
  Loader2,
  Store,
  Receipt,
  Package,
  Banknote,
  Gift,
  BriefcaseBusiness,
} from "lucide-react";
import { POSTGRES_SESSION_STORAGE_KEY } from "@/integrations/postgres/auth-middleware";
import { supabase } from "@/integrations/supabase/client";
import { appDb } from "@/lib/app-db";
import { useAuth, useMyRoles } from "@/hooks/use-auth";
import { useActiveBranch } from "@/hooks/use-active-branch";
import { isPostgresAuthEnabled } from "@/lib/auth-backend";
import { businessDateInputValue, formatMoney } from "@/lib/format";
import {
  canAccessPath,
  firstAllowedPath,
  hasOperationalAccess,
  hasPermission,
  type AppPermission,
} from "@/lib/rbac";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type DbError = { message: string };
type DbResult<T = unknown> = { data: T | null; error: DbError | null };
type DbQuery<T = unknown> = PromiseLike<DbResult<T>> & {
  select(columns?: string): DbQuery<T>;
  insert(values: unknown): DbQuery<unknown>;
  eq(column: string, value: unknown): DbQuery<T>;
  lt(column: string, value: unknown): DbQuery<T>;
  order(column: string, options?: { ascending?: boolean }): DbQuery<T>;
  limit(value: number): DbQuery<T>;
  maybeSingle(): DbQuery<T>;
};
type DbClient = { from(table: string): DbQuery };

const db = appDb as unknown as DbClient;

type FinanceDayClosure = {
  id: string;
  branch_id: string;
  business_date: string;
  opening_cash: number | string;
  opening_online: number | string;
  closed_at: string | null;
  notes: string | null;
};

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    if (isPostgresAuthEnabled()) {
      if (typeof window === "undefined") return;

      const token = window.localStorage.getItem(POSTGRES_SESSION_STORAGE_KEY);
      if (!token) throw redirect({ to: "/login" });
      return;
    }

    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const { user, loading } = useAuth();
  const { data: roles, isLoading: rolesLoading } = useMyRoles();
  const nav = useNavigate();
  const router = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (!loading && !user) nav({ to: "/login" });
  }, [user, loading, nav]);

  useEffect(() => {
    if (rolesLoading || !roles || router === "/onboarding") return;
    if (!hasOperationalAccess(roles)) {
      nav({ to: "/" });
      return;
    }
    if (!canAccessPath(roles, router)) {
      nav({ to: firstAllowedPath(roles) });
    }
  }, [roles, rolesLoading, router, nav]);

  if (loading || rolesLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (router === "/onboarding") {
    return <Outlet />;
  }

  if (roles && !hasOperationalAccess(roles)) {
    return null;
  }

  if (roles && router !== "/onboarding" && !canAccessPath(roles, router)) {
    return null;
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex min-w-0 flex-col bg-[linear-gradient(180deg,oklch(0.17_0.014_250),oklch(0.145_0.012_250)_220px)]">
          <Topbar />
          <ShiftOpeningGate />
          <main className="flex-1 min-w-0">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function ShiftOpeningGate() {
  const { branch, restaurant } = useActiveBranch();
  const { data: roles } = useMyRoles();
  const qc = useQueryClient();
  const [openingCash, setOpeningCash] = useState("");
  const [openingOnline, setOpeningOnline] = useState("0");
  const [saving, setSaving] = useState(false);
  const [dismissedDate, setDismissedDate] = useState<string | null>(null);
  const businessDayStart = (
    (branch as { business_day_start_time?: string } | null)?.business_day_start_time ?? "10:00"
  ).slice(0, 5);
  const businessDate = businessDateInputValue(businessDayStart);
  const afterStart = isAfterBusinessStart(businessDayStart);
  const canOpenShift = hasPermission(roles, "expenses:manage");
  const symbol = restaurant?.currency_symbol ?? "Rs";

  const todayClosureQ = useQuery({
    queryKey: ["global-shift-closure", branch?.id, businessDate],
    enabled: !!branch && afterStart,
    queryFn: async () => {
      const { data, error } = await db
        .from("finance_day_closures")
        .select("*")
        .eq("branch_id", branch!.id)
        .eq("business_date", businessDate)
        .maybeSingle();
      if (error) throw error;
      return data as FinanceDayClosure | null;
    },
  });

  const recentClosuresQ = useQuery({
    queryKey: ["global-unclosed-shifts", branch?.id, businessDate],
    enabled: !!branch && afterStart,
    queryFn: async () => {
      const { data, error } = await db
        .from("finance_day_closures")
        .select("*")
        .eq("branch_id", branch!.id)
        .lt("business_date", businessDate)
        .order("business_date", { ascending: false })
        .limit(14);
      if (error) throw error;
      return (data ?? []) as FinanceDayClosure[];
    },
  });

  const unclosedShifts = useMemo(
    () => (recentClosuresQ.data ?? []).filter((shift) => !shift.closed_at),
    [recentClosuresQ.data],
  );
  const todayShiftOpen = Boolean(todayClosureQ.data);
  const shouldPrompt =
    Boolean(branch) && afterStart && !todayClosureQ.isLoading && !todayShiftOpen && canOpenShift;
  const promptOpen = shouldPrompt && dismissedDate !== businessDate;

  async function openShift(event: FormEvent) {
    event.preventDefault();
    const cash = Number(openingCash);
    const online = Number(openingOnline || 0);
    if (!Number.isFinite(cash) || cash < 0) {
      return;
    }
    if (!Number.isFinite(online) || online < 0) {
      return;
    }

    setSaving(true);
    const { error } = await db.from("finance_day_closures").insert({
      branch_id: branch!.id,
      business_date: businessDate,
      opening_cash: cash.toFixed(2),
      opening_online: online.toFixed(2),
      expected_cash: cash.toFixed(2),
      expected_online: online.toFixed(2),
      actual_cash: null,
      actual_online: null,
      cash_difference: "0.00",
      online_difference: "0.00",
      notes: "Opened from global shift prompt.",
      closed_at: null,
    });
    setSaving(false);
    if (error) {
      await todayClosureQ.refetch();
      return;
    }
    setOpeningCash("");
    setOpeningOnline("0");
    await Promise.all([
      todayClosureQ.refetch(),
      recentClosuresQ.refetch(),
      qc.invalidateQueries({ queryKey: ["finance-day-closure"] }),
      qc.invalidateQueries({ queryKey: ["finance-movements"] }),
    ]);
  }

  if (!branch || !afterStart) return null;

  return (
    <>
      {unclosedShifts.length > 0 && (
        <div className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-sm text-amber-100 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            <span className="font-medium">
              {unclosedShifts.length} earlier shift{unclosedShifts.length === 1 ? "" : "s"} still open.
            </span>
            <span className="text-amber-100/80">
              They stay on their own dates and are not counted as today.
            </span>
            <div className="flex flex-wrap gap-1">
              {unclosedShifts.slice(0, 4).map((shift) => (
                <Badge key={shift.id} variant="outline" className="border-amber-400/40 text-amber-100">
                  {shift.business_date}
                </Badge>
              ))}
            </div>
            <Button asChild size="sm" variant="outline" className="ml-auto h-8">
              <Link to="/expenses">Close in Finance</Link>
            </Button>
          </div>
        </div>
      )}
      {!todayShiftOpen && !canOpenShift && (
        <div className="border-b border-destructive/25 bg-destructive/10 px-4 py-2 text-sm text-destructive-foreground sm:px-6">
          Today&apos;s shift is not opened yet. Ask a manager/admin to open Finance before taking
          operational entries.
        </div>
      )}
      <Dialog open={promptOpen} onOpenChange={(open) => !open && setDismissedDate(businessDate)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Open today&apos;s shift</DialogTitle>
          </DialogHeader>
          <form onSubmit={openShift} className="space-y-4">
            <div className="rounded-lg border border-primary/25 bg-primary/10 p-3 text-sm text-muted-foreground">
              Business day started at {businessDayStart}. Open {businessDate} with the counter cash
              before using operations so today&apos;s numbers stay separate.
            </div>
            <div className="space-y-1.5">
              <Label>Opening counter cash ({symbol})</Label>
              <Input
                autoFocus
                type="number"
                min="0"
                step="0.01"
                value={openingCash}
                onChange={(event) => setOpeningCash(event.target.value)}
                placeholder="Required"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Opening online balance ({symbol})</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={openingOnline}
                onChange={(event) => setOpeningOnline(event.target.value)}
                placeholder="Optional, can stay 0"
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setDismissedDate(businessDate)}>
                Remind later
              </Button>
              <Button type="submit" disabled={saving || openingCash.trim() === ""}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Open with {openingCash ? formatMoney(openingCash, symbol) : "cash"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function isAfterBusinessStart(businessDayStart: string) {
  const [hours = 0, minutes = 0] = businessDayStart.split(":").map(Number);
  const now = new Date();
  const pakistanTime = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  const nowMinutes = pakistanTime.getUTCHours() * 60 + pakistanTime.getUTCMinutes();
  const startMinutes = (Number.isFinite(hours) ? hours : 10) * 60 + (Number.isFinite(minutes) ? minutes : 0);
  return nowMinutes >= startMinutes;
}

const NAV: Array<{
  label: string;
  to: string;
  icon: typeof LayoutDashboard;
  permission: AppPermission;
}> = [
  { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard, permission: "dashboard:view" },
  { label: "POS", to: "/pos", icon: ScrollText, permission: "pos:use" },
  { label: "Orders", to: "/orders", icon: Receipt, permission: "orders:view" },
  { label: "Customers", to: "/customers", icon: UserRound, permission: "customers:view" },
  { label: "Promotions", to: "/promotions", icon: Gift, permission: "customers:manage" },
  { label: "Hiring", to: "/hiring", icon: BriefcaseBusiness, permission: "staff:manage" },
  { label: "Menu", to: "/menu", icon: ChefHat, permission: "menu:manage" },
  { label: "Inventory", to: "/inventory", icon: Package, permission: "inventory:view" },
  { label: "Finance", to: "/expenses", icon: Banknote, permission: "expenses:view" },
  { label: "Staff", to: "/staff", icon: Users, permission: "staff:manage" },
  { label: "Branches", to: "/branches", icon: Store, permission: "branches:manage" },
  { label: "Settings", to: "/settings", icon: Settings, permission: "settings:manage" },
];

function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { data: roles } = useMyRoles();
  const homePath = firstAllowedPath(roles);

  return (
    <Sidebar collapsible="icon" className="border-sidebar-border/80">
      <SidebarHeader className="p-3">
        <Link to={homePath} className="flex items-center gap-2 rounded-md px-2 py-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-ember-gradient shadow-ember">
            <Flame className="h-4 w-4 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <span className="block truncate font-display text-base leading-none">
                Angaar Kitchen
              </span>
              <span className="mt-1 block truncate text-[11px] text-sidebar-foreground/50">
                Operations
              </span>
            </div>
          )}
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Operations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.filter((item) => hasPermission(roles, item.permission)).map((item) => {
                const active = path === item.to || path.startsWith(item.to + "/");
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild isActive={active}>
                      <Link to={item.to}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <UserMenu collapsed={collapsed} />
      </SidebarFooter>
    </Sidebar>
  );
}

function UserMenu({ collapsed }: { collapsed: boolean }) {
  const { user, signOut } = useAuth();
  const { data: roles } = useMyRoles();
  const nav = useNavigate();
  const initials = (user?.email ?? "?").slice(0, 2).toUpperCase();
  const canManageSettings = hasPermission(roles, "settings:manage");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full items-center gap-2 rounded-md border border-sidebar-border/70 bg-sidebar-accent/35 px-2 py-2 text-left hover:bg-sidebar-accent">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/15 text-xs font-semibold text-primary">
            {initials}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{user?.email}</div>
              <div className="truncate text-xs text-muted-foreground">Account</div>
            </div>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{user?.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {canManageSettings && (
          <DropdownMenuItem onClick={() => nav({ to: "/settings" })}>
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={async () => {
            await signOut();
            nav({ to: "/login" });
          }}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Topbar() {
  const { branch, restaurant } = useActiveBranch();
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border/70 bg-background/88 px-3 backdrop-blur sm:px-6">
      <SidebarTrigger />
      <div className="hidden min-w-0 sm:block">
        <div className="truncate text-sm font-medium">{restaurant?.name ?? "Angaar Kitchen"}</div>
        <div className="text-xs text-muted-foreground">Restaurant workspace</div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Button variant="outline" size="sm" className="gap-2" disabled>
          <Store className="h-4 w-4" />
          <span className="max-w-[180px] truncate">{branch?.name ?? "Angaar Kitchen"}</span>
        </Button>
      </div>
    </header>
  );
}
