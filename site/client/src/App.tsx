import { useEffect, useState, type MouseEvent } from 'react';
import {
  AppBar,
  Avatar,
  Box,
  Breadcrumbs,
  Button,
  Chip,
  CssBaseline,
  Container,
  Divider,
  Drawer,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Link as MuiLink,
  Paper,
  Stack,
  SvgIcon,
  TextField,
  Toolbar,
  Typography,
  useMediaQuery,
  type SvgIconProps,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useColorMode } from './theme/ColorModeProvider';

const drawerWidth = 280;

function useCurrentPath() {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const updatePath = () => setPath(window.location.pathname);
    window.addEventListener('popstate', updatePath);
    return () => window.removeEventListener('popstate', updatePath);
  }, []);

  return path;
}

function navigateTo(path: string) {
  if (window.location.pathname === path) return;
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function handleRouteLink(event: MouseEvent<HTMLAnchorElement>, path: string) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  event.preventDefault();
  navigateTo(path);
}

function HomePage({
  mode,
  toggleMode,
}: {
  mode: string;
  toggleMode: () => void;
}) {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: 'background.default',
        color: 'text.primary',
      }}
    >
      <AppBar
        position="static"
        color="inherit"
        elevation={0}
        sx={{
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Toolbar
          sx={{
            maxWidth: 1200,
            width: '100%',
            mx: 'auto',
            px: { xs: 2, sm: 3 },
          }}
        >
          <Stack
            direction="row"
            alignItems="center"
            spacing={1.2}
            sx={{ flex: 1 }}
          >
            <Box
              sx={{
                width: 34,
                height: 34,
                display: 'grid',
                placeItems: 'center',
                borderRadius: 2,
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                fontWeight: 800,
              }}
            >
              S
            </Box>
            <Typography fontWeight={750}>Sitemark</Typography>
          </Stack>
          <IconButton
            onClick={toggleMode}
            aria-label={
              mode === 'light' ? 'Ativar modo escuro' : 'Ativar modo claro'
            }
          >
            <Icon name={mode === 'light' ? 'moon' : 'sun'} fontSize="small" />
          </IconButton>
          <Button
            href="/dashboard"
            onClick={(event) => handleRouteLink(event, '/dashboard')}
            variant="contained"
            sx={{
              ml: 1.5,
              borderRadius: 2,
              textTransform: 'none',
              fontWeight: 650,
            }}
          >
            Abrir dashboard
          </Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: { xs: 9, md: 15 } }}>
        <Box sx={{ maxWidth: 640 }}>
          <Chip
            label="Seu espaço de trabalho"
            color="primary"
            variant="outlined"
            sx={{ mb: 2.5, fontWeight: 600 }}
          />
          <Typography
            variant="h2"
            component="h1"
            fontWeight={760}
            sx={{
              fontSize: { xs: '2.6rem', md: '4rem' },
              letterSpacing: '-.055em',
              lineHeight: 1.08,
            }}
          >
            Tudo em um só lugar.
          </Typography>
          <Typography
            variant="h6"
            color="text.secondary"
            fontWeight={400}
            sx={{ mt: 2, maxWidth: 530, lineHeight: 1.65 }}
          >
            Acesse seus indicadores e acompanhe o que acontece no seu negócio.
          </Typography>
          <Button
            href="/dashboard"
            onClick={(event) => handleRouteLink(event, '/dashboard')}
            variant="contained"
            size="large"
            sx={{
              mt: 4,
              px: 3,
              py: 1.25,
              borderRadius: 2,
              textTransform: 'none',
              fontWeight: 650,
            }}
          >
            Ir para o dashboard
          </Button>
        </Box>
      </Container>
    </Box>
  );
}

