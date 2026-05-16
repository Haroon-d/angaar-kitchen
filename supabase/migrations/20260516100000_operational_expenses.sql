-- Operational expenses: branch-level non-inventory business costs.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'operational_expense_status') THEN
    CREATE TYPE public.operational_expense_status AS ENUM ('due', 'paid', 'void');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.operational_expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operational_expense_categories_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT operational_expense_categories_branch_name_unique UNIQUE (branch_id, name)
);
ALTER TABLE public.operational_expense_categories ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS operational_expense_categories_updated_at ON public.operational_expense_categories;
CREATE TRIGGER operational_expense_categories_updated_at BEFORE UPDATE ON public.operational_expense_categories
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE INDEX IF NOT EXISTS operational_expense_categories_branch_idx
  ON public.operational_expense_categories(branch_id, is_active, name);

CREATE TABLE IF NOT EXISTS public.operational_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.operational_expense_categories(id) ON DELETE SET NULL,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  title text NOT NULL,
  vendor text,
  reference_no text,
  payment_method public.payment_method,
  status public.operational_expense_status NOT NULL DEFAULT 'paid',
  amount numeric(14,2) NOT NULL,
  notes text,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operational_expenses_title_not_blank CHECK (length(trim(title)) > 0),
  CONSTRAINT operational_expenses_amount_nonnegative CHECK (amount >= 0)
);
ALTER TABLE public.operational_expenses ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS operational_expenses_updated_at ON public.operational_expenses;
CREATE TRIGGER operational_expenses_updated_at BEFORE UPDATE ON public.operational_expenses
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE OR REPLACE FUNCTION public.ensure_operational_expense_category_branch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.operational_expense_categories c
    WHERE c.id = NEW.category_id AND c.branch_id = NEW.branch_id
  ) THEN
    RAISE EXCEPTION 'expense category does not belong to this branch';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS operational_expenses_category_branch ON public.operational_expenses;
CREATE TRIGGER operational_expenses_category_branch
BEFORE INSERT OR UPDATE OF branch_id, category_id ON public.operational_expenses
FOR EACH ROW EXECUTE FUNCTION public.ensure_operational_expense_category_branch();
CREATE INDEX IF NOT EXISTS operational_expenses_branch_date_idx
  ON public.operational_expenses(branch_id, expense_date DESC, status);
CREATE INDEX IF NOT EXISTS operational_expenses_category_idx
  ON public.operational_expenses(category_id);

CREATE OR REPLACE VIEW public.operational_expense_summary_by_category
WITH (security_invoker = true) AS
SELECT
  e.branch_id,
  e.category_id,
  COALESCE(c.name, 'Uncategorized') AS category_name,
  e.expense_date,
  sum(e.amount)::numeric(14,2) AS total_amount,
  count(*)::integer AS expense_count
FROM public.operational_expenses e
LEFT JOIN public.operational_expense_categories c ON c.id = e.category_id
WHERE e.status <> 'void'
GROUP BY e.branch_id, e.category_id, COALESCE(c.name, 'Uncategorized'), e.expense_date;

GRANT SELECT ON public.operational_expense_summary_by_category TO authenticated;

DROP POLICY IF EXISTS operational_expense_categories_member_select ON public.operational_expense_categories;
DROP POLICY IF EXISTS operational_expense_categories_manager_all ON public.operational_expense_categories;
DROP POLICY IF EXISTS operational_expenses_member_select ON public.operational_expenses;
DROP POLICY IF EXISTS operational_expenses_manager_all ON public.operational_expenses;

CREATE POLICY operational_expense_categories_member_select ON public.operational_expense_categories
  FOR SELECT TO authenticated
  USING (public.can_access_branch(auth.uid(), branch_id));
CREATE POLICY operational_expense_categories_manager_all ON public.operational_expense_categories
  FOR ALL TO authenticated
  USING (public.can_manage_branch(auth.uid(), branch_id))
  WITH CHECK (public.can_manage_branch(auth.uid(), branch_id));

CREATE POLICY operational_expenses_member_select ON public.operational_expenses
  FOR SELECT TO authenticated
  USING (public.can_access_branch(auth.uid(), branch_id));
CREATE POLICY operational_expenses_manager_all ON public.operational_expenses
  FOR ALL TO authenticated
  USING (public.can_manage_branch(auth.uid(), branch_id))
  WITH CHECK (public.can_manage_branch(auth.uid(), branch_id));

NOTIFY pgrst, 'reload schema';
