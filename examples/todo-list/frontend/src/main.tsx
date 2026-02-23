/**
 * Standalone Development Entry Point
 *
 * Used for independent development outside the NAAP shell.
 * Run: npm run dev
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { TodoList } from './pages/TodoList';
import './globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MemoryRouter>
      <Routes>
        <Route path="/*" element={<TodoList />} />
      </Routes>
    </MemoryRouter>
  </React.StrictMode>
);
