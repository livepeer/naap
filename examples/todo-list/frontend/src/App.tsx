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
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createPlugin } from '@naap/plugin-sdk';
import { TodoList } from './pages/TodoList';
import './globals.css';

const TodoListApp: React.FC = () => (
  <MemoryRouter>
    <Routes>
      <Route path="/*" element={<TodoList />} />
    </Routes>
  </MemoryRouter>
);

const plugin = createPlugin({
  name: 'todo-list',
  version: '1.0.0',
  routes: ['/todos', '/todos/*'],
  App: TodoListApp,
});

export const mount = plugin.mount;
export default plugin;
