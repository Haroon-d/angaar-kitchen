import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Flame, Loader2 } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/login")({ component: LoginPage });

const Schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(6, "At least 6 characters"),
});

function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = Schema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Welcome back");
    nav({ to: "/dashboard" });
  }

  return (
    <div className="relative min-h-screen grid lg:grid-cols-2 bg-background">
      <div className="relative hidden lg:flex flex-col justify-between p-12 ember-glow grain overflow-hidden bg-coal-gradient">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-ember-gradient shadow-ember">
            <Flame className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="font-display text-xl">Angaar Kitchen</span>
        </div>
        <div className="relative z-10 max-w-md">
          <h1 className="font-display text-5xl leading-tight">Run the kitchen.<br/><span className="text-primary">Own the fire.</span></h1>
          <p className="mt-4 text-muted-foreground">A complete restaurant operating system — menus, billing, branches, and reporting in one premium dashboard.</p>
        </div>
        <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} Angaar Kitchen</p>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-ember-gradient">
              <Flame className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-display text-lg">Angaar Kitchen</span>
          </div>
          <h2 className="font-display text-3xl">Sign in</h2>
          <p className="mt-1 text-sm text-muted-foreground">Welcome back. Enter your credentials.</p>

          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@restaurant.com" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Sign in
            </Button>
          </form>

          <p className="mt-6 text-sm text-muted-foreground">
            New to Angaar? <Link to="/signup" className="text-primary hover:underline">Create an account</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
