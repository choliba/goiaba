/**
 * Exemplo 3 do curso de filesystem: caminhos como texto. Nenhuma destas
 * funções toca no disco; elas vêm daqui para ninguém importar node:path.
 */
import {
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from '../../../src/filesystem/index';
import { writeOut } from '../../../src/output/terminal';

const show = (expression: string, value: unknown): void => {
  writeOut(`${expression.padEnd(48)} → ${JSON.stringify(value)}\n`);
};

show(
  "join('/projeto', 'src', 'index.ts')",
  join('/projeto', 'src', 'index.ts'),
);
show("join('/projeto', '../fora')", join('/projeto', '../fora'));
show("resolve('/projeto', 'src/../docs')", resolve('/projeto', 'src/../docs'));
show("resolve('/projeto', '/etc/passwd')", resolve('/projeto', '/etc/passwd'));
show(
  "relative('/projeto', '/projeto/src/a.ts')",
  relative('/projeto', '/projeto/src/a.ts'),
);
show(
  "relative('/projeto', '/outro/b.ts')",
  relative('/projeto', '/outro/b.ts'),
);
show("dirname('/projeto/src/index.ts')", dirname('/projeto/src/index.ts'));
show("isAbsolute('src/index.ts')", isAbsolute('src/index.ts'));
show(
  "normalize('/projeto//src/./a/../b.ts')",
  normalize('/projeto//src/./a/../b.ts'),
);
show('sep', sep);
