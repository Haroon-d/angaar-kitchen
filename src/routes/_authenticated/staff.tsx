import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, Users } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import {
  createStaffAccountPostgres,
  listRestaurantStaffPostgres,
} from "@/lib/staff.postgres.functions";
import { appDb as supabase } from "@/lib/app-db";
import { isPostgresAuthEnabled } from "@/lib/auth-backend";
import { createStaffAccount } from "@/lib/staff.functions";
import { useActiveBranch } from "@/hooks/use-active-branch";
import { useAuth, useMyRoles, isAdmin } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/staff")({ component: StaffPage });

type StaffRole = "admin" | "manager" | "cashier" | "kitchen" | "waiter";
type StaffRoleRow = {
  id: string;
  role: string;
  branch_id: string | null;
  user_id: string;
  created_at: string;
};

function StaffPage() {
  const { session } = useAuth();
  const { restaurant, branches } = useActiveBranch();
  const { data: roles } = useMyRoles();
  const admin = isAdmin(roles);

  const staffQ = useQuery({
    queryKey: ["staff", restaurant?.id],
    enabled: !!restaurant && admin && !!session,
    queryFn: async () => {
      if (!isPostgresAuthEnabled()) {
        const { data, error } = await supabase
          .from("user_roles")
          .select("id, role, branch_id, user_id, created_at")
          .eq("restaurant_id", restaurant!.id)
          .order("created_at");
        if (error) throw error;
        return (data ?? []) as StaffRoleRow[];
      }

      return listRestaurantStaffPostgres({
        data: { restaurantId: restaurant!.id },
        headers: { Authorization: `Bearer ${session!.access_token}` },
      }) as Promise<StaffRoleRow[]>;
    },
  });

  if (!admin)
    return (
      <div className="p-8">
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Only owners and admins can manage staff.
          </CardContent>
        </Card>
      </div>
    );

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div>
        <h1 className="font-display text-3xl">Staff</h1>
        <p className="text-sm text-muted-foreground">
          All team members with access to {restaurant?.name}.
        </p>
      </div>
      <div>
        <StaffDialog
          branches={branches}
          restaurantId={restaurant?.id ?? ""}
          token={session?.access_token ?? ""}
          onSaved={() => staffQ.refetch()}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Team</CardTitle>
          <CardDescription>
            Only owner/admin-created accounts can enter the operational system.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {staffQ.data?.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Users className="mx-auto mb-3 h-8 w-8" />
              No staff yet.
            </div>
          ) : (
            <div className="space-y-2">
              {staffQ.data?.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 rounded-lg border border-border p-3"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                    {r.role.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <div className="font-mono text-xs text-muted-foreground">
                      {r.user_id.slice(0, 8)}…
                    </div>
                    <div className="text-sm capitalize">
                      {r.role}
                      {r.branch_id ? "" : " · restaurant access"}
                    </div>
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

const StaffSchema = z.object({
  fullName: z.string().min(2, "Enter the staff member's name").max(80),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
  role: z.enum(["admin", "manager", "cashier", "kitchen", "waiter"]),
  branchId: z.string().uuid().nullable(),
});

function StaffDialog({
  branches,
  restaurantId,
  token,
  onSaved,
}: {
  branches: Array<{ id: string; name: string }>;
  restaurantId: string;
  token: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [f, setF] = useState({
    fullName: "",
    email: "",
    password: "",
    role: "cashier" as StaffRole,
    branchId: branches[0]?.id ?? "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const branchId = f.role === "admin" ? null : f.branchId || null;
    const parsed = StaffSchema.safeParse({ ...f, branchId });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    if (!restaurantId || !token) return;
    setLoading(true);
    try {
      const create = isPostgresAuthEnabled() ? createStaffAccountPostgres : createStaffAccount;
      await create({
        data: {
          restaurantId,
          fullName: parsed.data.fullName,
          email: parsed.data.email,
          password: parsed.data.password,
          role: parsed.data.role,
          branchId: parsed.data.branchId,
        },
        headers: { Authorization: `Bearer ${token}` },
      });
      toast.success("Staff account created");
      setF({
        fullName: "",
        email: "",
        password: "",
        role: "cashier",
        branchId: branches[0]?.id ?? "",
      });
      setOpen(false);
      onSaved();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not create staff account");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          New staff account
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create staff account</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Full name</Label>
              <Input
                value={f.fullName}
                onChange={(e) => setF({ ...f, fullName: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={f.email}
                onChange={(e) => setF({ ...f, email: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Temporary password</Label>
              <Input
                type="password"
                value={f.password}
                onChange={(e) => setF({ ...f, password: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select
                value={f.role}
                onValueChange={(role) => setF({ ...f, role: role as StaffRole })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="cashier">Cashier</SelectItem>
                  <SelectItem value="kitchen">Kitchen</SelectItem>
                  <SelectItem value="waiter">Waiter</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Branch</Label>
              <Select
                value={f.branchId}
                onValueChange={(branchId) => setF({ ...f, branchId })}
                disabled={f.role === "admin"}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Restaurant-wide" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading || !restaurantId}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
