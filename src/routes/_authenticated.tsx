import {
  createFileRoute,
  Outlet,
  redirect,
  Link,
  useRouterState,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect } from "react";
import {
  Flame,
  LayoutDashboard,
  ChefHat,
  ScrollText,
  Users,
  Settings,
  LogOut,
  Loader2,
  Store,
  Receipt,
  Package,
  Banknote,
} from "lucide-react";
import { POSTGRES_SESSION_STORAGE_KEY } from "@/integrations/postgres/auth-middleware";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useMyRoles, isAdmin, hasOperationalAccess } from "@/hooks/use-auth";
import { useActiveBranch } from "@/hooks/use-active-branch";
import { isPostgresAuthEnabled } from "@/lib/auth-backend";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    if (isPostgresAuthEnabled()) {
      const token =
        typeof window !== "undefined"
          ? window.localStorage.getItem(POSTGRES_SESSION_STORAGE_KEY)
          : null;
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
    if (!rolesLoading && roles && !hasOperationalAccess(roles)) {
      nav({ to: "/" });
    }
  }, [roles, rolesLoading, nav]);

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

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex min-w-0 flex-col bg-[linear-gradient(180deg,oklch(0.17_0.014_250),oklch(0.145_0.012_250)_220px)]">
          <Topbar />
          <main className="flex-1 min-w-0">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

const NAV = [
  { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
  { label: "POS", to: "/pos", icon: ScrollText },
  { label: "Orders", to: "/orders", icon: Receipt },
  { label: "Menu", to: "/menu", icon: ChefHat },
  { label: "Inventory", to: "/inventory", icon: Package },
  { label: "Expenses", to: "/expenses", icon: Banknote },
  { label: "Staff", to: "/staff", icon: Users, adminOnly: true },
  { label: "Settings", to: "/settings", icon: Settings, adminOnly: true },
];

function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { data: roles } = useMyRoles();
  const admin = isAdmin(roles);

  return (
    <Sidebar collapsible="icon" className="border-sidebar-border/80">
      <SidebarHeader className="p-3">
        <Link to="/dashboard" className="flex items-center gap-2 rounded-md px-2 py-2">
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
              {NAV.filter((n) => admin || !n.adminOnly).map((item) => {
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
  const nav = useNavigate();
  const initials = (user?.email ?? "?").slice(0, 2).toUpperCase();
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
        <DropdownMenuItem onClick={() => nav({ to: "/settings" })}>
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </DropdownMenuItem>
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
