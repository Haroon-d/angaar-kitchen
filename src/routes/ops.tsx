import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useAuth, useMyRoles } from "@/hooks/use-auth";
import { firstAllowedPath, hasOperationalAccess } from "@/lib/rbac";

export const Route = createFileRoute("/ops")({ component: OpsEntryPage });

function OpsEntryPage() {
  const { user, loading } = useAuth();
  const { data: roles, isLoading: rolesLoading } = useMyRoles();
  const nav = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      nav({ to: "/login" });
      return;
    }
    if (rolesLoading) return;
    if (hasOperationalAccess(roles)) {
      nav({ to: firstAllowedPath(roles) });
      return;
    }
    nav({ to: "/login" });
  }, [loading, nav, roles, rolesLoading, user]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        Opening Angaar Kitchen operations...
      </div>
    </div>
  );
}
