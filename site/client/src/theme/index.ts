import { createTheme, type PaletteMode } from '@mui/material/styles';

// Tokens de cor e forma ficam só aqui. Componentes usam theme.palette.* ou sx,
// nunca valores hex fixos.
export function createAppTheme(mode: PaletteMode) {
  return createTheme({
    palette: {
      mode,
      primary: { main: mode === 'light' ? '#2e7d32' : '#81c784' },
      secondary: { main: mode === 'light' ? '#ef6c00' : '#ffb74d' },
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    },
  });
}
