import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary:   { main: '#7c2d12' },   // warm primary tone
    secondary: { main: '#d4a373' },
  },
  shape: { borderRadius: 12 },
  typography: { fontFamily: 'Roboto, system-ui, sans-serif' },
  components: {
    MuiButton: { defaultProps: { variant: 'contained', size: 'medium' } },
    MuiTextField: { defaultProps: { variant: 'outlined', size: 'small', fullWidth: true } },
  },
});
