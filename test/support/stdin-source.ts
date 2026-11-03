/**
 * Reads stdin through `src/input` the way the first argument says, and
 * prints what happened as one JSON line, for test/input.test.ts.
 */
import { read, readStream } from '../../src/input/index';

const mode = process.argv[2];

async function main(): Promise<unknown> {
  switch (mode) {
    case 'read':
      return { text: await read() };
    case 'stream': {
      const pieces: string[] = [];
      for await (const piece of readStream()) pieces.push(piece);
      return { text: pieces.join('') };
    }
    case 'twice': {
      const first = readStream()[Symbol.asyncIterator]();
      const second = readStream()[Symbol.asyncIterator]();
      const pending = first.next();
      try {
        await second.next();
        return { error: undefined };
      } catch (error) {
        await pending;
        return { error: error instanceof Error ? error.name : String(error) };
      }
    }
    case 'after-end': {
      await read();
      const again = await readStream()[Symbol.asyncIterator]().next();
      return { done: again.done };
    }
    case 'lazy': {
      readStream();
      return { opened: false };
    }
    case 'abort': {
      const controller = new AbortController();
      setTimeout(() => {
        controller.abort();
      }, 50);
      try {
        for await (const piece of readStream({ signal: controller.signal })) {
          void piece;
        }
        return { error: undefined };
      } catch (error) {
        return { error: error instanceof Error ? error.name : String(error) };
      }
    }
    default:
      throw new Error(`modo desconhecido: ${mode}`);
  }
}

process.stdout.write(`${JSON.stringify(await main())}\n`);
process.exit(0);
