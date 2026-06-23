import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, THead, TBody } from '@/components/ui/table';
import { ActionForm } from '@/components/action-form';
import { Field } from '@/components/field';
import { onboardTenant } from '@/app/actions';

export const dynamic = 'force-dynamic';

export default async function TenantsPage() {
  let tenants: Awaited<ReturnType<typeof api.listTenants>> | undefined; let error: string | undefined;
  try { tenants = await api.listTenants(); } catch (e) { error = (e as Error).message; }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Tenants</h1>

      <Card>
        <CardHeader><CardTitle>Onboard / update a tenant</CardTitle></CardHeader>
        <CardContent>
          <ActionForm action={onboardTenant} submitLabel="Save tenant">
            <Field name="name" label="Name" placeholder="Acme Inc" required />
            <Field name="id" label="Tenant id (blank = new)" placeholder="optional" />
            <Field name="provider" label="IdP provider (local/google/blank)" placeholder="local" />
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>All tenants</CardTitle></CardHeader>
        <CardContent>
          {error ? <p className="text-sm text-destructive">{error}</p> : (
            <Table>
              <THead><tr><th>Name</th><th>Id</th><th>Status</th></tr></THead>
              <TBody>
                {tenants?.map((t) => (
                  <tr key={t._id}><td>{t.name}</td><td className="font-mono text-xs">{t._id}</td><td>{t.status}</td></tr>
                ))}
                {!tenants?.length && <tr><td colSpan={3} className="text-muted-foreground">No tenants yet.</td></tr>}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
