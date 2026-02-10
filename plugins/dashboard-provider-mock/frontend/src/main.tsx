/**
 * Standalone dev entry point.
 * Only used during local development (npm run dev).
 */

import React from 'react';
import ReactDOM from 'react-dom/client';

const DevApp: React.FC = () => (
  <div style={{ padding: 40, fontFamily: 'sans-serif' }}>
    <h1>Dashboard Provider Mock</h1>
    <p>This is a headless plugin — it provides data to the dashboard via the event bus.</p>
    <p>No UI to display here. Run the main app and navigate to <code>/dashboard</code> to see the data.</p>
  </div>
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DevApp />
  </React.StrictMode>
);
