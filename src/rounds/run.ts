/**
 * Runs a round's declaration: back to the starting tag, each step of the
 * flow as a one-shot agent that nobody answers, the git checked around it,
 * everything measured from the events, the rules checked, and one record
 * per run written. Composes the agents; they do not know they are in a
 * round.
 */

import { Agent, agentConversation } from '../agent/agent';
import { createConsumer } from '../events/index';
import type { Interaction } from '../interaction/index';
import { Workspace } from '../workspace/index';
import { NO_ONE_ANSWERS } from './constants';
import type { RoundDefinition, RoundFlowStep } from './define';
import { changes, linesAt, resetTo, tree, type Tree } from './git';
import { checkReferences } from './references';
import { spanOf, StepRecorder } from './measures';
import { measuresOf, sanitize, writeRound } from './record';
import { promptOf, roundConfigHash, snapshotActor } from './snapshot';
import { totalOf } from './totals';
import {
  ROUND_SCHEMA,
  type ActorSnapshot,
  type ActorTiming,
  type NetworkDecisionRecord,
  type RoundRecord,
  type RoundStart,
  type RoundStep,
  type TokenCounts,
  type UsageRecord,
} from './types';

/** A step as it ran, with the usage that goes to the record's own list. */
type StepRun = RoundStep & { readonly usage: readonly UsageRecord[] };

export interface RunRoundOptions {
  /** Where the records go, one `<id>.json` per run. */
  readonly dir: string;
  /** The project's path, written as `<projeto>` in the records. */
  readonly project: string;
  /** Where the agents show what they do; the agents' conversation on stdio by default. */
  readonly screen?: Interaction;
  /** Stops the round; the runScript's Ctrl+C by default. */
  readonly signal?: AbortSignal;
  /** What changed in this run, in your words; wins over the declaration's `label`. */
  readonly label?: string;
  /**
   * The cost in USD of a request the CLI does not price, by the actor's
   * model; `null` when unknown (the default: no price table yet).
   */
  readonly price?: (model: string, tokens: TokenCounts) => number | null;
}

/** Runs every repetition of `definition`, in order; the records' paths. */
export async function runRound(
  definition: RoundDefinition,
  options: RunRoundOptions,
): Promise<string[]> {
  const total = definition.repeat ?? 1;
  const files: string[] = [];
  for (let index = 1; index <= total; index += 1) {
    files.push(await runOnce(definition, { index, total }, options));
  }
  return files;
}

/** `analista` → `Analista`. */
const title = (name: string): string =>
  `${name.charAt(0).toUpperCase()}${name.slice(1)}`;

const now = (): string => new Date().toISOString();

interface ActorClock {
  startedAt: string;
  endedAt: string;
  durationMs: number;
  gitCheckMs: number | null;
}