const iconPaths: Record<string, string> = {
  grid: 'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z',
  chart:
    'M3 3h2v16h16v2H3V3zm4 10 4-4 4 3 5-7 1.6 1.2-6.2 8.7-4.1-3.1-2.9 2.9L7 13z',
  people:
    'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 .17c-.29 0-.62.02-.97.05 1.16.84 1.97 1.98 1.97 3.28V19h7v-2.5c0-2.33-4.67-3.33-8-3.33z',
  task: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14-4-4 1.41-1.41L10 14.17l6.59-6.58L18 9l-8 8z',
  settings:
    'M19.14 12.94c.04-.31.06-.62.06-.94s-.02-.63-.07-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.3 7.3 0 0 0-1.63-.95l-.36-2.54A.49.49 0 0 0 13.88 2h-3.76a.49.49 0 0 0-.49.42L9.27 4.96c-.6.24-1.15.56-1.64.95l-2.38-.96a.5.5 0 0 0-.61.22L2.72 8.49a.5.5 0 0 0 .12.64l2.02 1.58c-.04.31-.07.63-.07.95s.02.63.07.94l-2.02 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.12.21.37.3.61.22l2.38-.96c.5.39 1.04.71 1.64.95l.36 2.54c.04.24.24.42.49.42h3.76c.25 0 .45-.18.49-.42l.36-2.54c.6-.24 1.15-.56 1.64-.95l2.38.96c.23.09.49-.01.61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.02-1.58zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z',
  search:
    'M15.5 14h-.79l-.28-.27A6.5 6.5 0 1 0 14 15.5l.27.28v.79l5 4.99L20.49 20l-4.99-5zm-5 0A4.5 4.5 0 1 1 10.5 5a4.5 4.5 0 0 1 0 9z',
  menu: 'M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z',
  sun: 'M6.76 4.84 5.35 3.43 3.93 4.84l1.41 1.41 1.42-1.41zM1 13h3v-2H1v2zm10 9h2v-3h-2v3zm8-9h3v-2h-3v2zm-8-19v3h2V-6h-2zm7.07 4.43-1.41 1.41 1.41 1.42 1.42-1.42-1.42-1.41zM17 19.07l1.41 1.42 1.42-1.42-1.42-1.41L17 19.07zM5.35 20.49l1.41-1.42-1.42-1.41-1.41 1.41 1.42 1.42zM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  moon: 'M9.37 5.51A7 7 0 0 0 18.49 14.6 8 8 0 1 1 9.37 5.5z',
  bell: 'M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6v-5a6 6 0 0 0-5-5.91V4a1 1 0 0 0-2 0v1.09A6 6 0 0 0 6 11v5l-2 2v1h16v-1l-2-2z',
  download: 'M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z',
  arrow: 'M7 10l5 5 5-5z',
};

// Aceita tudo que o SvgIcon aceita (fontSize, color, sx...).
function Icon({
  name,
  ...props
}: { name: keyof typeof iconPaths } & SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path d={iconPaths[name]} />
    </SvgIcon>
  );
}

const navItems = [
  { label: 'Dashboard', icon: 'grid' as const },
  { label: 'Análises', icon: 'chart' as const },
  { label: 'Clientes', icon: 'people' as const },
  { label: 'Tarefas', icon: 'task' as const },
];

const sessions = [
  34, 42, 38, 50, 45, 56, 48, 61, 54, 66, 57, 72, 63, 78, 68, 82, 71, 88, 76,
  92, 80, 97, 85, 100, 88, 94, 79, 91, 84, 98,
];

function LineChart() {
  const points = sessions
    .map((value, index) => `${index * 20},${120 - value}`)
    .join(' ');

  return (
    <Box sx={{ width: '100%', height: 220, mt: 2 }}>
      <svg
        viewBox="0 0 580 130"
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        role="img"
        aria-label="Gráfico de sessões nos últimos 30 dias"
      >
        {[25, 55, 85, 115].map((y) => (
          <line
            key={y}
            x1="0"
            y1={y}
            x2="580"
            y2={y}
            stroke="currentColor"
            strokeOpacity=".08"
            strokeDasharray="4 6"
          />
        ))}
        <defs>
          <linearGradient id="sessions-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#2e7d32" stopOpacity=".2" />
            <stop offset="100%" stopColor="#2e7d32" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon
          points={`0,130 ${points} 580,130`}
          fill="url(#sessions-fill)"
        />
        <polyline
          points={points}
          fill="none"
          stroke="#2e7d32"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx="580"
          cy={120 - sessions[sessions.length - 1]}
          r="4.5"
          fill="#fff"
          stroke="#2e7d32"
          strokeWidth="3"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <Stack
        direction="row"
        justifyContent="space-between"
        sx={{ mt: 1, color: 'text.secondary' }}
      >
        {[
          '1 jun',
          '6 jun',
          '11 jun',
          '16 jun',
          '21 jun',
          '26 jun',
          '30 jun',
        ].map((day) => (
          <Typography key={day} variant="caption">
            {day}
          </Typography>
        ))}
      </Stack>
    </Box>
  );
}

