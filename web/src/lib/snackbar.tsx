import { createContext, ReactNode, useCallback, useContext, useState } from 'react';
import { Alert, Button, Snackbar } from '@mui/material';

type Severity = 'error' | 'success' | 'info' | 'warning';

interface SnackbarAction {
  label: string;
  onClick: () => void;
}

interface SnackbarMessage {
  message: string;
  severity: Severity;
  action?: SnackbarAction;
}

interface SnackbarOptions {
  action?: SnackbarAction;
}

interface SnackbarCtx {
  show: (message: string, severity?: Severity, options?: SnackbarOptions) => void;
}

const Ctx = createContext<SnackbarCtx | null>(null);

export function useSnackbar(): SnackbarCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSnackbar must be used within <SnackbarProvider>');
  return ctx;
}

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<SnackbarMessage | null>(null);
  const show = useCallback(
    (message: string, severity: Severity = 'info', options?: SnackbarOptions) => {
      setCurrent({ message, severity, action: options?.action });
    },
    [],
  );
  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <Snackbar
        open={!!current}
        autoHideDuration={6000}
        onClose={() => setCurrent(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {current ? (
          <Alert
            severity={current.severity}
            variant="filled"
            onClose={() => setCurrent(null)}
            sx={{ width: '100%' }}
            action={current.action ? (
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  current.action?.onClick();
                  setCurrent(null);
                }}
              >
                {current.action.label}
              </Button>
            ) : undefined}
          >
            {current.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Ctx.Provider>
  );
}
