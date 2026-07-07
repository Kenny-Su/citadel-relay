const jsxRuntime = globalThis.__CITADEL_REACT_JSX_RUNTIME__;

if (!jsxRuntime) {
  throw new Error('Citadel React JSX runtime is not ready');
}

export const Fragment = jsxRuntime.Fragment;
export const jsx = jsxRuntime.jsx;
export const jsxs = jsxRuntime.jsxs;
export const jsxDEV = jsxRuntime.jsxDEV;