function MetricCard({
  title,
  value,
  change,
  positive,
}: {
  title: string;
  value: string;
  change: string;
  positive: boolean;
}) {
  const theme = useTheme();
  const color = positive
    ? theme.palette.success.main
    : theme.palette.error.main;

  return (
    <Paper
      variant="outlined"
      sx={{ p: 2.5, borderColor: 'divider', borderRadius: 3, minHeight: 142 }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography color="text.secondary" variant="body2" fontWeight={600}>
          {title}
        </Typography>
        <Chip
          size="small"
          label={`${positive ? '+' : ''}${change}`}
          sx={{
            height: 24,
            fontWeight: 700,
            color,
            bgcolor: alpha(color, 0.1),
          }}
        />
      </Stack>
      <Typography
        variant="h4"
        fontWeight={700}
        sx={{ mt: 2, letterSpacing: '-.04em' }}
      >
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        em relação aos últimos 30 dias
      </Typography>
    </Paper>
  );
}

function DashboardContent() {
  const theme = useTheme();

  return (
    <Stack spacing={3} sx={{ minWidth: 0, maxWidth: '100%' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        gap={2}
      >
        <Box>
          <Breadcrumbs aria-label="caminho" sx={{ mb: 1 }}>
            <MuiLink
              component="a"
              href="/"
              onClick={(event) => handleRouteLink(event, '/')}
              underline="hover"
              color="text.secondary"
              variant="caption"
            >
              Início
            </MuiLink>
            <Typography variant="caption" color="text.primary">
              Dashboard
            </Typography>
          </Breadcrumbs>
          <Typography
            variant="h4"
            fontWeight={750}
            sx={{ letterSpacing: '-.04em' }}
          >
            Visão geral
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Acompanhe o desempenho do seu negócio.
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<Icon name="download" />}
          sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 650 }}
        >
          Exportar relatório
        </Button>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, 1fr)',
            xl: 'repeat(4, 1fr)',
          },
          gap: 2,
        }}
      >
        <MetricCard
          title="Usuários ativos"
          value="14.2 mil"
          change="25%"
          positive
        />
        <MetricCard title="Conversões" value="1.284" change="12%" positive />
        <MetricCard title="Receita" value="R$ 48,2 mil" change="8%" positive />
        <MetricCard
          title="Taxa de rejeição"
          value="24,8%"
          change="3%"
          positive={false}
        />
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            lg: 'minmax(0, 1.8fr) minmax(270px, 1fr)',
          },
          gap: 2,
        }}
      >
        <Paper
          variant="outlined"
          sx={{
            minWidth: 0,
            borderRadius: 3,
            p: { xs: 2, sm: 3 },
            borderColor: 'divider',
          }}
        >
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', sm: 'center' }}
            gap={1}
          >
            <Box>
              <Typography variant="h6" fontWeight={700}>
                Sessões
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Acessos diários nos últimos 30 dias
              </Typography>
            </Box>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="h5" fontWeight={750}>
                13.277
              </Typography>
              <Chip
                size="small"
                label="↑ 35%"
                sx={{
                  bgcolor: alpha(theme.palette.success.main, 0.1),
                  color: 'success.main',
                  fontWeight: 700,
                }}
              />
            </Stack>
          </Stack>
          <LineChart />
        </Paper>

        <Paper
          variant="outlined"
          sx={{ minWidth: 0, borderRadius: 3, p: 3, borderColor: 'divider' }}
        >
          <Typography variant="h6" fontWeight={700}>
            Usuários por país
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Distribuição da audiência
          </Typography>
          <Stack spacing={2.4} sx={{ mt: 3 }}>
            {[
              ['Brasil', '48%', 48],
              ['Estados Unidos', '26%', 26],
              ['Portugal', '16%', 16],
              ['Outros', '10%', 10],
            ].map(([country, percentage, value]) => (
              <Box key={country as string}>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  sx={{ mb: 0.8 }}
                >
                  <Typography variant="body2" fontWeight={550}>
                    {country}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {percentage}
                  </Typography>
                </Stack>
                <Box
                  sx={{
                    height: 7,
                    borderRadius: 5,
                    bgcolor: 'action.hover',
                    overflow: 'hidden',
                  }}
                >
                  <Box
                    sx={{
                      height: '100%',
                      width: `${value}%`,
                      borderRadius: 5,
                      bgcolor: 'primary.main',
                    }}
                  />
                </Box>
              </Box>
            ))}
          </Stack>
          <Divider sx={{ my: 2.5 }} />
          <Button
            fullWidth
            variant="text"
            endIcon={<Icon name="arrow" />}
            sx={{ textTransform: 'none', fontWeight: 650 }}
          >
            Ver relatório completo
          </Button>
        </Paper>
      </Box>

      <Paper
        variant="outlined"
        sx={{ borderRadius: 3, p: { xs: 2, sm: 3 }, borderColor: 'divider' }}
      >
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          sx={{ mb: 2.5 }}
        >
          <Box>
            <Typography variant="h6" fontWeight={700}>
              Atividade recente
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Principais eventos da sua conta
            </Typography>
          </Box>
          <Button size="small" sx={{ textTransform: 'none', fontWeight: 650 }}>
            Ver tudo
          </Button>
        </Stack>
        <Box sx={{ minWidth: 0, maxWidth: '100%', overflowX: 'auto' }}>
          <Box
            component="table"
            sx={{
              width: '100%',
              borderCollapse: 'collapse',
              minWidth: 560,
              '& th': {
                textAlign: 'left',
                color: 'text.secondary',
                fontSize: 12,
                fontWeight: 650,
                pb: 1.5,
              },
              '& td': {
                py: 1.5,
                borderTop: 1,
                borderColor: 'divider',
                fontSize: 14,
              },
            }}
          >
            <thead>
              <tr>
                <th>CLIENTE</th>
                <th>EVENTO</th>
                <th>DATA</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {[
                [
                  'Mariana Costa',
                  'Assinatura iniciada',
                  'Hoje, 10:42',
                  'Concluído',
                ],
                [
                  'Lucas Oliveira',
                  'Compra realizada',
                  'Hoje, 09:18',
                  'Concluído',
                ],
                ['Ana Ferreira', 'Cadastro criado', 'Ontem, 17:56', 'Pendente'],
              ].map(([name, event, date, status], index) => (
                <tr key={name}>
                  <td>
                    <Stack direction="row" alignItems="center" spacing={1.2}>
                      <Avatar
                        sx={{
                          width: 30,
                          height: 30,
                          fontSize: 12,
                          bgcolor: ['#e8f5e9', '#e3f2fd', '#fff3e0'][index],
                          color: ['#2e7d32', '#1565c0', '#ed6c02'][index],
                        }}
                      >
                        {name
                          .split(' ')
                          .map((part) => part[0])
                          .join('')}
                      </Avatar>
                      <Typography variant="body2" fontWeight={600}>
                        {name}
                      </Typography>
                    </Stack>
                  </td>
                  <td>{event}</td>
                  <td style={{ color: theme.palette.text.secondary }}>
                    {date}
                  </td>
                  <td>
                    <Chip
                      size="small"
                      label={status}
                      color={status === 'Concluído' ? 'success' : 'warning'}
                      variant="outlined"
                      sx={{
                        border: 0,
                        bgcolor: alpha(
                          status === 'Concluído'
                            ? theme.palette.success.main
                            : theme.palette.warning.main,
                          0.1,
                        ),
                        fontWeight: 650,
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </Box>
        </Box>
      </Paper>
      <Typography
        variant="caption"
        color="text.secondary"
        textAlign="center"
        sx={{ pb: 1 }}
      >
        © 2026 Workspace · Feito para ajudar você a crescer.
      </Typography>
    </Stack>
  );
}

export function App() {
  const { mode, toggleMode } = useColorMode();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('lg'));
  const pathname = useCurrentPath();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeItem, setActiveItem] = useState('Dashboard');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (pathname !== '/dashboard') return;
    fetch('/api')
      .then((res) => res.text())
      .then(setMessage)
      .catch(() => setMessage('API conectada'));
  }, [pathname]);

  if (pathname !== '/dashboard')
    return <HomePage mode={mode} toggleMode={toggleMode} />;

  const sidebar = (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        px: 2,
        py: 2.5,
      }}
    >
      <Stack
        component="a"
        href="/"
        onClick={(event) => handleRouteLink(event, '/')}
        direction="row"
        alignItems="center"
        spacing={1.2}
        sx={{ px: 1, mb: 3, color: 'inherit', textDecoration: 'none' }}
      >
        <Box
          sx={{
            width: 34,
            height: 34,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 2,
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            fontSize: 18,
            fontWeight: 800,
          }}
        >
          S
        </Box>
        <Box>
          <Typography fontWeight={750} lineHeight={1.1}>
            Sitemark
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Workspace
          </Typography>
        </Box>
      </Stack>
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ px: 1, mb: 1, fontWeight: 700, letterSpacing: '.08em' }}
      >
        MENU
      </Typography>
      <List disablePadding sx={{ display: 'grid', gap: 0.5 }}>
        {navItems.map((item) => (
          <ListItemButton
            key={item.label}
            selected={activeItem === item.label}
            onClick={() => {
              setActiveItem(item.label);
              if (isMobile) setMobileOpen(false);
            }}
            sx={{
              minHeight: 44,
              borderRadius: 2,
              '&.Mui-selected': {
                bgcolor: alpha(theme.palette.primary.main, 0.1),
                color: 'primary.main',
                '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.15) },
              },
            }}
          >
            <ListItemIcon
              sx={{
                minWidth: 38,
                color:
                  activeItem === item.label ? 'primary.main' : 'text.secondary',
              }}
            >
              <Icon name={item.icon} fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary={item.label}
              primaryTypographyProps={{
                fontSize: 14,
                fontWeight: activeItem === item.label ? 650 : 500,
              }}
            />
          </ListItemButton>
        ))}
      </List>
      <Divider sx={{ my: 2 }} />
      <List disablePadding>
        <ListItemButton
          onClick={() => setActiveItem('Configurações')}
          selected={activeItem === 'Configurações'}
          sx={{ minHeight: 44, borderRadius: 2 }}
        >
          <ListItemIcon sx={{ minWidth: 38, color: 'text.secondary' }}>
            <Icon name="settings" fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary="Configurações"
            primaryTypographyProps={{ fontSize: 14 }}
          />
        </ListItemButton>
      </List>
      <Box
        sx={{ mt: 'auto', p: 2, borderRadius: 2.5, bgcolor: 'action.hover' }}
      >
        <Typography variant="body2" fontWeight={700}>
          Seu plano está ativo
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          display="block"
          sx={{ mt: 0.5, lineHeight: 1.5 }}
        >
          Aproveite todos os recursos disponíveis no seu workspace.
        </Typography>
        <Button
          size="small"
          sx={{ px: 0, mt: 1, textTransform: 'none', fontWeight: 700 }}
        >
          Gerenciar plano →
        </Button>
      </Box>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1.2}
        sx={{ pt: 2, mt: 2, borderTop: 1, borderColor: 'divider' }}
      >
        <Avatar
          sx={{
            width: 34,
            height: 34,
            bgcolor: 'secondary.main',
            fontSize: 13,
          }}
        >
          RC
        </Avatar>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" fontWeight={650} noWrap>
            Riley Carter
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            riley@email.com
          </Typography>
        </Box>
        <IconButton size="small" aria-label="Opções da conta">
          <Icon name="arrow" fontSize="small" />
        </IconButton>
      </Stack>
    </Box>
  );

  return (
    <Box
      sx={{
        display: 'flex',
        width: '100%',
        maxWidth: '100%',
        minHeight: '100vh',
        overflowX: 'hidden',
        bgcolor: 'background.default',
      }}
    >
      <CssBaseline />
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{
          left: { lg: drawerWidth },
          width: { lg: `calc(100% - ${drawerWidth}px)` },
          boxSizing: 'border-box',
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: alpha(theme.palette.background.default, 0.88),
          backdropFilter: 'blur(12px)',
        }}
      >
        <Toolbar
          sx={{
            minWidth: 0,
            minHeight: '68px !important',
            gap: { xs: 0.75, sm: 1.5 },
            px: { xs: 1.5, md: 3 },
          }}
        >
          {isMobile && (
            <IconButton
              sx={{ flexShrink: 0 }}
              edge="start"
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir menu"
            >
              <Icon name="menu" />
            </IconButton>
          )}
          <TextField
            size="small"
            placeholder="Buscar"
            variant="outlined"
            sx={{
              flex: '1 1 220px',
              minWidth: 0,
              maxWidth: 300,
              width: 300,
              '& .MuiOutlinedInput-root': {
                borderRadius: 2,
                bgcolor: 'background.paper',
              },
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Icon name="search" fontSize="small" color="action" />
                </InputAdornment>
              ),
            }}
          />
          <Box sx={{ flex: 1, display: { xs: 'none', sm: 'block' } }} />
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: { xs: 'none', lg: 'block' }, whiteSpace: 'nowrap' }}
          >
            {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(
              new Date(),
            )}
          </Typography>
          <IconButton sx={{ flexShrink: 0 }} aria-label="Notificações">
            <Icon name="bell" fontSize="small" />
          </IconButton>
          <IconButton
            sx={{ flexShrink: 0 }}
            onClick={toggleMode}
            aria-label={
              mode === 'light' ? 'Ativar modo escuro' : 'Ativar modo claro'
            }
          >
            <Icon name={mode === 'light' ? 'moon' : 'sun'} fontSize="small" />
          </IconButton>
          <Avatar
            sx={{
              width: 34,
              height: 34,
              display: { xs: 'none', sm: 'flex' },
              bgcolor: 'secondary.main',
              fontSize: 13,
            }}
          >
            RC
          </Avatar>
        </Toolbar>
      </AppBar>
      <Box
        component="nav"
        sx={{
          width: { xs: 0, lg: drawerWidth },
          flex: { xs: '0 0 0', lg: `0 0 ${drawerWidth}px` },
        }}
      >
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', lg: 'none' },
            '& .MuiDrawer-paper': {
              width: drawerWidth,
              boxSizing: 'border-box',
            },
          }}
        >
          {sidebar}
        </Drawer>
        <Drawer
          variant="permanent"
          open
          sx={{
            display: { xs: 'none', lg: 'block' },
            '& .MuiDrawer-paper': {
              width: drawerWidth,
              boxSizing: 'border-box',
              borderRight: 1,
              borderColor: 'divider',
              bgcolor: 'background.paper',
            },
          }}
        >
          {sidebar}
        </Drawer>
      </Box>
      <Box
        component="main"
        sx={{
          flex: '1 1 0',
          width: 0,
          maxWidth: { xs: '100%', lg: `calc(100% - ${drawerWidth}px)` },
          minWidth: 0,
          overflowX: 'hidden',
          px: { xs: 2, sm: 3, lg: 4 },
          pt: '100px',
          pb: 2,
          boxSizing: 'border-box',
        }}
      >
        <DashboardContent />
        {/* Só para leitores de tela. No sx do MUI, width: 1 é 100%, não 1px:
            os valores em string garantem 1px e a página não ganha rolagem. */}
        <Box
          sx={{
            position: 'absolute',
            width: '1px',
            height: '1px',
            p: 0,
            m: '-1px',
            overflow: 'hidden',
            clip: 'rect(0 0 0 0)',
            whiteSpace: 'nowrap',
            border: 0,
          }}
          aria-live="polite"
        >
          {message}
        </Box>
      </Box>
    </Box>
  );
}
