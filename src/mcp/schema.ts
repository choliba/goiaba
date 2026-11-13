/**
 * A tool's input, described in JSON Schema (what MCP sends the model) and
 * checked before `run`: the object, its required fields and the type of each
 * declared field. Only that: the model sees the whole schema, and `run`
 * checks anything finer itself.
 */

/** The JSON Schema of a tool's input: an object and its fields. */
export interface ToolInputSchema {
  readonly type: 'object';
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly description?: string;
  readonly additionalProperties?: boolean;
}

/** A field's schema, as JSON Schema writes it. */
export interface JsonSchema {
  readonly type?:
    'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null';
  readonly description?: string;
  readonly enum?: readonly unknown[];
  readonly items?: JsonSchema;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
}

/** Whether a value is a plain object (not null, not an array). */
export const isRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Whether a value has each JSON Schema `type`. */
const TYPES: Readonly<
  Record<NonNullable<JsonSchema['type']>, (value: unknown) => boolean>
> = {
  string: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number' && Number.isFinite(value),
  integer: (value) => Number.isInteger(value),
  boolean: (value) => typeof value === 'boolean',
  array: (value) => Array.isArray(value),
  object: isRecord,
  null: (value) => value === null,
};

/**
 * What is wrong with `input` for `schema`, in the model's language (it reads
 * it and tries again); `undefined` when it fits.
 */
export function inputProblem(
  schema: ToolInputSchema,
  input: unknown,
): string | undefined {
  if (!isRecord(input)) return 'A entrada deve ser um objeto.';
  const fields = input;
  const missing = (schema.required ?? []).filter((name) => !(name in fields));
  if (missing.length > 0) {
    return `Faltam campos obrigatórios: ${missing.join(', ')}.`;
  }
  for (const [name, field] of Object.entries(schema.properties ?? {})) {
    const value = fields[name];
    if (value === undefined) continue;
    if (field.type !== undefined && !TYPES[field.type](value)) {
      return `O campo ${name} deve ser do tipo ${field.type}.`;
    }
    if (field.enum !== undefined && !field.enum.includes(value)) {
      return `O campo ${name} deve ser um de: ${field.enum.map(String).join(', ')}.`;
    }
  }
  if (schema.additionalProperties === false) {
    const extra = Object.keys(fields).find(
      (name) => !(name in (schema.properties ?? {})),
    );
    if (extra !== undefined) return `Campo desconhecido: ${extra}.`;
  }
  return undefined;
}
