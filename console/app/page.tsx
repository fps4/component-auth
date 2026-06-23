import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { VegaChart } from '@/components/vega-chart';
import { ActionForm } from '@/components/action-form';
import { rotateKey } from '@/app/actions';
import type { VisualizationSpec } from 'vega-embed';

export const dynamic = 'force-dynamic';

function Stat({ title, value, hint }: { title: string; value: number | string; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  let stats; let error: string | undefined;
  try { stats = await api.getStats(); } catch (e) { error = (e as Error).message; }

  if (error || !stats) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-destructive">Could not reach the management API: {error}</p>
        <p className="text-sm text-muted-foreground">Check ADMIN_API_URL / ADMIN_API_TOKEN in the console env.</p>
      </div>
    );
  }

  const tokenSpec: VisualizationSpec = {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    description: 'Access tokens issued',
    data: { values: [
      { window: 'last hour', count: stats.tokens.accessLastHour },
      { window: 'last 24h', count: stats.tokens.accessLastDay },
    ] },
    mark: { type: 'bar', cornerRadiusEnd: 4 },
    encoding: {
      x: { field: 'window', type: 'nominal', axis: { labelAngle: 0, title: null } },
      y: { field: 'count', type: 'quantitative', title: 'access tokens' },
      color: { value: '#3b82f6' },
    },
    width: 'container',
    height: 220,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <ActionForm action={rotateKey} submitLabel="Rotate signing key"><span /></ActionForm>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat title="Tenants" value={stats.tenants.total} hint={`${stats.tenants.active} active`} />
        <Stat title="Clients" value={stats.clients.total} />
        <Stat title="Users" value={stats.users.total} hint={`${stats.users.locked} locked · ${stats.users.disabled} disabled`} />
        <Stat title="Active signing keys" value={stats.keys.active} />
        <Stat title="Tokens (1h)" value={stats.tokens.accessLastHour} />
        <Stat title="Tokens (24h)" value={stats.tokens.accessLastDay} />
        <Stat title="Active refresh tokens" value={stats.tokens.activeRefresh} />
      </div>

      <Card>
        <CardHeader><CardTitle>Access token issuance</CardTitle></CardHeader>
        <CardContent><VegaChart spec={tokenSpec} /></CardContent>
      </Card>
    </div>
  );
}
