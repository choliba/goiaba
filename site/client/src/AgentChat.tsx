import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  Alert,
  Box,
  Button,
  Fab,
  IconButton,
  InputBase,
  Menu,
  MenuItem,
  Paper,
  Stack,
  SvgIcon,
  Tooltip,
  Typography,
  useMediaQuery,
  type SvgIconProps,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';

// --- Tipos do que o backend devolve.

/** Um agente como o backend lista (GET /api/agents). */
interface Agente {
  /** Vai nas rotas (/api/agents/:id/...). */
  readonly id: string;
  /** O nome que o agente diz ter (o `name` da definição dele). */
  readonly name: string;
  readonly url: string;
  readonly online: boolean;
  readonly provider?: { name?: string; model?: string; cli?: string };
  readonly status?: string;
}

/** Uma fala na conversa. */
interface Fala {
  readonly de: 'voce' | 'agente';
  readonly texto: string;
}

/** Um pedido de aprovação esperando resposta (evento `aprovacao`). */
interface Pedido {
  readonly id: number;
  readonly command: string;
  readonly reason: string;
  readonly pattern: string;
  readonly category?: 'execution' | 'network';
}

const RESPOSTAS = [
  { valor: 'once', rotulo: 'Uma vez' },
  { valor: 'session', rotulo: 'Nesta sessão' },
  { valor: 'workspace', rotulo: 'Neste workspace' },
  { valor: 'deny', rotulo: 'Negar' },
] as const;

const ATUALIZAR_LISTA_MS = 5000;
const RECONECTAR_MS = 2000;
const LARGURA = 400;
const LARGURA_AMPLIADA = 760;

// --- Ícones (o site desenha os seus com SvgIcon).

const caminhos = {
  chat: 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z',
  fechar:
    'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  ampliar: 'M21 11V3h-8l3.29 3.29-10 10L3 13v8h8l-3.29-3.29 10-10z',
  reduzir:
    'M22 3.41 16.71 8.7 20 12h-8V4l3.29 3.29L20.59 2 22 3.41zM2 20.59 7.29 15.3 4 12h8v8l-3.29-3.29L3.41 22 2 20.59z',
  enviar: 'M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z',
  abaixo: 'M7 10l5 5 5-5z',
} as const;

function Icone({
  nome,
  ...props
}: { nome: keyof typeof caminhos } & SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path d={caminhos[nome]} />
    </SvgIcon>
  );
}

// --- Aberto ou fechado, no site inteiro.

interface ChatAberto {
  readonly aberto: boolean;
  abrir(): void;
  fechar(): void;
}

const Contexto = createContext<ChatAberto | undefined>(undefined);

/** Abre e fecha o chat de qualquer lugar do site (um item de menu, um botão). */
export function useAgentChat(): ChatAberto {
  const contexto = useContext(Contexto);
  if (contexto === undefined) {
    throw new Error('useAgentChat precisa estar dentro de AgentChatProvider.');
  }
  return contexto;
}

/**
 * O chat com os agentes, disponível em qualquer página: envolva o site com
 * ele. Traz o botão flutuante e o painel.
 */
export function AgentChatProvider({ children }: { children: ReactNode }) {
  const [aberto, setAberto] = useState(false);
  const valor = useMemo<ChatAberto>(
    () => ({
      aberto,
      abrir: () => setAberto(true),
      fechar: () => setAberto(false),
    }),
    [aberto],
  );

  return (
    <Contexto.Provider value={valor}>
      {children}
      <AgentChatButton />
      <AgentChatPanel />
    </Contexto.Provider>
  );
}

/** O botão flutuante que abre o chat; some com o painel aberto. */
function AgentChatButton() {
  const { aberto, abrir } = useAgentChat();
  if (aberto) return null;

  return (
    <Tooltip title="Conversar com um agente" placement="left">
      <Fab
        color="primary"
        aria-label="Abrir o chat com os agentes"
        onClick={abrir}
        sx={{
          position: 'fixed',
          right: 24,
          bottom: 24,
          zIndex: (theme) => theme.zIndex.drawer + 1,
        }}
      >
        <Icone nome="chat" />
      </Fab>
    </Tooltip>
  );
}

