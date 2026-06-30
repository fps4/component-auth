'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Route-segment error boundary (App Router). Without this, any error thrown while rendering a page —
 * a transient 401 when the operator token expires, a backend hiccup, or a stale Server Action reference
 * after a redeploy — renders Next's opaque "a client-side exception has occurred" page with no recovery.
 * Here we show the real message and a Retry/Reload so the console self-heals.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Production masks the message in the default overlay — log it so it is visible in the console.
    console.error('console route error:', error);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl py-10">
      <Card>
        <CardHeader><CardTitle>Something went wrong</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The console hit an unexpected error. A tab left open across a deploy is the usual cause —
            reloading reconnects it to the current version.
          </p>
          <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">
            {error.message || 'Unknown error'}{error.digest ? `\n\ndigest: ${error.digest}` : ''}
          </pre>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => reset()}>Try again</Button>
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>Reload page</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
