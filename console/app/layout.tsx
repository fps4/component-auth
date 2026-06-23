import type { Metadata } from 'next';
import './globals.css';
import { Nav } from '@/components/nav';
import { Toaster } from 'sonner';

export const metadata: Metadata = {
  title: 'identity-service · admin console',
  description: 'Operator console for the identity-service management plane (ADR-0007).',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <div className="grid min-h-screen grid-cols-[240px_1fr]">
          <aside className="border-r bg-card">
            <Nav />
          </aside>
          <main className="overflow-auto p-8">{children}</main>
        </div>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
