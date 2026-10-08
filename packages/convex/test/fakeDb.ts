/**
 * In-memory stand-in for the slice of Convex's `ctx` that the duration
 * backfill and report queries touch: index ranges (eq/gt/gte/lt/lte),
 * order, first/take/collect/paginate, search (returns every row; callers
 * filter), get, patch, and scheduler.runAfter. Patches apply to the rows
 * so later reads see earlier writes, as they would inside a mutation.
 */

export type Row = Record<string, unknown> & { _id: string };

type Op = "eq" | "gt" | "gte" | "lt" | "lte";
interface Condition {
  op: Op;
  field: string;
  value: unknown;
}

/** Indexes whose range field orders the results; others keep insertion order. */
const INDEX_ORDER_FIELD: Record<string, string> = { by_station_played_at: "playedAt" };

function recordConditions(build?: (q: unknown) => unknown): Condition[] {
  const conditions: Condition[] = [];
  const recorder: Record<Op, (field: string, value: unknown) => unknown> = {} as never;
  for (const op of ["eq", "gt", "gte", "lt", "lte"] as const) {
    recorder[op] = (field, value) => {
      conditions.push({ op, field, value });
      return recorder;
    };
  }
  build?.(recorder);
  return conditions;
}

function satisfies(row: Row, { op, field, value }: Condition): boolean {
  const actual = row[field] as number;
  const bound = value as number;
  if (op === "eq") return row[field] === value;
  if (op === "gt") return actual > bound;
  if (op === "gte") return actual >= bound;
  if (op === "lt") return actual < bound;
  return actual <= bound;
}

function results(rows: Row[]) {
  return {
    order: (direction: "asc" | "desc") =>
      results(direction === "desc" ? [...rows].reverse() : rows),
    first: async () => rows[0] ?? null,
    take: async (n: number) => rows.slice(0, n),
    collect: async () => rows,
    paginate: async ({ numItems, cursor }: { numItems: number; cursor: string | null }) => {
      const start = cursor === null ? 0 : Number(cursor);
      const page = rows.slice(start, start + numItems);
      const end = start + page.length;
      return { page, isDone: end >= rows.length, continueCursor: String(end) };
    },
  };
}

export function fakeCtx(tables: Record<string, Row[]>) {
  const patches: Array<{ id: string; fields: Record<string, unknown> }> = [];
  const scheduled: Array<{ args: Record<string, unknown> }> = [];
  const pageSizes: number[] = [];
  const allRows = () => Object.values(tables).flat();

  const db = {
    get: async (id: string) => allRows().find((row) => row._id === id) ?? null,
    patch: async (id: string, fields: Record<string, unknown>) => {
      patches.push({ id, fields });
      const row = allRows().find((candidate) => candidate._id === id);
      if (row !== undefined) Object.assign(row, fields);
    },
    query: (table: string) => {
      const rows = tables[table] ?? [];
      return {
        ...results(rows),
        withSearchIndex: () => results(rows),
        withIndex: (index: string, build?: (q: unknown) => unknown) => {
          const conditions = recordConditions(build);
          const matched = rows.filter((row) => conditions.every((c) => satisfies(row, c)));
          const orderField = INDEX_ORDER_FIELD[index];
          if (orderField !== undefined) {
            matched.sort((a, b) => (a[orderField] as number) - (b[orderField] as number));
          }
          const found = results(matched);
          return {
            ...found,
            paginate: (options: { numItems: number; cursor: string | null }) => {
              pageSizes.push(options.numItems);
              return found.paginate(options);
            },
          };
        },
      };
    },
  };
  const scheduler = {
    runAfter: async (_delayMs: number, _fn: unknown, args: Record<string, unknown>) => {
      scheduled.push({ args });
    },
  };
  return { ctx: { db, scheduler }, patches, scheduled, pageSizes };
}

/** Pull `_handler` off a registered Convex function so tests can call it with a fake ctx. */
export function handlerOf<Args, Result>(
  fn: unknown,
): (ctx: unknown, args: Args) => Promise<Result> {
  return (fn as { _handler: (ctx: unknown, args: Args) => Promise<Result> })._handler;
}
