import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ActionForm } from '@/components/action-form';
import { Field } from '@/components/field';
import { createUser, resetPassword, setUserStatus, unlockUser } from '@/app/actions';

export const dynamic = 'force-dynamic';

export default function UsersPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Users</h1>

      <Card>
        <CardHeader><CardTitle>Create a local-credential user</CardTitle></CardHeader>
        <CardContent>
          <ActionForm action={createUser} submitLabel="Create user">
            <Field name="tenantId" label="Tenant id" required />
            <Field name="email" label="Email" type="email" required />
            <Field name="password" label="Password" type="password" required />
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Reset password</CardTitle></CardHeader>
        <CardContent>
          <ActionForm action={resetPassword} submitLabel="Reset password">
            <Field name="tenantId" label="Tenant id" required />
            <Field name="email" label="Email" type="email" required />
            <Field name="password" label="New password" type="password" required />
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Set status (active / disabled)</CardTitle></CardHeader>
        <CardContent>
          <ActionForm action={setUserStatus} submitLabel="Set status">
            <Field name="tenantId" label="Tenant id" required />
            <Field name="email" label="Email" type="email" required />
            <Field name="status" label="Status (active/disabled)" placeholder="disabled" required />
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Unlock (clear brute-force lockout)</CardTitle></CardHeader>
        <CardContent>
          <ActionForm action={unlockUser} submitLabel="Unlock user">
            <Field name="tenantId" label="Tenant id" required />
            <Field name="email" label="Email" type="email" required />
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
