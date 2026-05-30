import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requirePostgresAuth } from "@/integrations/postgres/auth-middleware";
import { getDashboardSummary } from "@/services/dashboard.service.server";

const DashboardSummarySchema = z.object({
  branchId: z.string().uuid(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  includeUsage: z.boolean(),
});

export const getDashboardSummaryPostgres = createServerFn({ method: "GET" })
  .middleware([requirePostgresAuth])
  .inputValidator((input) => DashboardSummarySchema.parse(input))
  .handler(async ({ data, context }) => {
    const auth = requireAuthContext(context);
    return getDashboardSummary({
      userId: auth.userId,
      branchId: data.branchId,
      startAt: data.startAt,
      endAt: data.endAt,
      startDate: data.startDate,
      endDate: data.endDate,
      includeUsage: data.includeUsage,
    });
  });

function requireAuthContext(context: { userId: string } | undefined) {
  if (!context) {
    throw new Response("Unauthorized", { status: 401 });
  }

  return context;
}
