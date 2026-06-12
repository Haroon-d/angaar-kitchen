import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { pgPool } from "@/db/client.server";
import { previewCoupon } from "@/services/coupon.service.server";

const PreviewCouponSchema = z.object({
  branchId: z.string().uuid(),
  code: z.string().min(1).max(40),
  subtotal: z.number().nonnegative(),
  deliveryFee: z.number().nonnegative().optional().default(0),
  source: z.enum(["pos", "website"]),
});

export const previewCouponPostgres = createServerFn({ method: "POST" })
  .inputValidator((input) => PreviewCouponSchema.parse(input))
  .handler(async ({ data }) => {
    const client = await pgPool.connect();
    try {
      const branch = await client.query(
        "select id, restaurant_id from branches where id = $1 and is_active = true",
        [data.branchId],
      );
      const row = branch.rows[0] as { id: string; restaurant_id: string } | undefined;
      if (!row) throw new Error("Branch is not available.");

      return previewCoupon({
        restaurantId: row.restaurant_id,
        branchId: row.id,
        code: data.code,
        subtotal: data.subtotal,
        deliveryFee: data.deliveryFee,
        source: data.source,
      });
    } finally {
      client.release();
    }
  });
