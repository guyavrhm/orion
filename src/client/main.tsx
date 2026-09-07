import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import './index.css';

if (typeof window !== 'undefined') {
  if ('scrollRestoration' in window.history) {
    window.history.scrollRestoration = 'manual';
  }

  // Prevent browser focus-jumping / snapping on window activation after scrolling unfocused
  window.addEventListener('focus', () => {
    const currentY = window.scrollY;
    requestAnimationFrame(() => {
      if (window.scrollY !== currentY) {
        window.scrollTo({ top: currentY, behavior: 'instant' });
      }
    });
  });
}

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
