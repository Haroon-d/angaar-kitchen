export type LoyaltyCustomer = {
  is_vip: boolean;
  is_blocked: boolean;
  total_orders: number | string;
  total_spent: number | string;
  last_order_at: string | null;
};

export type LoyaltySnapshot = {
  label: string;
  points: number;
  progress: number;
  nextLabel: string | null;
  amountToNext: number;
  insight: string;
  badgeClassName: string;
};

export const LOYALTY_POINT_SPEND = 100;

export const LOYALTY_TIERS = [
  { label: "Starter", minSpend: 0, className: "border-slate-500/30 bg-slate-500/10 text-slate-300" },
  { label: "Regular", minSpend: 3000, className: "border-sky-500/30 bg-sky-500/15 text-sky-300" },
  { label: "Silver", minSpend: 7500, className: "border-zinc-400/30 bg-zinc-400/15 text-zinc-200" },
  { label: "Gold", minSpend: 15000, className: "border-amber-500/30 bg-amber-500/15 text-amber-300" },
  { label: "Platinum", minSpend: 30000, className: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" },
] as const;

export function getLoyaltySnapshot(customer: LoyaltyCustomer): LoyaltySnapshot {
  const spent = Number(customer.total_spent) || 0;
  const orders = Number(customer.total_orders) || 0;
  const points = calculateLoyaltyPoints(spent);

  if (customer.is_blocked) {
    return {
      label: "Blocked",
      points,
      progress: 0,
      nextLabel: null,
      amountToNext: 0,
      insight: "This customer is blocked. Review the profile before sending offers or accepting future orders.",
      badgeClassName: "border-destructive/30 bg-destructive/15 text-destructive",
    };
  }

  if (customer.is_vip) {
    return {
      label: "VIP",
      points,
      progress: 100,
      nextLabel: null,
      amountToNext: 0,
      insight: "VIP customer. Prioritize fast service, direct follow-up, and careful handling of preferences.",
      badgeClassName: "border-amber-500/30 bg-amber-500/15 text-amber-300",
    };
  }

  let currentIndex = 0;
  for (let index = 0; index < LOYALTY_TIERS.length; index += 1) {
    if (spent >= LOYALTY_TIERS[index].minSpend) currentIndex = index;
  }

  const current = LOYALTY_TIERS[currentIndex];
  const next = LOYALTY_TIERS[currentIndex + 1] ?? null;
  const progress = next
    ? Math.min(
        100,
        Math.round(((spent - current.minSpend) / (next.minSpend - current.minSpend)) * 100),
      )
    : 100;
  const amountToNext = next ? Math.max(0, next.minSpend - spent) : 0;

  return {
    label: current.label,
    points,
    progress,
    nextLabel: next?.label ?? null,
    amountToNext,
    insight: loyaltyInsight(customer, current.label, next?.label ?? null, amountToNext, orders),
    badgeClassName: current.className,
  };
}

export function calculateLoyaltyPoints(spent: number) {
  return Math.floor(Math.max(0, spent) / LOYALTY_POINT_SPEND);
}

function loyaltyInsight(
  customer: LoyaltyCustomer,
  tier: string,
  nextTier: string | null,
  amountToNext: number,
  orders: number,
) {
  if (!orders) {
    return "New profile. The first order starts customer history, and paid completed orders earn loyalty points.";
  }
  if (customer.last_order_at) {
    const inactiveCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    if (new Date(customer.last_order_at).getTime() < inactiveCutoff) {
      return "Inactive for more than 30 days. Good candidate for a polite WhatsApp follow-up.";
    }
  }
  if (nextTier) {
    return `${tier} customer. Needs about ${Math.ceil(amountToNext).toLocaleString()} more paid completed spending to reach ${nextTier}.`;
  }
  return "Top loyalty tier based on paid completed spending. Keep service personal and consistent.";
}
