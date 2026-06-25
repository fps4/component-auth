'use client';

// Operator identity chip + sign-out (RQ-0007, ADR-0010). The identity is decoded from
// the stored identity-service token (display only — the management plane verifies).
// Sign-out clears the token and returns to /login. Ported from maestro-web.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { clearTokens, identityFromToken } from '@/lib/auth';

export function UserMenu() {
  const router = useRouter();
  const [identity, setIdentity] = useState<string | null>(null);

  // Token is only readable after mount (localStorage) — avoids an SSR mismatch.
  useEffect(() => setIdentity(identityFromToken()), []);

  function signOut() {
    clearTokens();
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      {identity ? (
        <span className="hidden font-mono text-xs text-muted-foreground sm:inline" title={identity}>
          {identity}
        </span>
      ) : null}
      <Button type="button" variant="ghost" size="sm" onClick={signOut}>
        Sign out
      </Button>
    </div>
  );
}
