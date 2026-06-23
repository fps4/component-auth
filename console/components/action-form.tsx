'use client';

import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { ActionResult } from '@/app/actions';

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <Button type="submit" size="sm" disabled={pending}>{pending ? 'Working…' : label}</Button>;
}

/**
 * Wraps a server action in a form: shows pending state, toasts the result, and — when an action
 * returns a freshly minted secret — surfaces it once via a copyable toast (it is never persisted).
 */
export function ActionForm({
  action,
  submitLabel,
  children,
}: {
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
  submitLabel: string;
  children: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, { ok: false });

  useEffect(() => {
    if (!state) return;
    if (state.secret) toast.success(state.message ?? 'Done', { description: `Secret (shown once): ${state.secret}`, duration: 30000 });
    else if (state.ok && state.message) toast.success(state.message);
    else if (!state.ok && state.message) toast.error(state.message);
  }, [state]);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      {children}
      <SubmitButton label={submitLabel} />
    </form>
  );
}
