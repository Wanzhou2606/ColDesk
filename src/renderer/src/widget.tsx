import React from 'react';
import ReactDOM from 'react-dom/client';

import { WidgetWindow } from './windows/WidgetWindow';
import './styles/glass.css';
import './styles/widget.css';
import './styles/widget-glass.css';
import './styles/task-actions.css';
import './styles/island.css';
import './styles/course-cards.css';
import './styles/task-preview-colors.css';
import './styles/task-hover.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <WidgetWindow />
  </React.StrictMode>
);
