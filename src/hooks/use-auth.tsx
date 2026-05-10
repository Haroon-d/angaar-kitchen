import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Role = "owner" | "admin" | "manager" | "cashier" | "kitchen" | "waiter";

export type UserRoleRow = {
  id: string;
  role: Role;
  restaurant_id: string;
  branch_id: string | null;
};

type AuthValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthCtx = createContext<AuthValue>({ session: null, user: null, loading: true, signOut: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      qc.invalidateQueries();
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, [qc]);

  const value: AuthValue = {
    session,
    user: session?.user ?? null,
    loading,
    signOut: async () => { await supabase.auth.signOut(); },
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);

export function useMyRoles() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-roles", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<UserRoleRow[]> => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("id, role, restaurant_id, branch_id")
        .eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []) as UserRoleRow[];
    },
  });
}

const ADMIN_ROLES: Role[] = ["owner", "admin"];
const MANAGER_ROLES: Role[] = ["owner", "admin", "manager"];

export function rolesInclude(roles: UserRoleRow[] | undefined, set: Role[]) {
  if (!roles) return false;
  return roles.some((r) => set.includes(r.role));
}

export function isAdmin(roles: UserRoleRow[] | undefined) {
  return rolesInclude(roles, ADMIN_ROLES);
}
export function isManager(roles: UserRoleRow[] | undefined) {
  return rolesInclude(roles, MANAGER_ROLES);
}
