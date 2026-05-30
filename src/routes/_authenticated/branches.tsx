import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Building2, Pencil, Trash2 } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { appDb as supabase } from "@/lib/app-db";
import { useActiveBranch } from "@/hooks/use-active-branch";
import { useMyRoles, isAdmin } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/branches")({ component: BranchesPage });

const Schema = z.object({
  name: z.string().min(2).max(80),
  code: z
    .string()
    .min(1)
    .max(8)
    .regex(/^[A-Z0-9]+$/),
  address: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  is_active: z.boolean(),
});

function BranchesPage() {
  const { branches, restaurant, refetch } = useActiveBranch();
  const { data: roles } = useMyRoles();
  const admin = isAdmin(roles);
  const qc = useQueryClient();

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("branches").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Branch deleted");
      refetch();
      qc.invalidateQueries();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl">Branches</h1>
          <p className="text-sm text-muted-foreground">
            Manage all locations of {restaurant?.name}.
          </p>
        </div>
        {admin && <BranchDialog onSaved={refetch} restaurantId={restaurant?.id ?? ""} />}
      </div>

      {branches.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Building2 className="mx-auto mb-3 h-8 w-8" />
            No branches yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {branches.map((b) => (
            <Card key={b.id} className="shadow-card">
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="font-display text-xl">{b.name}</CardTitle>
                  <p className="mt-1 text-xs font-mono text-muted-foreground">{b.code}</p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${b.is_active ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}
                >
                  {b.is_active ? "Active" : "Inactive"}
                </span>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                {b.address && <div>{b.address}</div>}
                {b.phone && <div>{b.phone}</div>}
                {admin && (
                  <div className="flex gap-2 pt-2">
                    <BranchDialog
                      branch={b}
                      onSaved={refetch}
                      restaurantId={restaurant?.id ?? ""}
                    />
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete branch?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This permanently removes "{b.name}" and all its menu data and orders.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => del.mutate(b.id)}>
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function BranchDialog({
  branch,
  onSaved,
  restaurantId,
}: {
  branch?: any;
  onSaved: () => void;
  restaurantId: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [f, setF] = useState({
    name: branch?.name ?? "",
    code: branch?.code ?? "",
    address: branch?.address ?? "",
    phone: branch?.phone ?? "",
    is_active: branch?.is_active ?? true,
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const parsed = Schema.safeParse({ ...f, code: f.code.toUpperCase() });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    try {
      if (branch) {
        const { error } = await supabase.from("branches").update(parsed.data).eq("id", branch.id);
        if (error) throw error;
      } else {
        const { data: b, error } = await supabase
          .from("branches")
          .insert({ ...parsed.data, restaurant_id: restaurantId })
          .select()
          .single();
        if (error) throw error;
        await supabase.from("operating_hours").insert(
          Array.from({ length: 7 }).map((_, weekday) => ({
            branch_id: b.id,
            weekday,
            open_time: "10:00",
            close_time: "22:00",
          })),
        );
      }
      toast.success(branch ? "Branch updated" : "Branch created");
      onSaved();
      setOpen(false);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {branch ? (
          <Button variant="ghost" size="sm">
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New branch
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{branch ? "Edit branch" : "New branch"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2">
              <Label>Name</Label>
              <Input
                value={f.name}
                onChange={(e) => setF({ ...f, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Code</Label>
              <Input
                value={f.code}
                onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })}
                maxLength={8}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Address</Label>
              <Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
            </div>
            <div className="flex items-center gap-2 col-span-2">
              <Switch checked={f.is_active} onCheckedChange={(v) => setF({ ...f, is_active: v })} />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
