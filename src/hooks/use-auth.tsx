import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { POSTGRES_SESSION_STORAGE_KEY } from "@/integrations/postgres/auth-middleware";
import { isPostgresAuthEnabled } from "@/lib/auth-backend";
import {
  getCurrentUserPostgres,
  signInWithPasswordPostgres,
  signOutPostgres,
  signUpWithPasswordPostgres,
} from "@/lib/auth.postgres.functions";

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
  signIn: (input: { email: string; password: string }) => Promise<{ roles: UserRoleRow[] }>;
  signUp: (input: { fullName: string; email: string; password: string }) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthCtx = createContext<AuthValue>({
  session: null,
  user: null,
  loading: true,
  signIn: async () => ({ roles: [] }),
  signUp: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [postgresUser, setPostgresUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  useEffect(() => {
    if (isPostgresAuthEnabled()) {
      const token = readPostgresToken();
      if (!token) {
        setLoading(false);
        return;
      }

      getCurrentUserPostgres({ headers: authHeaders(token) })
        .then((current) => {
          setSession({ access_token: token, user: current.user } as Session);
          setPostgresUser(current.user as User);
        })
        .catch(() => {
          clearPostgresToken();
          setSession(null);
          setPostgresUser(null);
        })
        .finally(() => setLoading(false));
      return;
    }

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
    user: isPostgresAuthEnabled() ? postgresUser : (session?.user ?? null),
    loading,
    signIn: async (input) => {
      if (isPostgresAuthEnabled()) {
        const result = await signInWithPasswordPostgres({ data: input });
        storePostgresToken(result.token);
        setSession({ access_token: result.token, user: result.user } as Session);
        setPostgresUser(result.user as User);
        await qc.invalidateQueries();
        return { roles: result.roles as UserRoleRow[] };
      }

      const { data, error } = await supabase.auth.signInWithPassword(input);
      if (error) throw error;

      const { data: roles, error: roleError } = await supabase
        .from("user_roles")
        .select("id, role, restaurant_id, branch_id")
        .eq("user_id", data.user.id);
      if (roleError) throw roleError;

      return { roles: (roles ?? []) as UserRoleRow[] };
    },
    signUp: async (input) => {
      if (isPostgresAuthEnabled()) {
        const result = await signUpWithPasswordPostgres({
          data: {
            fullName: input.fullName,
            email: input.email,
            password: input.password,
          },
        });
        storePostgresToken(result.token);
        setSession({ access_token: result.token, user: result.user } as Session);
        setPostgresUser(result.user as User);
        await qc.invalidateQueries();
        return;
      }

      const { error } = await supabase.auth.signUp({
        email: input.email,
        password: input.password,
        options: {
          emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
          data: { full_name: input.fullName },
        },
      });
      if (error) throw error;
    },
    signOut: async () => {
      if (isPostgresAuthEnabled()) {
        const token = session?.access_token ?? readPostgresToken();
        if (token) {
          await signOutPostgres({ headers: authHeaders(token) }).catch(() => {});
        }
        clearPostgresToken();
        setSession(null);
        setPostgresUser(null);
        await qc.invalidateQueries();
        return;
      }

      await supabase.auth.signOut();
    },
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);

export function useMyRoles() {
  const { session, user } = useAuth();
  return useQuery({
    queryKey: ["my-roles", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<UserRoleRow[]> => {
      if (isPostgresAuthEnabled()) {
        const token = session?.access_token ?? readPostgresToken();
        if (!token) return [];
        const current = await getCurrentUserPostgres({ headers: authHeaders(token) });
        return current.roles as UserRoleRow[];
      }

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

export function hasOperationalAccess(roles: UserRoleRow[] | undefined) {
  return !!roles?.length;
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function readPostgresToken() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(POSTGRES_SESSION_STORAGE_KEY);
}

function storePostgresToken(token: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(POSTGRES_SESSION_STORAGE_KEY, token);
}

function clearPostgresToken() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(POSTGRES_SESSION_STORAGE_KEY);
}
