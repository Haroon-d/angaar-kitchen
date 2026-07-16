import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { pgPool } from "@/db/client.server";

const ApplicationSchema = z.object({
  jobPostId: z.string().uuid().nullable().optional(),
  applicantName: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(7).max(30),
  whatsapp: z.string().trim().max(30).optional(),
  email: z.string().trim().email().max(140).optional().or(z.literal("")),
  city: z.string().trim().max(80).optional(),
  experience: z.string().trim().max(120).optional(),
  expectedSalary: z.string().trim().max(80).optional(),
  availability: z.string().trim().max(80).optional(),
  source: z.string().trim().max(80).optional(),
  message: z.string().trim().max(1000).optional(),
});

function nullable(value?: string | null) {
  const clean = value?.trim();
  return clean ? clean : null;
}

export const getPublicCareers = createServerFn({ method: "GET" }).handler(async () => {
  const restaurantResult = await pgPool.query(
    `select id, name, phone, address from restaurants order by created_at limit 1`,
  );
  const restaurant = restaurantResult.rows[0] ?? null;
  if (!restaurant) return { restaurant: null, jobs: [] };

  const jobsResult = await pgPool.query(
    `select id, title, department, location, employment_type, salary_range,
            description, requirements, sort_order
     from job_posts
     where restaurant_id = $1 and is_active = true
     order by sort_order, created_at desc`,
    [restaurant.id],
  );
  return { restaurant, jobs: jobsResult.rows };
});

export const submitJobApplication = createServerFn({ method: "POST" })
  .inputValidator((input) => ApplicationSchema.parse(input))
  .handler(async ({ data }) => {
    const restaurantResult = data.jobPostId
      ? await pgPool.query(
          `select restaurant_id from job_posts where id = $1 and is_active = true`,
          [data.jobPostId],
        )
      : await pgPool.query(`select id as restaurant_id from restaurants order by created_at limit 1`);

    const restaurantId = restaurantResult.rows[0]?.restaurant_id;
    if (!restaurantId) throw new Error("No active hiring profile was found.");

    await pgPool.query(
      `insert into job_applications
         (restaurant_id, job_post_id, applicant_name, phone, whatsapp, email, city,
          experience, expected_salary, availability, source, message)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        restaurantId,
        data.jobPostId ?? null,
        data.applicantName,
        data.phone,
        nullable(data.whatsapp),
        nullable(data.email),
        nullable(data.city),
        nullable(data.experience),
        nullable(data.expectedSalary),
        nullable(data.availability),
        nullable(data.source),
        nullable(data.message),
      ],
    );

    return { ok: true };
  });
