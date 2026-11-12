/**
 * The project's tools the pages know: agents/tools/*.ts, read as text by
 * Vite when the pages are built (never run).
 */

import { toolsOfFiles, type ProjectTool } from './project-tools';

/** Every registered tool of the project. */
export const PROJECT_TOOLS: readonly ProjectTool[] = toolsOfFiles(
  import.meta.glob<string>('../../../agents/tools/*.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
);

/** The project's tool a name (`goiaba/…`) is, if any. */
export const projectTool = (name: string): ProjectTool | undefined =>
  PROJECT_TOOLS.find((tool) => tool.name === name);

/** The project's tools a definition's import path gives, if any. */
export const toolsFrom = (path: string): readonly ProjectTool[] =>
  PROJECT_TOOLS.filter((tool) => tool.from === path);
