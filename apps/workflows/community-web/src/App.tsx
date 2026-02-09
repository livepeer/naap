import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { ShellContext, WorkflowManifest } from '@naap/types';
import { ForumPage } from './pages/Forum';
import './globals.css';

let shellContext: ShellContext | null = null;
export const getShellContext = () => shellContext;

export const manifest: WorkflowManifest = {
  name: 'community', version: '0.0.1', routes: ['/forum', '/forum/*'],
  mount(container: HTMLElement, context: ShellContext) {
    shellContext = context;
    const root = ReactDOM.createRoot(container);
    root.render(<React.StrictMode><MemoryRouter><Routes><Route path="/*" element={<ForumPage />} /></Routes></MemoryRouter></React.StrictMode>);
    return () => { root.unmount(); shellContext = null; };
  },
};

export const mount = manifest.mount;
export default manifest;