// --- Os dados: a lista de agentes e a conversa com o escolhido.

/** A lista de agentes, enquanto o chat está aberto: quem está no ar muda. */
function useAgentes(ativo: boolean) {
  const [agentes, setAgentes] = useState<Agente[] | undefined>();
  const [falha, setFalha] = useState<string | undefined>();

  useEffect(() => {
    if (!ativo) return;
    const carregar = async () => {
      try {
        const resposta = await fetch('/api/agents');
        const corpo: unknown = await resposta.json().catch(() => undefined);
        if (!resposta.ok || !Array.isArray(corpo)) {
          throw new Error(
            resposta.status === 404
              ? 'O backend do site não tem /api/agents: reinicie-o (bun run start:dev).'
              : `O backend do site respondeu ${String(resposta.status)}.`,
          );
        }
        setFalha(undefined);
        setAgentes(corpo as Agente[]);
      } catch (erro) {
        setFalha(
          erro instanceof TypeError
            ? 'O backend do site não respondeu: ele está rodando?'
            : (erro as Error).message,
        );
        setAgentes([]);
      }
    };
    void carregar();
    const timer = setInterval(() => void carregar(), ATUALIZAR_LISTA_MS);
    return () => clearInterval(timer);
  }, [ativo]);

  return { agentes, falha };
}

/**
 * A conversa com um agente: o que ele diz, o status e os pedidos, ao vivo.
 * Continua conectada com o painel fechado, para nada se perder.
 */
