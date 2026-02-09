import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { ShellContext, WorkflowManifest } from '@naap/types';
import { DeveloperView } from './pages/DeveloperView';
import './globals.css';

// Store for shell context (accessible to components)
let shellContext: ShellContext | null = null;

export const getShellContext = () => shellContext;

// Workflow manifest for shell integration
export const manifest: WorkflowManifest = {
  name: 'developer-api',
  version: '0.0.1',
  routes: ['/developers', '/developers/*'],
  
  mount(container: HTMLElement, context: ShellContext) {
    shellContext = context;
    
    const root = ReactDOM.createRoot(container);
    root.render(
      <React.StrictMode>
        <MemoryRouter>
          <Routes>
            <Route path="/*" element={<DeveloperView />} />
          </Routes>
        </MemoryRouter>
      </React.StrictMode>
    );
    
    // Return cleanup function
    return () => {
      root.unmount();
      shellContext = null;
    };
  },
};

// Export mount function for UMD/CDN plugin loading
export const mount = manifest.mount;
export default manifest;
