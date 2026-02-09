'use client';

import { RequireAuth } from '@/contexts/auth-context';
import { AppLayout } from '@/components/layout/app-layout';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RequireAuth>
      <AppLayout>{children}</AppLayout>
    </RequireAuth>
  );
}
