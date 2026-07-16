import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BriefcaseBusiness, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { appDb as db } from "@/lib/app-db";
import { hasPermission } from "@/lib/rbac";
import { useActiveBranch } from "@/hooks/use-active-branch";
import { useMyRoles } from "@/hooks/use-auth";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/hiring")({ component: CareersAdminPage });

type JobPost = {
  id: string;
  restaurant_id: string;
  title: string;
  department: string | null;
  location: string | null;
  employment_type: string;
  salary_range: string | null;
  description: string | null;
  requirements: string | null;
  sort_order: number | string;
  is_active: boolean;
  created_at: string;
};

type JobApplication = {
  id: string;
  job_post_id: string | null;
  applicant_name: string;
  phone: string;
  whatsapp: string | null;
  email: string | null;
  city: string | null;
  experience: string | null;
  expected_salary: string | null;
  availability: string | null;
  source: string | null;
  message: string | null;
  status: "new" | "shortlisted" | "interview" | "hired" | "rejected";
  admin_notes: string | null;
  created_at: string;
};

const statusLabels: Record<JobApplication["status"], string> = {
  new: "New",
  shortlisted: "Shortlisted",
  interview: "Interview",
  hired: "Hired",
  rejected: "Rejected",
};

function CareersAdminPage() {
  const { restaurant } = useActiveBranch();
  const { data: roles } = useMyRoles();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const canManage = hasPermission(roles, "staff:manage");

  const jobsQ = useQuery({
    queryKey: ["job-posts", restaurant?.id],
    enabled: !!restaurant?.id,
    queryFn: async () => {
      const { data, error } = await db
        .from("job_posts")
        .select("*")
        .eq("restaurant_id", restaurant!.id)
        .order("sort_order")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as JobPost[];
    },
  });

  const applicationsQ = useQuery({
    queryKey: ["job-applications", restaurant?.id],
    enabled: !!restaurant?.id,
    queryFn: async () => {
      const { data, error } = await db
        .from("job_applications")
        .select("*")
        .eq("restaurant_id", restaurant!.id)
        .order("created_at", { ascending: false })
        .limit(120);
      if (error) throw error;
      return (data ?? []) as JobApplication[];
    },
  });

  const jobById = useMemo(
    () => new Map((jobsQ.data ?? []).map((job) => [job.id, job])),
    [jobsQ.data],
  );
  const applications = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (applicationsQ.data ?? []).filter((app) => {
      if (!term) return true;
      const job = app.job_post_id ? jobById.get(app.job_post_id)?.title : "";
      return [
        app.applicant_name,
        app.phone,
        app.city,
        app.status,
        job,
        app.experience,
      ].some((value) => String(value ?? "").toLowerCase().includes(term));
    });
  }, [applicationsQ.data, jobById, search]);

  if (!restaurant) {
    return <div className="p-8 text-center text-muted-foreground">Select a restaurant first.</div>;
  }

  return (
    <div className="space-y-6 p-4 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Careers</h1>
          <p className="text-sm text-muted-foreground">
            Publish roles and manage applications from the careers website.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="w-full pl-9 sm:w-72"
              placeholder="Search applicants"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {canManage && (
            <JobDialog
              restaurantId={restaurant.id}
              onSaved={() => qc.invalidateQueries({ queryKey: ["job-posts"] })}
            />
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Open roles" value={(jobsQ.data ?? []).filter((job) => job.is_active).length} />
        <Metric label="New applicants" value={(applicationsQ.data ?? []).filter((app) => app.status === "new").length} />
        <Metric label="Interviews" value={(applicationsQ.data ?? []).filter((app) => app.status === "interview").length} />
      </div>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Job posts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {jobsQ.isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            ) : (jobsQ.data ?? []).length === 0 ? (
              <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
                No job posts yet.
              </div>
            ) : (
              (jobsQ.data ?? []).map((job) => (
                <div key={job.id} className="rounded-lg border border-border bg-surface p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold">{job.title}</h3>
                        <Badge variant={job.is_active ? "default" : "outline"}>
                          {job.is_active ? "Active" : "Hidden"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {[job.department, job.location, job.employment_type.replace("_", " ")]
                          .filter(Boolean)
                          .join(" - ")}
                      </p>
                    </div>
                    {canManage && (
                      <div className="flex gap-1">
                        <JobDialog
                          restaurantId={restaurant.id}
                          job={job}
                          onSaved={() => qc.invalidateQueries({ queryKey: ["job-posts"] })}
                          trigger={
                            <Button variant="ghost" size="icon">
                              <Pencil className="h-4 w-4" />
                            </Button>
                          }
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={async () => {
                            if (!window.confirm("Delete this job post?")) return;
                            const { error } = await db.from("job_posts").delete().eq("id", job.id);
                            if (error) toast.error(error.message);
                            else {
                              toast.success("Job post deleted");
                              qc.invalidateQueries({ queryKey: ["job-posts"] });
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                  {job.description && (
                    <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                      {job.description}
                    </p>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Applications</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {applicationsQ.isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            ) : applications.length === 0 ? (
              <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
                No applications found.
              </div>
            ) : (
              applications.map((application) => (
                <ApplicationCard
                  key={application.id}
                  application={application}
                  jobTitle={
                    application.job_post_id
                      ? jobById.get(application.job_post_id)?.title || "Deleted role"
                      : "General application"
                  }
                  canManage={canManage}
                  onChanged={() => qc.invalidateQueries({ queryKey: ["job-applications"] })}
                />
              ))
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-2 font-display text-3xl">{value}</p>
        </div>
        <BriefcaseBusiness className="h-6 w-6 text-primary" />
      </CardContent>
    </Card>
  );
}

function JobDialog({
  restaurantId,
  job,
  trigger,
  onSaved,
}: {
  restaurantId: string;
  job?: JobPost;
  trigger?: React.ReactNode;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    title: job?.title ?? "",
    department: job?.department ?? "",
    location: job?.location ?? "Kamoke",
    employment_type: job?.employment_type ?? "full_time",
    salary_range: job?.salary_range ?? "",
    description: job?.description ?? "",
    requirements: job?.requirements ?? "",
    sort_order: String(job?.sort_order ?? "0"),
    is_active: job?.is_active ?? true,
  });

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form.title.trim()) {
      toast.error("Job title is required");
      return;
    }
    setLoading(true);
    const payload = {
      restaurant_id: restaurantId,
      title: form.title.trim(),
      department: form.department || null,
      location: form.location || null,
      employment_type: form.employment_type,
      salary_range: form.salary_range || null,
      description: form.description || null,
      requirements: form.requirements || null,
      sort_order: Number(form.sort_order) || 0,
      is_active: form.is_active,
    };
    const { error } = job
      ? await db.from("job_posts").update(payload).eq("id", job.id)
      : await db.from("job_posts").insert(payload);
    setLoading(false);
    if (error) toast.error(error.message);
    else {
      toast.success(job ? "Job post updated" : "Job post created");
      setOpen(false);
      onSaved();
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Job post
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{job ? "Edit job post" : "New job post"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <TextField label="Title" value={form.title} onChange={(value) => setForm({ ...form, title: value })} required />
          <TextField label="Department" value={form.department} onChange={(value) => setForm({ ...form, department: value })} />
          <TextField label="Location" value={form.location} onChange={(value) => setForm({ ...form, location: value })} />
          <div className="space-y-2">
            <Label>Employment type</Label>
            <Select
              value={form.employment_type}
              onValueChange={(value) => setForm({ ...form, employment_type: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full_time">Full time</SelectItem>
                <SelectItem value="part_time">Part time</SelectItem>
                <SelectItem value="shift">Shift</SelectItem>
                <SelectItem value="internship">Internship</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <TextField label="Salary range" value={form.salary_range} onChange={(value) => setForm({ ...form, salary_range: value })} />
          <TextField label="Sort order" value={form.sort_order} onChange={(value) => setForm({ ...form, sort_order: value })} type="number" />
          <div className="space-y-2 sm:col-span-2">
            <Label>Description</Label>
            <Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={3} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Requirements</Label>
            <Textarea value={form.requirements} onChange={(event) => setForm({ ...form, requirements: event.target.value })} rows={3} />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Switch checked={form.is_active} onCheckedChange={(value) => setForm({ ...form, is_active: value })} />
            <Label>Show on careers website</Label>
          </div>
          <DialogFooter className="sm:col-span-2">
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ApplicationCard({
  application,
  jobTitle,
  canManage,
  onChanged,
}: {
  application: JobApplication;
  jobTitle: string;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [notes, setNotes] = useState(application.admin_notes ?? "");

  async function update(values: Partial<JobApplication>) {
    const { error } = await db.from("job_applications").update(values).eq("id", application.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Application updated");
      onChanged();
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{application.applicant_name}</h3>
            <Badge variant="outline">{statusLabels[application.status]}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {jobTitle} - {formatDate(application.created_at)}
          </p>
        </div>
        {canManage && (
          <Select
            value={application.status}
            onValueChange={(value) => update({ status: value as JobApplication["status"] })}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(statusLabels).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <Info label="Phone" value={application.phone} />
        <Info label="WhatsApp" value={application.whatsapp || application.phone} />
        <Info label="City" value={application.city} />
        <Info label="Experience" value={application.experience} />
        <Info label="Expected salary" value={application.expected_salary} />
        <Info label="Availability" value={application.availability} />
      </div>
      {application.message && (
        <p className="mt-4 rounded-md border border-border p-3 text-sm text-muted-foreground">
          {application.message}
        </p>
      )}
      {canManage && (
        <div className="mt-4 space-y-2">
          <Label>Admin notes</Label>
          <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
          <Button variant="outline" size="sm" onClick={() => update({ admin_notes: notes })}>
            Save notes
          </Button>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <p className="font-medium">{value || "-"}</p>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
      />
    </div>
  );
}
