import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
// oxlint-disable-next-line import/no-unassigned-import -- a stylesheet: its effect is the import.
import './theme.css';

const root = document.getElementById('root');
if (root === null) throw new Error('index.html sem o elemento #root.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