function useConversa(id: string | undefined) {
  const [falas, setFalas] = useState<Fala[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [conectado, setConectado] = useState(false);

  useEffect(() => {
    setFalas([]);
    setStatus(null);
    setPedidos([]);
    setConectado(false);
    if (id === undefined) return;

    let eventos: EventSource | undefined;
    let tentarDeNovo: ReturnType<typeof setTimeout> | undefined;
    let encerrado = false;

    // Um erro de resposta (o agente fora do ar, um 502) faz o navegador
    // desistir do stream de vez: o chat reabre sozinho até ele voltar.
    const conectar = () => {
      const atual = new EventSource(
        `/api/agents/${encodeURIComponent(id)}/eventos`,
      );
      eventos = atual;
      // A abertura pode se perder num proxy: qualquer evento também confirma.
      atual.onopen = () => setConectado(true);
      atual.onerror = () => {
        setConectado(false);
        if (atual.readyState !== EventSource.CLOSED || encerrado) return;
        tentarDeNovo = setTimeout(conectar, RECONECTAR_MS);
      };
      // O servidor manda a conversa desde o começo a cada conexão:
      // recomeça daqui, sem repetir o que já estava na tela.
      atual.addEventListener('inicio', () => {
        setConectado(true);
        setFalas([]);
        setPedidos([]);
        setStatus(null);
      });
      atual.addEventListener('voce', (evento) => {
        const { texto } = JSON.parse(evento.data) as { texto: string };
        setFalas((atuais) => [...atuais, { de: 'voce', texto }]);
      });
      atual.addEventListener('aprovacao_respondida', (evento) => {
        const { id: respondido } = JSON.parse(evento.data) as { id: number };
        setPedidos((atuais) =>
          atuais.filter((pedido) => pedido.id !== respondido),
        );
      });
      atual.addEventListener('mensagem', (evento) => {
        setConectado(true);
        const { texto } = JSON.parse(evento.data) as { texto: string };
        if (texto.trim().length === 0) return;
        setFalas((atuais) => [...atuais, { de: 'agente', texto }]);
      });
      atual.addEventListener('status', (evento) => {
        setConectado(true);
        const { texto } = JSON.parse(evento.data) as { texto: string | null };
        setStatus(texto);
      });
      atual.addEventListener('aprovacao', (evento) => {
        setConectado(true);
        const pedido = JSON.parse(evento.data) as Pedido;
        setPedidos((atuais) => [...atuais, pedido]);
      });
    };
    conectar();

    return () => {
      encerrado = true;
      clearTimeout(tentarDeNovo);
      eventos?.close();
    };
  }, [id]);

  const respondido = useCallback((pedido: number) => {
    setPedidos((atuais) => atuais.filter((item) => item.id !== pedido));
  }, []);

  return { falas, status, pedidos, conectado, respondido };
}

async function postar(caminho: string, corpo: unknown): Promise<void> {
  const resposta = await fetch(caminho, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  if (!resposta.ok) {
    const erro = (await resposta.json().catch(() => ({}))) as {
      message?: string;
    };
    throw new Error(erro.message ?? `Erro ${String(resposta.status)}`);
  }
}

function descricao(agente: Agente): string {
  const { name, model, cli } = agente.provider ?? {};
  return [name, model, cli].filter(Boolean).join(' · ') || agente.url;
}

// --- O painel.

function AgentChatPanel() {
  const theme = useTheme();
  const celular = useMediaQuery(theme.breakpoints.down('sm'));
  const { aberto, fechar } = useAgentChat();
  const { agentes, falha } = useAgentes(aberto);
  const [escolhido, setEscolhido] = useState<string | undefined>();
  const [ampliado, setAmpliado] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | undefined>();
  const fim = useRef<HTMLDivElement>(null);
  const conversa = useConversa(escolhido);

  // Se ninguém foi escolhido, ou o escolhido sumiu da lista (o servidor
  // reiniciou com outros agentes): o primeiro no ar, ou o primeiro da lista
  // (que então diz por que está fora do ar).
  useEffect(() => {
    if (agentes === undefined) return;
    if (agentes.some((agente) => agente.id === escolhido)) return;
    setEscolhido(
      (agentes.find((agente) => agente.online) ?? agentes.at(0))?.id,
    );
  }, [agentes, escolhido]);

  // Esc fecha.
  useEffect(() => {
    if (!aberto) return;
    const tecla = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') fechar();
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [aberto, fechar]);

  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [conversa.falas, conversa.pedidos, conversa.status, aberto]);

  const agente = agentes?.find((item) => item.id === escolhido);
  const podeFalar = agente?.online === true;
  const vazio = conversa.falas.length === 0 && conversa.pedidos.length === 0;

  const enviar = async (evento?: FormEvent) => {
    evento?.preventDefault();
    const mensagem = texto.trim();
    if (escolhido === undefined || mensagem.length === 0) return;
    setTexto('');
    setErro(undefined);
    try {
      await postar(`/api/agents/${encodeURIComponent(escolhido)}/mensagens`, {
        texto: mensagem,
      });
    } catch (falhou) {
      // Não chegou: o texto volta para a caixa, para tentar de novo.
      setTexto(mensagem);
      setErro((falhou as Error).message);
    }
  };

  const responder = async (pedido: Pedido, resposta: string) => {
    if (escolhido === undefined) return;
    setErro(undefined);
    try {
      await postar(
        `/api/agents/${encodeURIComponent(escolhido)}/aprovacoes/${String(pedido.id)}`,
        { resposta },
      );
      conversa.respondido(pedido.id);
    } catch (falhou) {
      setErro((falhou as Error).message);
    }
  };

  return (
    <Paper
      role="dialog"
      aria-label="Chat com os agentes"
      aria-hidden={!aberto}
      elevation={8}
      sx={{
        position: 'fixed',
        zIndex: theme.zIndex.drawer + 2,
        top: { xs: 0, sm: 12 },
        right: { xs: 0, sm: 12 },
        bottom: { xs: 0, sm: 12 },
        width: celular ? '100%' : ampliado ? LARGURA_AMPLIADA : LARGURA,
        maxWidth: '100vw',
        borderRadius: { xs: 0, sm: 3 },
        display: aberto ? 'flex' : 'none',
        flexDirection: 'column',
        overflow: 'hidden',
        border: 1,
        borderColor: 'divider',
      }}
    >
      {/* Topo: o agente e os botões. */}
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 1.5, py: 1.25, borderBottom: 1, borderColor: 'divider' }}
      >
        <Button
          variant="outlined"
          color="inherit"
          onClick={(evento) => setMenu(evento.currentTarget)}
          endIcon={<Icone nome="abaixo" />}
          sx={{
            textTransform: 'none',
            fontWeight: 650,
            borderRadius: 2,
            borderColor: 'divider',
            minWidth: 0,
            maxWidth: '100%',
            justifyContent: 'space-between',
          }}
        >
          <Box
            component="span"
            sx={{
              width: 8,
              height: 8,
              mr: 1,
              borderRadius: '50%',
              flexShrink: 0,
              bgcolor: podeFalar ? 'success.main' : 'text.disabled',
            }}
          />
          <Box
            component="span"
            sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {agente?.name ?? 'Escolha um agente'}
          </Box>
        </Button>
        <Box sx={{ flex: 1 }} />
        {!celular && (
          <Tooltip title={ampliado ? 'Reduzir' : 'Ampliar'}>
            <IconButton
              size="small"
              onClick={() => setAmpliado((atual) => !atual)}
            >
              <Icone nome={ampliado ? 'reduzir' : 'ampliar'} fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title="Fechar (Esc)">
          <IconButton size="small" onClick={fechar}>
            <Icone nome="fechar" fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      <Menu
        anchorEl={menu}
        open={menu !== null}
        onClose={() => setMenu(null)}
        slotProps={{ paper: { sx: { minWidth: 260 } } }}
      >
        {agentes === undefined || agentes.length === 0 ? (
          <MenuItem disabled>
            {falha ??
              'Nenhum agente. Rode bun agents/api.ts (ou defina AGENT_SERVERS no backend do site).'}
          </MenuItem>
        ) : (
          agentes.map((item) => (
            <MenuItem
              key={item.id}
              selected={item.id === escolhido}
              onClick={() => {
                setEscolhido(item.id);
                setMenu(null);
              }}
            >
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  mr: 1.5,
                  borderRadius: '50%',
                  flexShrink: 0,
                  bgcolor: item.online ? 'success.main' : 'text.disabled',
                }}
              />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" fontWeight={650} noWrap>
                  {item.name}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {item.online ? descricao(item) : 'fora do ar'}
                </Typography>
              </Box>
            </MenuItem>
          ))
        )}
      </Menu>

      {/* A conversa. */}
      <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 2 }}>
        <Stack spacing={1.25}>
          {falha !== undefined && <Alert severity="error">{falha}</Alert>}
          {agente !== undefined && !agente.online && (
            <Alert severity="warning">
              {agente.name} está fora do ar: rode bun agents/api.ts.
            </Alert>
          )}
          {vazio && (
            <Box sx={{ pt: 1 }}>
              <Typography fontWeight={700}>
                O que vamos resolver hoje?
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.5 }}
              >
                {agente === undefined
                  ? 'Escolha um agente no topo para começar.'
                  : `Converse com ${agente.name}: ${descricao(agente)}.`}
              </Typography>
            </Box>
          )}
          {conversa.falas.map((fala, indice) => (
            <Box
              key={indice}
              sx={{
                alignSelf: fala.de === 'voce' ? 'flex-end' : 'flex-start',
                maxWidth: '88%',
                px: 1.5,
                py: 1,
                borderRadius: 2.5,
                bgcolor:
                  fala.de === 'voce'
                    ? 'primary.main'
                    : alpha(theme.palette.text.primary, 0.06),
                color:
                  fala.de === 'voce' ? 'primary.contrastText' : 'text.primary',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                fontSize: 14,
              }}
            >
              {fala.texto}
            </Box>
          ))}
          {conversa.pedidos.map((pedido) => (
            <Paper
              key={pedido.id}
              variant="outlined"
              sx={{ p: 1.5, borderRadius: 2.5, borderColor: 'warning.main' }}
            >
              <Typography variant="body2" fontWeight={700}>
                {pedido.category === 'network'
                  ? '🌐 Pedido de rede'
                  : '🤖 Pedido de execução'}
              </Typography>
              <Box
                component="pre"
                sx={{
                  m: 0,
                  mt: 1,
                  p: 1,
                  borderRadius: 1.5,
                  bgcolor: alpha(theme.palette.text.primary, 0.06),
                  fontSize: 13,
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                }}
              >
                {pedido.command}
              </Box>
              <Typography
                variant="caption"
                color="text.secondary"
                display="block"
                sx={{ mt: 1 }}
              >
                {pedido.reason}
              </Typography>
              <Stack
                direction="row"
                spacing={1}
                useFlexGap
                flexWrap="wrap"
                sx={{ mt: 1.25 }}
              >
                {RESPOSTAS.map(({ valor, rotulo }) => (
                  <Button
                    key={valor}
                    size="small"
                    variant={valor === 'deny' ? 'outlined' : 'contained'}
                    color={valor === 'deny' ? 'inherit' : 'primary'}
                    onClick={() => void responder(pedido, valor)}
                    sx={{ textTransform: 'none' }}
                  >
                    {rotulo}
                  </Button>
                ))}
              </Stack>
            </Paper>
          ))}
          {conversa.status !== null && (
            <Typography
              variant="body2"
              color="text.secondary"
              aria-live="polite"
            >
              {conversa.status}
            </Typography>
          )}
          <div ref={fim} />
        </Stack>
      </Box>

      {erro !== undefined && (
        <Alert
          severity="error"
          onClose={() => setErro(undefined)}
          sx={{ mx: 2 }}
        >
          {erro}
        </Alert>
      )}

      {/* A caixa de mensagem. */}
      <Box
        component="form"
        onSubmit={(evento) => void enviar(evento)}
        sx={{ p: 1.5 }}
      >
        <Paper
          variant="outlined"
          sx={{
            borderRadius: 3,
            px: 1.75,
            pt: 1.25,
            pb: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 0.5,
            '&:focus-within': { borderColor: 'primary.main' },
          }}
        >
          <InputBase
            multiline
            maxRows={8}
            placeholder={
              podeFalar ? 'Por onde começamos?' : 'Escolha um agente no ar'
            }
            value={texto}
            disabled={!podeFalar}
            onChange={(evento) => setTexto(evento.target.value)}
            onKeyDown={(evento) => {
              if (evento.key === 'Enter' && !evento.shiftKey) {
                evento.preventDefault();
                void enviar();
              }
            }}
            inputProps={{ 'aria-label': 'Mensagem para o agente' }}
            sx={{ fontSize: 14 }}
          />
          <Stack direction="row" alignItems="center">
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ flex: 1 }}
            >
              {conversa.conectado || !podeFalar
                ? 'Enter envia · Shift+Enter quebra a linha'
                : 'Reconectando…'}
            </Typography>
            <IconButton
              type="submit"
              size="small"
              aria-label="Enviar"
              disabled={!podeFalar || texto.trim().length === 0}
              sx={{
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                '&:hover': { bgcolor: 'primary.dark' },
                '&.Mui-disabled': { bgcolor: 'action.disabledBackground' },
              }}
            >
              <Icone nome="enviar" fontSize="small" />
            </IconButton>
          </Stack>
        </Paper>
      </Box>
    </Paper>
  );
}
