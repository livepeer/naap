/**
 * Todo List Plugin
 * 
 * A full-stack example demonstrating:
 * - CRUD operations with backend API using useApiClient
 * - Authentication via useAuthService
 * - Notifications via useNotify
 * - Navigation via useNavigate
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { ShellContext, PluginModule } from '@naap/plugin-sdk';
import { ShellProvider } from '@naap/plugin-sdk';
import { TodoList } from './pages/TodoList';
import './globals.css';

// Store shell context for mount function
let shellContext: ShellContext | null = null;

// Manifest for shell to load this plugin
export const manifest: PluginModule & { name: string; version: string; routes: string[] } = {
  name: 'todoList',
  version: '1.0.0',
  routes: ['/todos', '/todos/*'],
  mount(container: HTMLElement, context: ShellContext) {
    shellContext = context;
    const root = ReactDOM.createRoot(container);
    root.render(
      <React.StrictMode>
        {/* Wrap with ShellProvider to enable SDK hooks */}
        <ShellProvider value={context}>
          <MemoryRouter>
            <Routes>
              <Route path="/*" element={<TodoList />} />
            </Routes>
          </MemoryRouter>
        </ShellProvider>
      </React.StrictMode>
    );
    return () => {
      root.unmount();
      shellContext = null;
    };
  },
};

export const mount = manifest.mount;
export default manifest;
