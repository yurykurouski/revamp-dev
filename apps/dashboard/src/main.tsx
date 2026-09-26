import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n/index.js';
import App from './App.js';

const rootElement = document.getElementById('root');

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
