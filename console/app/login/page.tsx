'use client';

// The /login route (RQ-0007, ADR-0010). Public (middleware lets it through). On success
// — whether via silent refresh or the password form — it navigates to the `next` param
// (where the operator was headed before the gate redirected them). A full navigation,
// not a client push, so the freshly-set session cookie reaches the server render of the
// destination. Ported from maestro-web.

import { Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { LoginForm } from '@/components/auth/login-form';

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();

  const onAuthenticated = useCallback(() => {
    const next = params.get('next') || '/';
    // Guard against open redirects: only same-origin paths.
    const dest = next.startsWith('/') && !next.startsWith('//') ? next : '/';
    router.replace(dest);
    router.refresh();
  }, [params, router]);

  return <LoginForm onAuthenticated={onAuthenticated} />;
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
          Loading…
        </div>
      }
    >
      <LoginInner />
    </Suspense>
  );
}
