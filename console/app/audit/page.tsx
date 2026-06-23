import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, THead, TBody } from '@/components/ui/table';

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  let entries: Awaited<ReturnType<typeof api.recentAudit>> | undefined; let error: string | undefined;
  try { entries = await api.recentAudit(50); } catch (e) { error = (e as Error).message; }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Audit log</h1>
      <Card>
        <CardHeader><CardTitle>Recent management actions</CardTitle></CardHeader>
        <CardContent>
          {error ? <p className="text-sm text-destructive">{error}</p> : (
            <Table>
              <THead><tr><th>When</th><th>Action</th><th>Principal</th><th>Target</th><th>Status</th></tr></THead>
              <TBody>
                {entries?.map((e) => (
                  <tr key={e._id}>
                    <td className="text-xs">{new Date(e.at).toLocaleString()}</td>
                    <td className="font-mono text-xs">{e.action}</td>
                    <td className="font-mono text-xs">{e.principalClientId ?? '—'}</td>
                    <td className="font-mono text-xs">{e.targetId ?? '—'}</td>
                    <td>{e.status}</td>
                  </tr>
                ))}
                {!entries?.length && <tr><td colSpan={5} className="text-muted-foreground">No audit entries.</td></tr>}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
