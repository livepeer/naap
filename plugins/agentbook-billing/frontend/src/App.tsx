import { AdminApp } from './admin/AdminApp';
import { UserApp } from './user/UserApp';

export function App({ route }: { route: string; user?: { id: string; email: string } }): JSX.Element {
  return route.startsWith('/admin/billing') ? <AdminApp /> : <UserApp />;
}
