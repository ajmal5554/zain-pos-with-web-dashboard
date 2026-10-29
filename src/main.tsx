import './lib/uuid'; // Guarantee crypto.randomUUID polyfill on non-secure LAN/HTTP contexts
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import './index.css';
import { initBrowserBridge } from './lib/browserBridge';

// Polyfill window.electronAPI if running in a regular web browser (e.g. previewing from another computer)
initBrowserBridge();

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ErrorBoundary>
            <App />
        </ErrorBoundary>
    </React.StrictMode>
);
