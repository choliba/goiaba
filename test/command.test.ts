import { describe, expect, test } from 'bun:test';

import {
  commandMatches,
  parseCommand,
  validateCommandPattern,
} from '../src/policy/command';
import { PolicyEngine } from '../src/policy/index';

describe('padrões de comando', () => {
  test('* casa qualquer sequência, inclusive / e espaços', () => {
    expect(commandMatches('mkdir -p /workspace/src/pages', 'mkdir *')).toBe(
      true,
    );
    expect(commandMatches('npm run build -- --out dist/x', 'npm *')).toBe(true);
    expect(commandMatches('npm', 'npm *')).toBe(false);
    expect(commandMatches('pwd', 'pwd')).toBe(true);
    expect(commandMatches('npm publish --tag x', 'npm publish*')).toBe(true);
    expect(commandMatches('npx create-vite', 'npm *')).toBe(false);
  });

  test('recusa sintaxe de glob sem sentido em comandos', () => {
    expect(() => {
      validateCommandPattern('bun [a-z]*');
    }).toThrow('só aceita texto e *');
    expect(() => {
      validateCommandPattern('  ');
    }).toThrow('vazio');
  });
});

describe('parseCommand', () => {
  test('divide por &&, ||, ; e | fora de aspas', () => {
    expect(
      parseCommand("cd src && ls -la | head; echo 'a && b' || true"),
    ).toEqual({
      parts: ['cd src', 'ls -la', 'head', "echo 'a && b'", 'true'],
      complex: false,
    });
  });

  test('separadores dentro de aspas ou escapados não dividem', () => {
    expect(parseCommand('echo "a;b" ; ls')).toEqual({
      parts: ['echo "a;b"', 'ls'],
      complex: false,
    });
    expect(parseCommand('echo a\\;b && echo "x \\" y"')).toEqual({
      parts: ['echo a\\;b', 'echo "x \\" y"'],
      complex: false,
    });
    expect(parseCommand("echo '$(id)'").complex).toBe(false);
    expect(parseCommand('echo $HOME').complex).toBe(false);
  });

  test('o corpo de um heredoc é dado, não comando', () => {
    const write = [
      "cat > src/Appx << 'EOF'",
      'const App = () => {};',
      'export default App;',
      'EOF',
    ].join('\n');

    expect(parseCommand(write)).toEqual({
      parts: ["cat > src/Appx << 'EOF'"],
      complex: true,
    });
  });

  test('marca redirecionamento, substituição, heredoc e background', () => {
    for (const command of [
      'cat > a.txt',
      'echo x 2>&1',
      'echo $(whoami)',
      'echo `id`',
      'echo "$(id)"',
      "cat <<'EOF'\nx\nEOF",
      'sleep 1 &',
      "echo 'aberta",
    ]) {
      expect(parseCommand(command).complex).toBe(true);
    }
  });
});

describe('PolicyEngine.checkCommand', () => {
  const engine = new PolicyEngine({
    default: 'deny',
    allow: {
      execution: [
        {
          commands: ['mkdir *', 'ls *', 'cd *', 'cat *', 'npm *'],
          ignores: { commands: ['npm publish*'] },
        },
      ],
    },
    requireApproval: { execution: [{ commands: ['rm *'] }] },
    deny: { execution: [{ commands: ['sudo *'] }] },
  });
  const policy = (command: string): string =>
    engine.checkCommand(command).policy;

  test('aplica a regra a cada parte; a mais restritiva vence', () => {
    expect(policy('mkdir -p /workspace/src/pages')).toBe('allow');
    expect(policy('cd /workspace && ls -la')).toBe('allow');
    expect(policy('cd /workspace && rm -rf build')).toBe('require_approval');
    expect(policy('ls && sudo rm -rf /')).toBe('deny');
    expect(policy('npm publish')).toBe('deny');
    expect(policy('node --version')).toBe('deny');
  });

  test('comando permitido com redirecionamento pede aprovação', () => {
    expect(
      policy("cat > /workspace/ax << 'EOF'\nconst a = () => {};\nEOF"),
    ).toBe('require_approval');
    expect(policy('cat > /workspace/a.txt')).toBe('require_approval');
    // What runs inside $(...) is not parsed: a person sees the whole line.
    expect(policy('ls $(sudo id)')).toBe('require_approval');
  });
});
