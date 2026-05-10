import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Printer, ArrowLeft, Flame, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBranch } from "@/hooks/use-active-branch";
import { Button } from "@/components/ui/button";
import { formatMoney, formatDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/pos/receipt/$orderId")({ component: ReceiptPage });

function ReceiptPage() {
  const { orderId } = Route.useParams();
  const { restaurant, branch } = useActiveBranch();
  const symbol = restaurant?.currency_symbol ?? "₹";
  const nav = useNavigate();

  const q = useQuery({
    queryKey: ["receipt", orderId],
    queryFn: async () => {
      const { data: order, error } = await supabase.from("orders").select("*").eq("id", orderId).single();
      if (error) throw error;
      const [{ data: items }, { data: taxes }, { data: payments }] = await Promise.all([
        supabase.from("order_items").select("*").eq("order_id", orderId),
        supabase.from("order_taxes").select("*").eq("order_id", orderId),
        supabase.from("payments").select("*").eq("order_id", orderId),
      ]);
      return { order, items: items ?? [], taxes: taxes ?? [], payments: payments ?? [] };
    },
  });

  if (q.isLoading) return <div className="flex h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (q.error || !q.data) return <div className="p-8 text-center text-destructive">Receipt not found.</div>;
  const { order, items, taxes, payments } = q.data;

  return (
    <div className="min-h-screen bg-background p-4 sm:p-8">
      <div className="mx-auto max-w-md">
        <div className="no-print mb-4 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => nav({ to: "/pos" })}><ArrowLeft className="mr-2 h-4 w-4" />Back to POS</Button>
          <Button onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Print</Button>
        </div>

        <div className="rounded-lg bg-white p-6 text-black shadow-card font-mono text-[13px] leading-snug">
          <div className="text-center">
            <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-orange-500"><Flame className="h-5 w-5 text-white" /></div>
            <div className="font-display text-xl text-black">{restaurant?.name}</div>
            {branch && <div className="text-xs text-gray-600">{branch.name} · {branch.address ?? ""}</div>}
            {branch?.phone && <div className="text-xs text-gray-600">{branch.phone}</div>}
          </div>

          <div className="my-3 border-t border-dashed border-gray-300" />

          <div className="flex justify-between text-xs"><span>Order #</span><span className="font-semibold">{order.order_no}</span></div>
          <div className="flex justify-between text-xs"><span>Date</span><span>{formatDate(order.created_at)}</span></div>
          <div className="flex justify-between text-xs"><span>Type</span><span className="capitalize">{order.dining_type.replace("_"," ")}</span></div>
          {order.table_label && <div className="flex justify-between text-xs"><span>Table</span><span>{order.table_label}</span></div>}
          {order.customer_name && <div className="flex justify-between text-xs"><span>Customer</span><span>{order.customer_name}</span></div>}

          <div className="my-3 border-t border-dashed border-gray-300" />

          <div className="space-y-1">
            {items.map((i: any) => (
              <div key={i.id}>
                <div className="flex justify-between"><span>{i.qty} × {i.name_snapshot}</span><span>{formatMoney(i.line_subtotal, symbol)}</span></div>
                {Number(i.unit_price) > 0 && <div className="text-[10px] text-gray-500">@ {formatMoney(i.unit_price, symbol)}</div>}
              </div>
            ))}
          </div>

          <div className="my-3 border-t border-dashed border-gray-300" />

          <div className="space-y-0.5 text-xs">
            <div className="flex justify-between"><span>Subtotal</span><span>{formatMoney(order.subtotal, symbol)}</span></div>
            {Number(order.discount_total) > 0 && <div className="flex justify-between"><span>Discount</span><span>-{formatMoney(order.discount_total, symbol)}</span></div>}
            {taxes.map((t: any) => (
              <div key={t.id} className="flex justify-between"><span>{t.name_snapshot} ({t.rate_snapshot}%)</span><span>{formatMoney(t.amount, symbol)}</span></div>
            ))}
          </div>

          <div className="mt-2 flex justify-between border-t border-gray-400 pt-2 text-base font-bold">
            <span>TOTAL</span><span>{formatMoney(order.grand_total, symbol)}</span>
          </div>

          {payments.length > 0 && (
            <div className="mt-2 space-y-0.5 text-xs">
              {payments.map((p: any) => (
                <div key={p.id} className="flex justify-between"><span className="capitalize">Paid · {p.method}</span><span>{formatMoney(p.amount, symbol)}</span></div>
              ))}
            </div>
          )}

          <div className="my-3 border-t border-dashed border-gray-300" />
          <div className="text-center text-xs text-gray-600">Thank you for dining with us!</div>
          <div className="text-center text-[10px] text-gray-400">Powered by Angaar Kitchen</div>
        </div>

        <div className="no-print mt-4 text-center text-sm">
          <Link to="/pos" className="text-primary hover:underline">Start a new order →</Link>
        </div>
      </div>
    </div>
  );
}
