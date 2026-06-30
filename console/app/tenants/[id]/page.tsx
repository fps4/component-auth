import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, THead, TBody } from '@/components/ui/table';
import { ActionForm } from '@/components/action-form';
import { Field, Hidden } from '@/components/field';
import {
  createClient, rotateClientSecret, deleteClient,
  createUser, resetPassword, setUserStatus, unlockUser, deleteUser,
  setTenantStatus,
} from '@/app/actions';

export const dynamic = 'force-dynamic';

export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let tenant: Awaited<ReturnType<typeof api.getTenant>> | undefined;
  let loadError: string | undefined;
  try {
    tenant = await api.getTenant(id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    // Degrade gracefully (e.g. a transient 401/5xx) instead of throwing an opaque client-side exception.
    loadError = (e as Error).message;
  }

  if (!tenant) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/tenants" className="hover:underline">Tenants</Link>
          <span>/</span>
          <span className="font-mono text-foreground">{id}</span>
        </div>
        <Card>
          <CardHeader><CardTitle>Couldn&apos;t load this tenant</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-destructive">{loadError ?? 'Unknown error'}</p>
            <Link href="/tenants" className="text-sm hover:underline">← Back to tenants</Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Clients and users are independent reads — fetch together, tolerate either failing.
  const [clients, users] = await Promise.all([
    api.listClients(id).catch(() => undefined),
    api.listUsers(id).catch(() => undefined),
  ]);

  const oauth = tenant.oauth;
  const suspended = tenant.status === 'suspended';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/tenants" className="hover:underline">Tenants</Link>
        <span>/</span>
        <span className="text-foreground">{tenant.name}</span>
      </div>

      {/* --- Tenant summary --- */}
      <Card>
        <CardHeader><CardTitle>{tenant.name}</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-[8rem_1fr] gap-y-1">
            <span className="text-muted-foreground">Tenant id</span><span className="font-mono text-xs">{tenant._id}</span>
            <span className="text-muted-foreground">Status</span><span>{tenant.status}</span>
            <span className="text-muted-foreground">OAuth</span>
            <span>{oauth?.enabled ? 'enabled' : 'disabled'}{oauth?.idp?.provider ? ` · IdP: ${oauth.idp.provider}` : ''}</span>
            {oauth?.allowedGrantTypes?.length ? (
              <><span className="text-muted-foreground">Grant types</span><span>{oauth.allowedGrantTypes.join(', ')}</span></>
            ) : null}
            {oauth?.allowedScopes?.length ? (
              <><span className="text-muted-foreground">Scopes</span><span>{oauth.allowedScopes.join(', ')}</span></>
            ) : null}
          </div>
          <ActionForm action={setTenantStatus} submitLabel={suspended ? 'Activate tenant' : 'Suspend tenant'} variant={suspended ? 'secondary' : 'destructive'} confirm={suspended ? undefined : `Suspend ${tenant.name}? Token issuance for this tenant will stop.`} inline>
            <Hidden name="id" value={tenant._id} />
            <Hidden name="name" value={tenant.name} />
            <Hidden name="status" value={suspended ? 'active' : 'suspended'} />
          </ActionForm>
        </CardContent>
      </Card>

      {/* --- Clients (service accounts) --- */}
      <Card>
        <CardHeader><CardTitle>Clients (service accounts)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <ActionForm action={createClient} submitLabel="Add client">
            <Hidden name="tenantId" value={tenant._id} />
            <Field name="name" label="Name" placeholder="my-service" required />
            <Field name="grantTypes" label="Grant types (comma)" placeholder="client_credentials" required />
            <Field name="scopes" label="Scopes (comma)" placeholder="admin" />
            <Field name="audience" label="Audience" placeholder="optional" />
            <Field name="subject" label="Subject (optional)" placeholder="machine sub" />
            <Field name="redirectUris" label="Redirect URIs (comma)" placeholder="optional" />
          </ActionForm>

          {clients === undefined ? <p className="text-sm text-destructive">Failed to load clients.</p> : (
            <Table>
              <THead><tr><th>Name</th><th>Client id</th><th>Grants</th><th>Scopes</th><th>Actions</th></tr></THead>
              <TBody>
                {clients.map((c) => (
                  <tr key={c._id}>
                    <td>{c.name}</td>
                    <td className="font-mono text-xs">{c._id}</td>
                    <td>{c.grantTypes?.join(', ')}</td>
                    <td>{c.scopes?.join(', ')}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <ActionForm action={rotateClientSecret} submitLabel="Rotate secret" variant="outline" inline>
                          <Hidden name="clientId" value={c._id} />
                          <Hidden name="tenantId" value={tenant._id} />
                        </ActionForm>
                        <ActionForm action={deleteClient} submitLabel="Delete" variant="destructive" confirm={`Delete client ${c.name}? Tokens it issued stop validating.`} inline>
                          <Hidden name="clientId" value={c._id} />
                          <Hidden name="tenantId" value={tenant._id} />
                        </ActionForm>
                      </div>
                    </td>
                  </tr>
                ))}
                {!clients.length && <tr><td colSpan={5} className="text-muted-foreground">No clients yet.</td></tr>}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* --- Users (human accounts) --- */}
      <Card>
        <CardHeader><CardTitle>Users (human accounts)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <ActionForm action={createUser} submitLabel="Add user">
            <Hidden name="tenantId" value={tenant._id} />
            <Field name="email" label="Email" type="email" placeholder="user@acme.com" required />
            <Field name="password" label="Temp password" type="password" required />
            <Field name="roles" label="Roles (comma)" placeholder="optional" />
          </ActionForm>

          {users === undefined ? <p className="text-sm text-destructive">Failed to load users.</p> : (
            <Table>
              <THead><tr><th>Email</th><th>Status</th><th>Roles</th><th>Actions</th></tr></THead>
              <TBody>
                {users.map((u) => {
                  const locked = !!u.lockedUntil && new Date(u.lockedUntil) > new Date();
                  return (
                    <tr key={u._id}>
                      <td>{u.email}</td>
                      <td>{u.status}{locked ? ' · locked' : ''}</td>
                      <td>{u.roles?.join(', ')}</td>
                      <td>
                        <div className="flex flex-wrap items-center gap-2">
                          <ActionForm action={resetPassword} submitLabel="Reset" variant="outline" inline>
                            <Hidden name="tenantId" value={tenant._id} />
                            <Hidden name="email" value={u.email} />
                            <Field name="password" label="" type="password" placeholder="new password" required />
                          </ActionForm>
                          <ActionForm action={setUserStatus} submitLabel={u.status === 'disabled' ? 'Enable' : 'Disable'} variant="outline" inline>
                            <Hidden name="tenantId" value={tenant._id} />
                            <Hidden name="email" value={u.email} />
                            <Hidden name="status" value={u.status === 'disabled' ? 'active' : 'disabled'} />
                          </ActionForm>
                          <ActionForm action={unlockUser} submitLabel="Unlock" variant="outline" inline>
                            <Hidden name="tenantId" value={tenant._id} />
                            <Hidden name="email" value={u.email} />
                          </ActionForm>
                          <ActionForm action={deleteUser} submitLabel="Delete" variant="destructive" confirm={`Delete ${u.email}?`} inline>
                            <Hidden name="tenantId" value={tenant._id} />
                            <Hidden name="email" value={u.email} />
                          </ActionForm>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!users.length && <tr><td colSpan={4} className="text-muted-foreground">No users yet.</td></tr>}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
