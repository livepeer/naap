import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { ShellContext, WorkflowManifest } from '@naap/types';
import { GatewaysPage } from './pages/Gateways';
import './globals.css';

// Store for shell context (accessible to components)
let shellContext: ShellContext | null = null;

export const getShellContext = () => shellContext;

// Workflow manifest for shell integration
export const manifest: WorkflowManifest = {
  name: 'gateway-manager',
  version: '0.0.1',
  routes: ['/gateways', '/gateways/*'],
  
  mount(container: HTMLElement, context: ShellContext) {
    shellContext = context;
    
    const root = ReactDOM.createRoot(container);
    root.render(
      <React.StrictMode>
        <MemoryRouter>
          <Routes>
            <Route path="/*" element={<GatewaysPage />} />
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
