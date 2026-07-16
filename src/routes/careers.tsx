import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  Flame,
  MapPin,
  MessageCircle,
  Send,
  ShieldCheck,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { getPublicCareers, submitJobApplication } from "@/lib/careers.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/careers")({ component: CareersPage });

type Job = {
  id: string;
  title: string;
  department: string | null;
  location: string | null;
  employment_type: string;
  salary_range: string | null;
  description: string | null;
  requirements: string | null;
};

const emptyForm = {
  applicantName: "",
  phone: "",
  whatsapp: "",
  email: "",
  city: "",
  experience: "",
  expectedSalary: "",
  availability: "",
  source: "Careers website",
  message: "",
};

const DEFAULT_CAREERS_LOCATION = "GT Road Near Punjab College Kamoke";

function CareersPage() {
  const q = useQuery({
    queryKey: ["public-careers"],
    queryFn: () => getPublicCareers(),
  });
  const jobs = useMemo(() => (q.data?.jobs ?? []) as Job[], [q.data?.jobs]);
  const restaurant = q.data?.restaurant;
  const [selectedJobId, setSelectedJobId] = useState("");
  const [form, setForm] = useState(emptyForm);
  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) ?? null,
    [jobs, selectedJobId],
  );
  const phone = restaurant?.phone || "0335 7200955";
  const whatsappHref = `https://wa.me/${phone.replace(/\D/g, "")}`;

  const applyMutation = useMutation({
    mutationFn: () =>
      submitJobApplication({
        data: {
          jobPostId: selectedJob?.id ?? null,
          ...form,
        },
      }),
    onSuccess: () => {
      toast.success("Application received. Our team will contact you if shortlisted.");
      setForm(emptyForm);
      setSelectedJobId("");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not submit application.");
    },
  });

  return (
    <main className="min-h-screen bg-[#f7f1e7] text-[#1d1812]">
      <header className="border-b border-[#dacaa9] bg-[#fffaf0]/95">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <Link to="/" className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-md bg-[#11100d] text-[#ff7438]">
              <Flame className="h-6 w-6 fill-current" />
            </span>
            <span>
              <span className="block font-display text-2xl leading-none">angaar kitchen</span>
              <span className="mt-1 block text-[10px] font-bold uppercase tracking-[0.28em] text-[#a16d22]">
                Careers
              </span>
            </span>
          </Link>
          <a
            href={whatsappHref}
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-2 rounded-md border border-[#c6a86f] bg-white px-4 py-2 text-sm font-semibold text-[#1d1812] shadow-sm transition hover:border-[#ff7438] sm:inline-flex"
          >
            <MessageCircle className="h-4 w-4 text-[#ff7438]" />
            WhatsApp
          </a>
        </div>
      </header>

      <section className="border-b border-[#e1d0aa] bg-[linear-gradient(135deg,#fff7e8_0%,#f5ead6_52%,#130f0a_52%,#070604_100%)]">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 lg:grid-cols-[1.05fr_0.95fr] lg:py-16">
          <div className="max-w-2xl">
            <div className="mb-5 inline-flex rounded-md border border-[#d2b77b] bg-white/70 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.22em] text-[#8d5e1d]">
              Work with angaar kitchen
            </div>
            <h1 className="font-display text-4xl leading-tight text-[#17120d] sm:text-5xl lg:text-6xl">
              Join a disciplined kitchen built on food, timing, and respect.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-[#5f5140]">
              We hire people who care about clean work, honest service, and steady growth. Apply
              for an open role or send a general application for future hiring.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href="#apply">
                <Button className="bg-[#ff7438] text-black hover:bg-[#ff8c5d]">
                  Apply now
                  <Send className="ml-2 h-4 w-4" />
                </Button>
              </a>
              <a href="#roles">
                <Button variant="outline" className="border-[#b99350] bg-white text-[#1d1812]">
                  View open roles
                </Button>
              </a>
            </div>
          </div>

          <div className="rounded-md border border-[#b99350]/35 bg-[#11100d] p-5 text-[#fff6e5] shadow-xl">
            <p className="text-xs font-bold uppercase tracking-[0.26em] text-[#d9b96f]">
              Hiring desk
            </p>
            <h2 className="mt-3 font-display text-3xl">Simple, fair, and clear.</h2>
            <p className="mt-3 text-sm leading-6 text-[#cdbf9e]">
              Your application is stored for the operations team. If your profile matches the role,
              they can shortlist you and contact you from the hiring screen.
            </p>
            <div className="mt-6 grid gap-3">
              <InfoCard icon={BriefcaseBusiness} label="Open roles" value={`${jobs.length} active`} />
              <InfoCard icon={MapPin} label="Location" value={displayCareersLocation(restaurant?.address)} />
              <InfoCard icon={MessageCircle} label="Contact" value={phone} />
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-5 py-8 md:grid-cols-3">
        <ValueCard icon={ShieldCheck} title="Clean standards" text="Hygiene, timing, and discipline are treated as serious work." />
        <ValueCard icon={UsersRound} title="Team respect" text="Clear roles, direct communication, and no confusion for applicants." />
        <ValueCard icon={Clock3} title="Growth path" text="Good staff can grow into trusted responsibility over time." />
      </section>

      <section id="roles" className="mx-auto max-w-6xl px-5 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#9b6b25]">
              Open roles
            </p>
            <h2 className="mt-2 font-display text-4xl">Current hiring</h2>
          </div>
          <p className="max-w-md text-sm leading-6 text-[#675845]">
            Select a role to apply for it, or leave the position empty for a general application.
          </p>
        </div>

        {q.isLoading ? (
          <PanelText>Loading roles...</PanelText>
        ) : jobs.length === 0 ? (
          <PanelText>No public openings right now. You can still send a general application.</PanelText>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                active={job.id === selectedJobId}
                onClick={() => {
                  setSelectedJobId(job.id);
                  document.getElementById("apply")?.scrollIntoView({ behavior: "smooth" });
                }}
              />
            ))}
          </div>
        )}
      </section>

      <section id="apply" className="mx-auto grid max-w-6xl gap-8 px-5 py-12 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#9b6b25]">
            Application form
          </p>
          <h2 className="mt-2 font-display text-4xl">Tell us about yourself</h2>
          <p className="mt-4 text-sm leading-7 text-[#675845]">
            Keep details accurate. Phone number is required so the team can contact you quickly.
          </p>
          <div className="mt-5 rounded-md border border-[#dacaa9] bg-white p-4 text-sm text-[#5f5140]">
            <CheckCircle2 className="mb-2 h-5 w-5 text-[#ff7438]" />
            Applications come directly into the internal Hiring screen for review.
          </div>
        </div>

        <form
          className="grid gap-4 rounded-md border border-[#dacaa9] bg-white p-5 shadow-sm sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            applyMutation.mutate();
          }}
        >
          <div className="space-y-2 sm:col-span-2">
            <Label>Position</Label>
            {jobs.length > 0 ? (
              <Select value={selectedJobId} onValueChange={setSelectedJobId}>
                <SelectTrigger>
                  <SelectValue placeholder="General application" />
                </SelectTrigger>
                <SelectContent>
                  {jobs.map((job) => (
                    <SelectItem key={job.id} value={job.id}>
                      {job.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input value="General application" readOnly />
            )}
          </div>
          <Field label="Full name" value={form.applicantName} onChange={(value) => setForm({ ...form, applicantName: value })} required />
          <Field label="Phone" value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} required />
          <Field label="WhatsApp" value={form.whatsapp} onChange={(value) => setForm({ ...form, whatsapp: value })} />
          <Field label="Email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} />
          <Field label="City / Area" value={form.city} onChange={(value) => setForm({ ...form, city: value })} />
          <Field label="Expected salary" value={form.expectedSalary} onChange={(value) => setForm({ ...form, expectedSalary: value })} />
          <Field label="Experience" value={form.experience} onChange={(value) => setForm({ ...form, experience: value })} placeholder="e.g. 2 years cashier" />
          <Field label="Availability" value={form.availability} onChange={(value) => setForm({ ...form, availability: value })} placeholder="Immediate, one week" />
          <div className="space-y-2 sm:col-span-2">
            <Label>Message</Label>
            <Textarea
              rows={4}
              value={form.message}
              onChange={(event) => setForm({ ...form, message: event.target.value })}
              placeholder="Write anything important about your experience, timing, or preferred role."
            />
          </div>
          <div className="sm:col-span-2">
            <Button
              type="submit"
              disabled={applyMutation.isPending}
              className="w-full bg-[#ff7438] text-black hover:bg-[#ff8c5d]"
            >
              {applyMutation.isPending ? "Submitting..." : "Submit application"}
            </Button>
          </div>
        </form>
      </section>
    </main>
  );
}

function InfoCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex gap-3 rounded-md border border-[#d9b96f]/20 bg-white/5 p-3">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-[#ff7438]" />
      <div>
        <div className="text-xs uppercase tracking-[0.18em] text-[#d9b96f]">{label}</div>
        <div className="mt-0.5 text-sm font-semibold">{value}</div>
      </div>
    </div>
  );
}

