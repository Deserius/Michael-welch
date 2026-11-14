import { createContext } from 'react';

export type ToastType = 'success' | 'error' | 'info';

/** Declared separately so ToastContext.tsx only exports components. */
export const ToastContext = createContext<{
  toast: (message: string, type?: ToastType) => void;
}>({
  toast: () => {},
});
