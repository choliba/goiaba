import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  CssBaseline,
  ThemeProvider,
  useMediaQuery,
  type PaletteMode,
} from '@mui/material';
import { createAppTheme } from './index';

const STORAGE_KEY = 'color-mode';

type ColorModeContextValue = {
  mode: PaletteMode;
  toggleMode: () => void;
};

const ColorModeContext = createContext<ColorModeContextValue | null>(null);

function readStoredMode(): PaletteMode | null {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : null;
}

export function ColorModeProvider({ children }: { children: ReactNode }) {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const [override, setOverride] = useState<PaletteMode | null>(readStoredMode);

  // Sem escolha salva, segue a preferência do sistema.
  const mode: PaletteMode = override ?? (prefersDark ? 'dark' : 'light');

  const value = useMemo<ColorModeContextValue>(
    () => ({
      mode,
      toggleMode: () => {
        const next: PaletteMode = mode === 'light' ? 'dark' : 'light';
        localStorage.setItem(STORAGE_KEY, next);
        setOverride(next);
      },
    }),
    [mode],
  );

  const theme = useMemo(() => createAppTheme(mode), [mode]);

  return (
    <ColorModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ColorModeContext.Provider>
  );
}

export function useColorMode(): ColorModeContextValue {
  const ctx = useContext(ColorModeContext);
  if (!ctx)
    throw new Error('useColorMode precisa estar dentro de ColorModeProvider');
  return ctx;
}