function displayCareersLocation(address?: string | null) {
  const clean = address?.trim();
  if (!clean || clean.toLowerCase() === "pakistan") return DEFAULT_CAREERS_LOCATION;
  return clean;
}

function ValueCard({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <article className="rounded-md border border-[#dacaa9] bg-white p-5 shadow-sm">
      <Icon className="h-6 w-6 text-[#ff7438]" />
      <h3 className="mt-4 text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-[#675845]">{text}</p>
    </article>
  );
}

function JobCard({ job, active, onClick }: { job: Job; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#ff7438] ${
        active ? "border-[#ff7438] ring-2 ring-[#ff7438]/20" : "border-[#dacaa9]"
      }`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="rounded-md bg-[#f4ead6] px-3 py-1 text-xs font-semibold text-[#8d5e1d]">
          {job.department || "Operations"}
        </span>
        <span className="text-xs capitalize text-[#675845]">{job.employment_type.replace("_", " ")}</span>
      </div>
      <h3 className="text-xl font-semibold">{job.title}</h3>
      <p className="mt-3 line-clamp-3 text-sm leading-6 text-[#675845]">
        {job.description || "A focused role for reliable people who work with discipline."}
      </p>
      <div className="mt-5 flex flex-wrap gap-2 text-xs font-medium text-[#9b6b25]">
        {job.location && <span>{job.location}</span>}
        {job.salary_range && <span>{job.salary_range}</span>}
      </div>
    </button>
  );
}

function PanelText({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-[#dacaa9] bg-white p-8 text-center text-sm text-[#675845]">
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
      />
    </div>
  );
}
