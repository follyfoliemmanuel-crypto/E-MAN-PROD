import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './style.css';
import { registerServiceWorker } from './lib/push.js';

registerServiceWorker();

createRoot(document.getElementById('root')).render(<App />);
