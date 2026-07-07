import React from 'react';
import ReactDOM from 'react-dom/client';
import * as jsxRuntime from 'react/jsx-runtime';
import { App } from './App';
import './styles.css';

Object.assign(globalThis, {
  __CITADEL_REACT__: React,
  __CITADEL_REACT_JSX_RUNTIME__: jsxRuntime
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
