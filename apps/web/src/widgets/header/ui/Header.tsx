import { Link, useLocation } from "@tanstack/react-router";
import { Store } from "lucide-react";
import type { ReactNode } from "react";
import { useAdminAuth, useSignOut } from "@/features/admin-auth";
import { Button } from "@/shared/ui/button";

/** Site header. `actions` is a slot for the right-hand side (the cart button). */
export function Header({ actions }: { actions?: ReactNode }) {
  const signedIn = useAdminAuth((s) => s.authorization !== null);
  const signOut = useSignOut();
  const onAdminPage = useLocation({ select: (l) => l.pathname.startsWith("/admin") });

  return (
    <header className="bg-background/80 sticky top-0 z-10 border-b backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2 text-lg font-semibold">
          <Store className="size-5" /> FAPI Shop
        </Link>
        <div className="flex items-center gap-4">
          {/* On the admin page itself, signed in, the link would lead nowhere new. */}
          {!(signedIn && onAdminPage) && (
            <Link to="/admin" className="text-muted-foreground hover:text-foreground text-sm">
              Admin
            </Link>
          )}
          {signedIn && (
            <Button variant="outline" size="sm" onClick={signOut}>
              Sign out
            </Button>
          )}
          {actions}
        </div>
      </div>
    </header>
  );
}