async function runOnce(
  definition: RoundDefinition,
  repeat: { readonly index: number; readonly total: number },
  {
    dir,
    project,
    screen = agentConversation(),
    signal,
    label = definition.label,
    price = () => null,
  }: RunRoundOptions,
): Promise<string> {
  const startedAt = now();
  const git = definition.start?.git;
  const actors: Record<string, ActorSnapshot> = {};
  const decisions: Record<string, NetworkDecisionRecord[]> = {};
  const clocks: Record<string, ActorClock> = {};
  const steps: StepRun[] = [];
  const said: Record<string, string> = {};
  let start: RoundStart | null = null;
  let file = '';

  if (repeat.total > 1) {
    screen.write(
      `Rodada ${definition.id}: execução ${String(repeat.index)} de ${String(repeat.total)}`,
    );
  }

  /** The git around a step, timed; nothing without a git start. */
  const check = async (
    clock: ActorClock | undefined,
  ): Promise<Tree | undefined> => {
    if (git === undefined) return undefined;
    const began = Date.now();
    const state = await tree(git.root);
    if (clock !== undefined) {
      clock.gitCheckMs = (clock.gitCheckMs ?? 0) + Date.now() - began;
    }
    return state;
  };

  try {
    if (git !== undefined) {
      start = { tag: git.tag, commit: await resetTo(git.root, git.tag) };
      screen.write(
        `Workspace no ponto de partida: ${start.tag} (${start.commit})`,
      );
    }

    for (const flowStep of definition.flow) {
      const step = await runStep(flowStep);
      steps.push(step);
      const answer = step.said.join('\n\n').trim();
      if (answer.length === 0) {
        screen.write(`O ${step.actor} terminou sem responder: a rodada parou.`);
        break;
      }
      said[step.actor] = answer;
    }
  } finally {
    file = writeRound(record(), dir, project);
    screen.write(`\nRodada guardada em ${file}`);
  }
  return file;

  async function runStep(flowStep: RoundFlowStep): Promise<StepRun> {
    const name = flowStep.actor;
    // defineRound checked it; a declaration built by hand may not be.
    if (!Object.hasOwn(definition.actors, name)) {
      throw new Error(`Agente ${name} não declarado.`);
    }
    const actor = definition.actors[name];
    const readOnly = actor.readOnly ?? false;
    const text = flowStep.prompt({ said }).join('\n');
    const workspace = new Workspace(actor.workspace);
    actors[name] ??= snapshotActor(
      {
        role: name,
        provider: actor.provider,
        workspace,
        permissions: actor.permissions,
        readOnly,
      },
      (path) => sanitize(path, project),
    );
    const model = actors[name].provider.model;
    const index = steps.length;
    // Which of this actor's steps: `analista#2` is its second.
    const key = `${name}#${String(steps.filter((step) => step.actor === name).length + 1)}`;
    const recorder = new StepRecorder(name, index, (tokens) =>
      price(model, tokens),
    );

    if (flowStep.by !== undefined) {
      screen.write(`\n${title(flowStep.by)} consulta ${name}`);
    }
    screen.write(`${title(name)}…`);

    const stepStartedAt = now();
    const clock = (clocks[name] ??= {
      startedAt: stepStartedAt,
      endedAt: stepStartedAt,
      durationMs: 0,
      gitCheckMs: null,
    });
    const before = await check(clock);

    // The conversation's screen, without reading the keyboard: a question
    // of the agent is answered here, as if someone had typed it.
    const interaction: Interaction = {
      ask: (question) => {
        recorder.question(question);
        screen.write(`› ${NO_ONE_ANSWERS}`);
        return Promise.resolve(NO_ONE_ANSWERS);
      },
      write: (value) => screen.write(value),
      stream: screen.stream?.bind(screen),
      reasoning: screen.reasoning?.bind(screen),
      status: screen.status?.bind(screen),
      error: screen.error?.bind(screen),
    };

    // The network's decisions while this step runs are this agent's: the
    // steps run one at a time.
    const network = createConsumer((event) =>
      recorder.network({ type: event.type, ts: event.ts, data: event }),
    );
    network.subscribe('network');
    try {
      await new Agent({
        name,
        prompt: text,
        // Works until done and ends; never resumes an old task.
        conversation: false,
        resume: false,
        // Nobody approves in a round: a denied command stays denied.
        awaitApprovals: false,
        provider: actor.provider,
        workspace,
        ...(actor.permissions === undefined
          ? {}
          : { permissions: actor.permissions }),
        ...(signal === undefined ? {} : { signal }),
        interaction,
        subscribe: [
          (event) =>
            recorder.agent({
              type: event.type(),
              ts: event.ts(),
              data: event.data(),
            }),
        ],
      }).run();
    } finally {
      network.unsubscribeAll();
    }
    const stepEndedAt = now();

    const after = await check(clock);
    const { changed, diff } =
      before === undefined || after === undefined
        ? { changed: [], diff: '' }
        : changes(before, after);
    if (changed.length > 0) {
      screen.write(
        readOnly
          ? `⚠ O ${name} alterou arquivos, mesmo com o pedido de não alterar:\n${changed.join('\n')}`
          : `O ${name} alterou:\n${changed.join('\n')}`,
      );
    } else if (readOnly && git !== undefined) {
      screen.write(`✓ O ${name} não alterou nenhum arquivo.`);
    }

    const span = spanOf(stepStartedAt, stepEndedAt);
    clock.endedAt = stepEndedAt;
    clock.durationMs += span.durationMs;

    const measured = recorder.finish(stepEndedAt);
    (decisions[name] ??= []).push(...measured.decisions);
    const references =
      git === undefined
        ? null
        : await checkReferences(measured.said.join('\n'), (path) =>
            linesAt(git.root, git.tag, path),
          );
    return {
      key,
      actor: name,
      by: flowStep.by ?? null,
      prompt: promptOf(text),
      span,
      said: measured.said,
      asked: measured.asked,
      turns: measured.turns,
      tools: measured.tools,
      usage: measured.usage,
      changed,
      diff,
      totals: totalOf(measured.usage),
      references,
    };
  }

  function record(): RoundRecord {
    const endedAt = now();
    const usage = steps.flatMap((step) => step.usage);
    const names = Object.keys(actors);
    const withDecisions = Object.fromEntries(
      names.map((name): [string, ActorSnapshot] => {
        const actor = actors[name];
        return [
          name,
          {
            ...actor,
            network: { ...actor.network, decisions: decisions[name] ?? [] },
          },
        ];
      }),
    );
    const rules = (definition.rules ?? []).flatMap((rule) =>
      rule.check({
        steps,
        actors: Object.fromEntries(
          names.map((name) => [
            name,
            { readOnly: withDecisions[name].readOnly },
          ]),
        ),
      }),
    );
    return {
      schema: ROUND_SCHEMA,
      id: idOf(startedAt),
      definition: {
        id: definition.id,
        goal: definition.goal,
      },
      ...(label === undefined || label.trim().length === 0
        ? {}
        : { label: label.trim() }),
      start,
      repeat,
      timing: {
        ...spanOf(startedAt, endedAt),
        actors: Object.fromEntries(
          Object.entries(clocks).map(([name, clock]): [string, ActorTiming] => [
            name,
            {
              startedAt: clock.startedAt,
              endedAt: clock.endedAt,
              durationMs: clock.durationMs,
              workspaceMs: null,
              gitCheckMs: clock.gitCheckMs,
              approvalMs: null,
            },
          ]),
        ),
      },
      actors: withDecisions,
      configHash: roundConfigHash(
        { id: definition.id, goal: definition.goal },
        withDecisions,
      ),
      steps: steps.map(({ usage: _usage, ...step }) => step),
      usage,
      totals: {
        round: totalOf(usage),
        actors: Object.fromEntries(
          names.map((name) => [
            name,
            totalOf(usage.filter((u) => u.actor === name)),
          ]),
        ),
      },
      measures: Object.fromEntries(
        names.map((name) => [
          name,
          measuresOf(steps.filter((step) => step.actor === name)),
        ]),
      ),
      violations: rules,
      ...(definition.expected === undefined && definition.limits === undefined
        ? {}
        : {
            criteria: {
              ...(definition.expected === undefined
                ? {}
                : { expected: definition.expected }),
              ...(definition.limits === undefined
                ? {}
                : { limits: definition.limits }),
            },
          }),
    };
  }
}

/** `2026-11-03T16:50:30.759Z` → `2026-11-03T16-50-30.759Z`: a file name. */
const idOf = (startedAt: string): string => startedAt.replaceAll(':', '-');
