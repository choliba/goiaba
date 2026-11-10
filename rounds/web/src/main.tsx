import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { isRecordFile, loadRecords } from './data';
// oxlint-disable-next-line import/no-unassigned-import -- a stylesheet: its effect is the import.
import './theme.css';

const root = document.getElementById('root');
if (root === null) throw new Error('index.html sem o elemento #root.');

// The records first (rounds.json, from whoever serves the pages): every
// page is built from them.
const response = await fetch('./rounds.json');
if (!response.ok) {
  throw new Error(`rounds.json não veio (HTTP ${String(response.status)}).`);
}
const payload: unknown = await response.json();
if (!Array.isArray(payload)) throw new Error('rounds.json não é uma lista.');
loadRecords(payload.filter(isRecordFile));

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
