import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { ShellContext, WorkflowManifest } from '@naap/types';
import { OrchestratorsPage } from './pages/Orchestrators';
import './globals.css';

let shellContext: ShellContext | null = null;
export const getShellContext = () => shellContext;

export const manifest: WorkflowManifest = {
  name: 'orchestrator-manager',
  version: '0.0.1',
  routes: ['/orchestrators', '/orchestrators/*'],
  mount(container: HTMLElement, context: ShellContext) {
    shellContext = context;
    const root = ReactDOM.createRoot(container);
    root.render(
      <React.StrictMode>
        <MemoryRouter><Routes><Route path="/*" element={<OrchestratorsPage />} /></Routes></MemoryRouter>
      </React.StrictMode>
    );
    return () => { root.unmount(); shellContext = null; };
  },
};

export const mount = manifest.mount;
export default manifest;
