import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, THead, TBody } from '@/components/ui/table';
import { ActionForm } from '@/components/action-form';
import { Field } from '@/components/field';
import { createClient, rotateClientSecret } from '@/app/actions';

export const dynamic = 'force-dynamic';

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ tenantId?: string }> }) {
  const { tenantId } = await searchParams;
  let clients: Awaited<ReturnType<typeof api.listClients>> | undefined; let error: string | undefined;
  if (tenantId) {
    try { clients = await api.listClients(tenantId); } catch (e) { error = (e as Error).message; }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Clients</h1>

      <Card>
        <CardHeader><CardTitle>Register a client</CardTitle></CardHeader>
        <CardContent>
          <ActionForm action={createClient} submitLabel="Create client">
            <Field name="tenantId" label="Tenant id" required defaultValue={tenantId} />
            <Field name="name" label="Name" placeholder="my-service" required />
            <Field name="grantTypes" label="Grant types (comma)" placeholder="client_credentials" required />
            <Field name="scopes" label="Scopes (comma)" placeholder="admin" />
            <Field name="audience" label="Audience" placeholder="optional" />
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Rotate a client secret</CardTitle></CardHeader>
        <CardContent>
          <ActionForm action={rotateClientSecret} submitLabel="Rotate secret">
            <Field name="clientId" label="Client id" required />
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{tenantId ? `Clients for ${tenantId}` : 'Clients'}</CardTitle></CardHeader>
        <CardContent>
          {!tenantId ? <p className="text-sm text-muted-foreground">Append <code>?tenantId=…</code> to list a tenant&apos;s clients.</p>
            : error ? <p className="text-sm text-destructive">{error}</p> : (
            <Table>
              <THead><tr><th>Name</th><th>Client id</th><th>Grants</th><th>Scopes</th></tr></THead>
              <TBody>
                {clients?.map((c) => (
                  <tr key={c._id}><td>{c.name}</td><td className="font-mono text-xs">{c._id}</td><td>{c.grantTypes?.join(', ')}</td><td>{c.scopes?.join(', ')}</td></tr>
                ))}
                {!clients?.length && <tr><td colSpan={4} className="text-muted-foreground">No clients.</td></tr>}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
