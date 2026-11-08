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
import { getConfig } from '../config/index';
import { UsageError } from '../errors';
import { join, realPathOfNearest } from '../filesystem/index';
import { Workspace } from '../workspace/index';
import { FIXTURE_TAG, NO_ONE_ANSWERS, RESOURCE_SAMPLE_MS } from './constants';
import { writableOf } from './permissions';
import type { RoundDefinition, RoundFlowStep } from './define';
import { captureDeclaration } from './capture';
import {
  assertApart,
  assertOwnRepository,
  changes,
  linesAt,
  prepareFixture,
  resetTo,
  tree,
  type Tree,
} from './git';
import { checkInstructions, conditionsAt } from './instructions';
import { checkReferences } from './references';
import { spanOf, StepRecorder } from './measures';
import { measuresOf, sanitize, writeRound } from './record';
import {
  beginResources,
  summarize,
  summarizeWithin,
  type ResourceSampler,
} from './resources';
import { promptOf, roundConfigHash, snapshotActor } from './snapshot';
import { totalOf } from './totals';
import {
  ROUND_SCHEMA,
  type ActorSnapshot,
  type ActorTiming,
  type NetworkDecisionRecord,
  type ResourceSample,
  type RoundRecord,
  type RoundResources,
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
  /**
   * The project's path: written as `<projeto>` in the records, holds the
   * fixtures (`rounds/fixtures`), and no round may run inside it.
   */
  readonly project: string;
  /** Where rounds started from a fixture run; `rounds.dir` by default. */
  readonly roundsDir?: string;
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

/** Where a run starts: the folder, its tag, and the fixture it came from. */
interface StartPlan {
  readonly root: string;
  readonly tag: string;
  readonly fixture: string | null;
  readonly roundsDir: string | undefined;
}

function startPlan(
  definition: RoundDefinition,
  roundsDir: string | undefined,
): StartPlan | undefined {
  const start = definition.start;
  if (start === undefined) return undefined;
  if ('git' in start) {
    return { ...start.git, fixture: null, roundsDir: undefined };
  }
  if (roundsDir === undefined) {
    throw new UsageError(
      'Configure rounds.dir no goiaba.config.ts: uma pasta fora do projeto onde as rodadas rodam, como rounds: { dir: "~/.local/share/goiaba/rodadas" }.',
    );
  }
  return {
    root: join(roundsDir, definition.id),
    tag: FIXTURE_TAG,
    fixture: start.fixture,
    roundsDir,
  };
}

/** Every actor works in the folder the round starts and checks. */
function assertActorsAt(definition: RoundDefinition, root: string): void {
  const expected = realPathOfNearest(root);
  for (const [name, actor] of Object.entries(definition.actors)) {
    if (realPathOfNearest(actor.workspace.root) !== expected) {
      throw new UsageError(
        `A rodada ${definition.id}: o workspace de ${name} (${actor.workspace.root}) não é a pasta da rodada (${root}). Use root: roundDir('${definition.id}') (ou o root de start.git).`,
      );
    }
  }
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
    roundsDir = getConfig().rounds.dir,
    screen = agentConversation(),
    signal,
    label = definition.label,
    price = () => null,
  }: RunRoundOptions,
): Promise<string> {
  const startedAt = now();
  const git = startPlan(definition, roundsDir);
  if (git !== undefined) assertActorsAt(definition, git.root);
  const actors: Record<string, ActorSnapshot> = {};
  const decisions: Record<string, NetworkDecisionRecord[]> = {};
  const clocks: Record<string, ActorClock> = {};
  const steps: StepRun[] = [];
  const said: Record<string, string> = {};
  let start: RoundStart | null = null;
  let file = '';
  // The machine's use through the whole round; left out when it cannot be read.
  let sampler: ResourceSampler | undefined;
  let samples: ResourceSample[] = [];
  try {
    sampler = await beginResources();
  } catch {
    // A host we cannot read is not a reason to lose the round.
  }

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
      const commit =
        git.fixture === null || git.roundsDir === undefined
          ? await resetFrom(git.root, git.tag, project)
          : await prepareFixture({
              project,
              fixture: git.fixture,
              root: git.root,
              roundsDir: git.roundsDir,
            });
      start = { tag: git.tag, commit, fixture: git.fixture };
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
    if (sampler !== undefined) samples = await sampler.stop();
    // A round that failed before any agent ran (no such tag, say) is not a
    // round: nothing to record, and the error says what to fix.
    if (steps.length > 0) {
      file = writeRound(record(), dir, project);
      screen.write(`\nRodada guardada em ${file}`);
    }
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
        policy: actor.policy,
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
    // The instructions' conditions, before the agent acts.
    const stepInstructions = definition.instructions?.[name] ?? [];
    const conditions = conditionsAt(stepInstructions, workspace.root);

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
    // The execution gate's decisions: why a command ran or not.
    const commands = createConsumer((event) =>
      recorder.command({ type: event.type, ts: event.ts, data: event }),
    );
    commands.subscribe('command');
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
        ...(actor.policy === undefined ? {} : { policy: actor.policy }),
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
      commands.unsubscribeAll();
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
      instructions: checkInstructions(
        stepInstructions,
        conditions,
        workspace.root,
        changed,
      ),
      totals: totalOf(measured.usage),
      references,
    };
  }

  function record(): RoundRecord {
    const endedAt = now();
    const resources = resourcesOf();
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
            {
              readOnly: withDecisions[name].readOnly,
              writable: writableOf(withDecisions[name].policy),
            },
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
      ...(definition.limits === undefined
        ? {}
        : { criteria: { limits: definition.limits } }),
      declaration: captureDeclaration(definition, label),
      ...(resources === undefined ? {} : { resources }),
    };
  }

  /** The round's resource use, by agent too; `undefined` when not measured. */
  function resourcesOf(): RoundResources | undefined {
    if (sampler === undefined || samples.length === 0) return undefined;
    return {
      machine: sampler.machine,
      intervalMs: RESOURCE_SAMPLE_MS,
      samples,
      round: summarize(samples),
      actors: Object.fromEntries(
        Object.keys(actors).map((name) => [
          name,
          summarizeWithin(
            samples,
            steps
              .filter((step) => step.actor === name)
              .map((step) => step.span),
          ),
        ]),
      ),
    };
  }
}

/** `2026-11-03T16:50:30.759Z` → `2026-11-03T16-50-30.759Z`: a file name. */
const idOf = (startedAt: string): string => startedAt.replaceAll(':', '-');

/** A repository that already existed, checked before it is reset. */
async function resetFrom(
  root: string,
  tag: string,
  project: string,
): Promise<string> {
  assertApart(root, project);
  await assertOwnRepository(root);
  return resetTo(root, tag);
}
