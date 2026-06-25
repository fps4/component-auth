'use client';

// The authenticated console chrome (RQ-0007). On /login we render the bare page (the
// login screen owns the full viewport); everywhere else we render the sidebar nav + a
// slim top bar carrying the operator UserMenu. Kept client-side so it can branch on the
// current path without splitting the route tree.

import { usePathname } from 'next/navigation';

import { Nav } from '@/components/nav';
import { UserMenu } from '@/components/auth/user-menu';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === '/login') return <>{children}</>;

  return (
    <div className="grid min-h-screen grid-cols-[240px_1fr]">
      <aside className="border-r bg-card">
        <Nav />
      </aside>
      <div className="flex min-h-screen flex-col">
        <header className="flex h-14 items-center justify-end border-b px-6">
          <UserMenu />
        </header>
        <main className="flex-1 overflow-auto p-8">{children}</main>
      </div>
    </div>
  );
}
