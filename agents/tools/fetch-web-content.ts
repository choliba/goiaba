/// <reference lib="dom" />
/**
 * A tool of the project: opens a web page in a headless browser (Puppeteer,
 * with the stealth plugin against anti-bot pages) and gives back its title,
 * headings and links. Registered as `goiaba/fetch_web_content`: an agent
 * sees it when its provider's `tools` names it, and calls it when its policy
 * allows. It runs in the Goiaba's process, outside the sandbox.
 *
 * The DOM types (`document`) are for the function `page.evaluate` runs in
 * the page, not here.
 *
 * Chrome keeps its own sandbox (never `--no-sandbox`): the pages are any
 * site's. On Ubuntu 23.10+ that needs an AppArmor profile for the Chrome
 * Puppeteer downloaded (~/.cache/puppeteer), allowing it user namespaces:
 *
 *   abi <abi/4.0>,
 *   include <tunables/global>
 *   profile chrome-puppeteer <path to chrome> flags=(unconfined) {
 *     userns,
 *   }
 *
 * in /etc/apparmor.d/chrome-puppeteer, loaded with
 * `sudo apparmor_parser -r /etc/apparmor.d/chrome-puppeteer`. A new Chrome
 * version (a new path) needs it again.
 */

import type { Browser } from 'puppeteer';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

import { registerTool } from '../../src/index';

puppeteer.use(StealthPlugin());

/** Milliseconds a page has to load before the call fails. */
const PAGE_LOAD_MS = 30_000;

/** How many links come back at most: the model reads all of them. */
const MAX_LINKS = 50;

export interface PageSummary {
  readonly url: string;
  readonly title: string;
  readonly headings: readonly string[];
  readonly links: readonly string[];
}

async function fetchWebContent({
  url,
}: {
  readonly url: string;
}): Promise<PageSummary> {
  let browser: Browser | undefined;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--disable-dev-shm-usage', '--disable-gpu'],
    });
    const page = await browser.newPage();
    await page.setUserAgent({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    });
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_LOAD_MS,
    });
    const found = await page.evaluate((currentUrl) => {
      const absolute = (href: string): string | null => {
        try {
          return new URL(href, currentUrl).href;
        } catch {
          return null;
        }
      };
      return {
        title: document.title,
        headings: Array.from(document.querySelectorAll('h1, h2'))
          .map((element) => element.textContent.trim())
          .filter((text) => text.length > 0),
        links: Array.from(
          new Set(
            Array.from(document.querySelectorAll('a[href]'))
              .map((element) => absolute(element.getAttribute('href') ?? ''))
              .filter((link): link is string => link !== null),
          ),
        ),
      };
    }, url);
    return {
      url,
      title: found.title,
      headings: found.headings,
      links: found.links.slice(0, MAX_LINKS),
    };
  } catch (error) {
    throw new Error(launchProblem(error) ?? String(error), { cause: error });
  } finally {
    await browser?.close();
  }
}

/**
 * Chrome refusing to start without its own sandbox: on Ubuntu 23.10+ the
 * AppArmor blocks the user namespaces it needs unless the binary has a
 * profile. Said plainly (the model reads it, and so does whoever runs the
 * agent); the sandbox is never turned off to get around it.
 */
function launchProblem(error: unknown): string | undefined {
  return String(error).includes('No usable sandbox')
    ? 'O navegador não abriu: o Chrome do Puppeteer não pode usar a sandbox dele porque o AppArmor do Ubuntu bloqueia os user namespaces de programas sem perfil. Quem roda o agente precisa dar um perfil do AppArmor a esse Chrome (veja agents/tools/fetch-web-content.ts); a ferramenta não abre páginas sem a sandbox do navegador.'
    : undefined;
}

export const FETCH_WEB_CONTENT = registerTool({
  name: 'fetch_web_content',
  description:
    'Abre uma página da web e devolve o título, os cabeçalhos (h1, h2) e os links dela. Use para ler o que há num endereço.',
  input: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'O endereço completo da página, com https://.',
      },
    },
    required: ['url'],
    additionalProperties: false,
  },
  run: (input: { readonly url: string }) => fetchWebContent(input),
});
