import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isPostgresAuthEnabled } from "@/lib/auth-backend";
import { getUserRestaurantContextPostgres } from "@/lib/context.postgres.functions";
import { useAuth, useMyRoles } from "./use-auth";

type Restaurant = {
  id: string;
  name: string;
  currency: string;
  currency_symbol: string;
  logo_url: string | null;
  legal_name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
};
type Branch = {
  id: string;
  restaurant_id: string;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  delivery_fee?: number | string | null;
  finance_cutover_at?: string | null;
  is_active: boolean;
};

type Ctx = {
  restaurant: Restaurant | null;
  branches: Branch[];
  branch: Branch | null;
  setBranchId: (id: string) => void;
  loading: boolean;
  refetch: () => void;
};

const C = createContext<Ctx>({
  restaurant: null,
  branches: [],
  branch: null,
  setBranchId: () => {},
  loading: true,
  refetch: () => {},
});

const STORAGE_KEY = "ak.activeBranchId";

export function ActiveBranchProvider({ children }: { children: ReactNode }) {
  const { session, user } = useAuth();
  const { data: roles } = useMyRoles();
  const postgresEnabled = isPostgresAuthEnabled();
  const restaurantId = roles?.[0]?.restaurant_id ?? null;

  const postgresContextQ = useQuery({
    queryKey: ["postgres-restaurant-context", user?.id],
    enabled: postgresEnabled && !!user && !!session,
    queryFn: async () =>
      getUserRestaurantContextPostgres({
        headers: { Authorization: `Bearer ${session!.access_token}` },
      }),
  });

  const restaurantQ = useQuery({
    queryKey: ["restaurant", restaurantId],
    enabled: !postgresEnabled && !!restaurantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select("*")
        .eq("id", restaurantId!)
        .maybeSingle();
      if (error) throw error;
      return data as Restaurant | null;
    },
  });

  const branchesQ = useQuery({
    queryKey: ["branches", restaurantId],
    enabled: !postgresEnabled && !!restaurantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches")
        .select("*")
        .eq("restaurant_id", restaurantId!)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as Branch[];
    },
  });

  const branches = useMemo(
    () => (postgresEnabled ? (postgresContextQ.data?.branches ?? []) : (branchesQ.data ?? [])),
    [branchesQ.data, postgresContextQ.data?.branches, postgresEnabled],
  );
  const restaurant = postgresEnabled
    ? (postgresContextQ.data?.restaurant ?? null)
    : (restaurantQ.data ?? null);

  const [branchId, setBranchId] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setBranchId(stored);
    }
  }, []);
  useEffect(() => {
    if (branches.length && (!branchId || !branches.some((branch) => branch.id === branchId))) {
      setBranchId(branches[0].id);
    }
  }, [branches, branchId]);
  useEffect(() => {
    if (branchId && typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, branchId);
  }, [branchId]);

  const branch = useMemo(
    () => branches.find((candidate) => candidate.id === branchId) ?? null,
    [branches, branchId],
  );

  const value: Ctx = {
    restaurant,
    branches,
    branch,
    setBranchId,
    loading:
      !!user &&
      (postgresEnabled ? postgresContextQ.isLoading : restaurantQ.isLoading || branchesQ.isLoading),
    refetch: () => {
      if (postgresEnabled) {
        postgresContextQ.refetch();
        return;
      }
      restaurantQ.refetch();
      branchesQ.refetch();
    },
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}

export const useActiveBranch = () => useContext(C);
