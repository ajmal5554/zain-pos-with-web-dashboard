import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Prevent pinch-to-zoom and multi-touch gestures on mobile PWA
if (typeof window !== 'undefined') {
  // Prevent multi-touch pinch zoom
  document.addEventListener('touchmove', (event) => {
    if (event.touches.length > 1) {
      event.preventDefault();
    }
  }, { passive: false });

  // Prevent iOS gesture zoom
  document.addEventListener('gesturestart', (event: any) => {
    event.preventDefault();
  });

  // Prevent double-tap zoom on non-interactive elements
  let lastTouchTime = 0;
  document.addEventListener('touchend', (event) => {
    const now = Date.now();
    if (now - lastTouchTime <= 300) {
      const target = event.target as HTMLElement | null;
      if (target && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName)) {
        event.preventDefault();
      }
    }
    lastTouchTime = now;
  }, { passive: false });
}

const rootElement = document.getElementById('root');

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(<App />);
}
