import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startAnalytics } from './analytics';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

startAnalytics();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
