import { lazy, Suspense } from 'react';

const AdminApp = lazy(() => import('./admin/AdminApp').then(m => ({ default: m.AdminApp })));
const UserApp = lazy(() => import('./user/UserApp').then(m => ({ default: m.UserApp })));

export function App({ route }: { route: string; user?: { id: string; email: string } }): JSX.Element {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-500">Loading…</div>}>
      {route.startsWith('/admin/billing') ? <AdminApp /> : <UserApp />}
    </Suspense>
  );
}
