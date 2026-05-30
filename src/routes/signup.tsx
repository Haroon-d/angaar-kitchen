import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Flame, Loader2, LockKeyhole, Mail, UserRound } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/signup")({ component: SignupPage });

const Schema = z.object({
  full_name: z.string().min(2, "Enter your name").max(80),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters"),
});

function SignupPage() {
  const [full_name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();
  const { signUp } = useAuth();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = Schema.safeParse({ full_name, email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    try {
      await signUp({
        fullName: parsed.data.full_name,
        email: parsed.data.email,
        password: parsed.data.password,
      });
      toast.success("Account created. You can now order as a customer.");
      nav({ to: "/" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to create account");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative grid min-h-screen bg-background lg:grid-cols-[1.05fr_0.95fr]">
      <div className="relative hidden overflow-hidden border-r border-border/70 bg-coal-gradient p-12 lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 ember-glow grain" />
        <div className="relative z-10 flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-ember-gradient shadow-ember">
            <Flame className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="font-display text-xl">Angaar Kitchen</span>
        </div>
        <div className="relative z-10 max-w-md">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-primary">
            New workspace
          </p>
          <h1 className="font-display text-5xl leading-tight">
            Set up a restaurant system that stays composed.
          </h1>
          <p className="mt-5 text-sm leading-6 text-muted-foreground">
            Start with account access, then configure branches, staff, menus, and billing from
            onboarding.
          </p>
        </div>
        <p className="relative z-10 text-xs text-muted-foreground">
          Copyright {new Date().getFullYear()} Angaar Kitchen
        </p>
      </div>

      <div className="flex items-center justify-center p-5 sm:p-10">
        <div className="w-full max-w-[420px] rounded-lg border border-border/70 bg-card/76 p-6 shadow-card sm:p-8">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-ember-gradient">
              <Flame className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-display text-lg">Angaar Kitchen</span>
          </div>
          <h2 className="font-display text-3xl">Create account</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Create a customer account for ordering.
          </p>

          <form onSubmit={onSubmit} className="mt-8 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="name">Full name</Label>
              <div className="relative">
                <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="name"
                  value={full_name}
                  onChange={(e) => setName(e.target.value)}
                  className="pl-9"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9"
                  required
                />
              </div>
              <p className="text-xs text-muted-foreground">Use at least 8 characters.</p>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create account
            </Button>
          </form>

          <p className="mt-6 text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link to="/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
