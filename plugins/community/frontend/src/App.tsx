import React, { useEffect } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createPlugin, useUser } from '@naap/plugin-sdk';
import { ForumPage } from './pages/Forum';
import { PostDetailPage } from './pages/PostDetail';
import { setCurrentUser } from './api/client';
import './globals.css';

/**
 * Sync shell auth user into the module-level API client state.
 * Uses the SDK's useUser() hook which reactively subscribes to
 * auth.onAuthStateChange(), so it re-renders when the user logs in/out.
 */
const UserSync: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const user = useUser();

  useEffect(() => {
    if (user) {
      setCurrentUser({
        userId: user.id || 'anonymous',
        displayName: user.displayName || user.address?.slice(0, 10) || 'Anonymous',
      });
    } else {
      setCurrentUser(null);
    }
  }, [user]);

  return <>{children}</>;
};

const CommunityApp: React.FC = () => (
  <UserSync>
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<ForumPage />} />
        <Route path="/post/:id" element={<PostDetailPage />} />
        <Route path="/*" element={<ForumPage />} />
      </Routes>
    </MemoryRouter>
  </UserSync>
);

const plugin = createPlugin({
  name: 'community',
  version: '1.2.0',
  routes: ['/forum', '/forum/*'],
  App: CommunityApp,
});

/** @deprecated Use SDK hooks (useShell, useApiClient, etc.) instead */
export const getShellContext = plugin.getContext;

export const manifest = plugin;
export const mount = plugin.mount;
export default plugin;
