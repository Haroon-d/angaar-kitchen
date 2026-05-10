import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useMyRoles } from "./use-auth";

type Restaurant = {
  id: string; name: string; currency: string; currency_symbol: string;
  logo_url: string | null; legal_name: string | null;
};
type Branch = { id: string; restaurant_id: string; name: string; code: string; address: string | null; phone: string | null; is_active: boolean; };

type Ctx = {
  restaurant: Restaurant | null;
  branches: Branch[];
  branch: Branch | null;
  setBranchId: (id: string) => void;
  loading: boolean;
  refetch: () => void;
};

const C = createContext<Ctx>({ restaurant: null, branches: [], branch: null, setBranchId: () => {}, loading: true, refetch: () => {} });

const STORAGE_KEY = "ak.activeBranchId";

export function ActiveBranchProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { data: roles } = useMyRoles();
  const restaurantId = roles?.[0]?.restaurant_id ?? null;

  const restaurantQ = useQuery({
    queryKey: ["restaurant", restaurantId],
    enabled: !!restaurantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("restaurants").select("*").eq("id", restaurantId!).maybeSingle();
      if (error) throw error;
      return data as Restaurant | null;
    },
  });

  const branchesQ = useQuery({
    queryKey: ["branches", restaurantId],
    enabled: !!restaurantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("branches").select("*").eq("restaurant_id", restaurantId!).order("created_at");
      if (error) throw error;
      return (data ?? []) as Branch[];
    },
  });

  const [branchId, setBranchId] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setBranchId(stored);
    }
  }, []);
  useEffect(() => {
    if (branchesQ.data?.length && (!branchId || !branchesQ.data.some((b) => b.id === branchId))) {
      setBranchId(branchesQ.data[0].id);
    }
  }, [branchesQ.data, branchId]);
  useEffect(() => {
    if (branchId && typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, branchId);
  }, [branchId]);

  const branch = useMemo(() => branchesQ.data?.find((b) => b.id === branchId) ?? null, [branchesQ.data, branchId]);

  const value: Ctx = {
    restaurant: restaurantQ.data ?? null,
    branches: branchesQ.data ?? [],
    branch,
    setBranchId,
    loading: !!user && (restaurantQ.isLoading || branchesQ.isLoading),
    refetch: () => { restaurantQ.refetch(); branchesQ.refetch(); },
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}

export const useActiveBranch = () => useContext(C);
