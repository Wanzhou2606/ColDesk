import React from 'react';
import ReactDOM from 'react-dom/client';

import { ToastWindow } from './windows/ToastWindow';
import './styles/glass.css';
import './styles/widget.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ToastWindow />
  </React.StrictMode>
);
