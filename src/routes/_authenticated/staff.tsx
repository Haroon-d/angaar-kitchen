import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBranch } from "@/hooks/use-active-branch";
import { useMyRoles, isAdmin } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/staff")({ component: StaffPage });

function StaffPage() {
  const { restaurant } = useActiveBranch();
  const { data: roles } = useMyRoles();
  const admin = isAdmin(roles);

  const staffQ = useQuery({
    queryKey: ["staff", restaurant?.id],
    enabled: !!restaurant && admin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("id, role, branch_id, user_id, created_at")
        .eq("restaurant_id", restaurant!.id)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!admin) return <div className="p-8"><Card><CardContent className="py-12 text-center text-muted-foreground">Only owners and admins can manage staff.</CardContent></Card></div>;

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div>
        <h1 className="font-display text-3xl">Staff</h1>
        <p className="text-sm text-muted-foreground">All team members with access to {restaurant?.name}.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Team</CardTitle>
          <CardDescription>Inviting new staff via email link is coming soon. For now, ask staff to sign up, then assign their role here.</CardDescription>
        </CardHeader>
        <CardContent>
          {staffQ.data?.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground"><Users className="mx-auto mb-3 h-8 w-8" />No staff yet.</div>
          ) : (
            <div className="space-y-2">
              {staffQ.data?.map((r: any) => (
                <div key={r.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{r.role.slice(0,2).toUpperCase()}</div>
                  <div className="flex-1">
                    <div className="font-mono text-xs text-muted-foreground">{r.user_id.slice(0,8)}…</div>
                    <div className="text-sm capitalize">{r.role}{r.branch_id ? "" : " · all branches"}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
