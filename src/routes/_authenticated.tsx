import { createFileRoute, Outlet, redirect, Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Flame, LayoutDashboard, ChefHat, ScrollText, Users, Settings, LogOut, Loader2, Store, Receipt } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useMyRoles, isAdmin } from "@/hooks/use-auth";
import { useActiveBranch } from "@/hooks/use-active-branch";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger,
  SidebarHeader, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
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
    if (!rolesLoading && roles && roles.length === 0 && router !== "/onboarding") {
      nav({ to: "/onboarding" });
    }
  }, [roles, rolesLoading, nav, router]);

  if (loading || rolesLoading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  // While onboarding, render outlet without shell
  if (router === "/onboarding" || (roles && roles.length === 0)) {
    return <Outlet />;
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
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
    <Sidebar collapsible="icon" className="border-sidebar-border">
      <SidebarHeader>
        <Link to="/dashboard" className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ember-gradient shadow-ember">
            <Flame className="h-4 w-4 text-primary-foreground" />
          </div>
          {!collapsed && <span className="font-display text-base">Angaar Kitchen</span>}
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
        <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-sidebar-accent">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{initials}</div>
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
        <DropdownMenuItem onClick={() => nav({ to: "/settings" })}><Settings className="mr-2 h-4 w-4" />Settings</DropdownMenuItem>
        <DropdownMenuItem onClick={async () => { await signOut(); nav({ to: "/login" }); }}>
          <LogOut className="mr-2 h-4 w-4" />Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Topbar() {
  const { branch, restaurant } = useActiveBranch();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-3 backdrop-blur sm:px-6">
      <SidebarTrigger />
      <div className="hidden text-sm text-muted-foreground sm:block">{restaurant?.name}</div>
      <div className="ml-auto flex items-center gap-2">
        <Button variant="outline" size="sm" className="gap-2" disabled>
          <Store className="h-4 w-4" />
          <span className="max-w-[180px] truncate">{branch?.name ?? "Angaar Kitchen"}</span>
        </Button>
      </div>
    </header>
  );
}
