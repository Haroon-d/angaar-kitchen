import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Flame } from "lucide-react";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    // Index just redirects to dashboard or login depending on session.
    // We redirect to /dashboard which is itself protected and will bounce to /login.
    throw redirect({ to: "/dashboard" });
  },
  component: Landing,
});

function Landing() {
  return (
    <div className="relative min-h-screen ember-glow grain overflow-hidden">
      <div className="mx-auto max-w-3xl px-6 py-32 text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-ember-gradient shadow-ember">
          <Flame className="h-7 w-7 text-primary-foreground" />
        </div>
        <h1 className="font-display text-5xl">Angaar Kitchen</h1>
        <p className="mt-3 text-muted-foreground">Restaurant management built for the fire.</p>
        <Link to="/login" className="mt-8 inline-flex rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground">Sign in</Link>
      </div>
    </div>
  );
}
