/**
 * Composition of an experience's modules, once at engine creation (design 013 section 9.2).
 * `composeModules` checks the list of definitions, orders it topologically (ties broken by list order), creates the instances in that order and checks what only instances show (handlers, ticks, tool requirements). It reports every problem it finds in one `ModuleCompositionError`, never the first only.
 * It holds no state of its own: the result is a plain description the engine runs.
 */
import type {
  AnyModuleDefinition,
  CommandContext,
  CommandResult,
  EngineEventBase,
  EngineIdSource,
  ModuleCreateContext,
  ModuleInstance,
  ModuleTick,
  ModuleToken,
} from "./moduleTypes";
import type { CompiledCellComplex } from "../cell-complex/compileCellComplex";
import type { RuntimeToolId } from "../glue/toolIds";
import type { RuntimeObjectRegistry } from "../world-objects/runtimeObjectRegistry";

/** Every composition problem at once. */
export class ModuleCompositionError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`The module list is invalid:\n- ${problems.join("\n- ")}`);
    this.name = "ModuleCompositionError";
    this.problems = problems;
  }
}

/** The pattern every contributed name follows: "<moduleId>/<noun>" (design 013 section 10). */
export const contributedNamePattern = /^[a-z][A-Za-z0-9]*\/[a-z][A-Za-z0-9]*$/;

/** One command handler as the engine stores it. */
export interface ComposedHandler {
  readonly moduleId: string;
  readonly run: (command: never, ctx: CommandContext) => CommandResult;
  readonly requiresTool: RuntimeToolId | undefined;
  readonly moduleOnly: boolean;
}

/** A created module and the facts the engine needs about it. */
export interface ComposedModule {
  readonly definition: AnyModuleDefinition;
  readonly instance: ModuleInstance<unknown, never, EngineEventBase, unknown>;
  /** Kinds this module declares. */
  readonly declaredKinds: ReadonlySet<string>;
  /** Kinds the write guard lets this module write: the declared kinds and its `writesCoreKinds`. */
  readonly writableKinds: ReadonlySet<string>;
  /** Ids of the modules whose tokens this module requires, directly. */
  readonly requiredModuleIds: ReadonlySet<string>;
}

/** The result of composition. */
export interface ComposedExperience {
  /** In topological order; the order ticks run in. */
  readonly modules: readonly ComposedModule[];
  /** Command kind to handler. */
  readonly handlers: ReadonlyMap<string, ComposedHandler>;
  /** Token id to the module providing it. */
  readonly providers: ReadonlyMap<string, ComposedModule>;
  /** Tool ids of the modules (not the core tools). */
  readonly moduleToolIds: readonly RuntimeToolId[];
}

/** What composition needs of the engine. */
export interface ComposeOptions {
  readonly coreObjectKinds: readonly string[];
  /** Core kinds that a module may declare as its own (`moduleOwnedCoreKinds`). */
  readonly moduleOwnedCoreKinds?: readonly string[];
  readonly coreToolIds: readonly string[];
  readonly objects: RuntimeObjectRegistry;
  readonly getWorld: () => CompiledCellComplex;
  /** The id source of one module: its ids start with "<moduleId>/". */
  idsFor(moduleId: string): EngineIdSource;
  /** What `ctx.require` hands to a dependent in place of the provider's `api` (the engine wraps it for the write guard). */
  wrapApi(moduleId: string, api: unknown): unknown;
}

/** Checks, orders and creates the modules; throws a {@link ModuleCompositionError} listing every problem. */
export function composeModules(definitions: readonly AnyModuleDefinition[], options: ComposeOptions): ComposedExperience {
  const problems: string[] = [];
  const ordered = orderModules(definitions, problems);
  checkDefinitions(definitions, options, problems);
  if (ordered === undefined) {
    throw new ModuleCompositionError(problems);
  }

  const providerOfToken = new Map<string, AnyModuleDefinition>();
  for (const definition of ordered) {
    if (definition.provides) providerOfToken.set(definition.provides.id, definition);
  }
  const apis = new Map<string, unknown>();
  const modules: ComposedModule[] = [];
  for (const definition of ordered) {
    const requiredTokenIds = new Set(definition.requires.map((token) => token.id));
    const context: ModuleCreateContext = {
      require<A>(token: ModuleToken<A, unknown>): A {
        if (!requiredTokenIds.has(token.id)) {
          throw new Error(`module ${definition.id} calls require(${token.id}), which is not in its requires`);
        }
        const provider = providerOfToken.get(token.id);
        if (!provider) throw new Error(`module ${definition.id} calls require(${token.id}), which no module provides`);
        return options.wrapApi(provider.id, apis.get(token.id)) as A;
      },
      objects: options.objects,
      getWorld: options.getWorld,
      ids: options.idsFor(definition.id),
    };
    let instance: ModuleInstance<unknown, never, EngineEventBase, unknown>;
    try {
      instance = definition.create(context);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    if (definition.provides) apis.set(definition.provides.id, instance.api);
    modules.push({
      definition,
      instance,
      declaredKinds: new Set(definition.objectKinds.map((declaration) => declaration.kind)),
      writableKinds: writableKindsOf(definition),
      requiredModuleIds: new Set(definition.requires.flatMap((token) => providerOfToken.get(token.id)?.id ?? [])),
    });
  }

  const handlers = new Map<string, ComposedHandler>();
  const moduleToolIds = ordered.flatMap((definition) => definition.toolIds ?? []);
  checkInstances(modules, new Set([...options.coreToolIds, ...moduleToolIds]), new Set(options.coreObjectKinds), handlers, problems);
  if (problems.length > 0) {
    throw new ModuleCompositionError(problems);
  }

  const providers = new Map<string, ComposedModule>();
  for (const module of modules) {
    if (module.definition.provides) providers.set(module.definition.provides.id, module);
  }
  return { modules, handlers, providers, moduleToolIds };
}

/** The kinds the write guard lets a module write. */
export function writableKindsOf(definition: AnyModuleDefinition): ReadonlySet<string> {
  return new Set([...definition.objectKinds.map((declaration) => declaration.kind), ...(definition.writesCoreKinds ?? [])]);
}

/** Topological order of `requires`, ties broken by list order; undefined (with a problem) when a token has no provider or the modules form a cycle. Records rules 1 to 4. */
function orderModules(definitions: readonly AnyModuleDefinition[], problems: string[]): readonly AnyModuleDefinition[] | undefined {
  const seenIds = new Set<string>();
  for (const definition of definitions) {
    if (seenIds.has(definition.id)) problems.push(`two modules have the id ${definition.id}`);
    seenIds.add(definition.id);
  }

  const providerOfToken = new Map<string, AnyModuleDefinition>();
  for (const definition of definitions) {
    if (!definition.provides) continue;
    const other = providerOfToken.get(definition.provides.id);
    if (other) {
      problems.push(`modules ${other.id} and ${definition.id} both provide ${definition.provides.id}`);
    } else {
      providerOfToken.set(definition.provides.id, definition);
    }
  }

  const dependencies = new Map<AnyModuleDefinition, AnyModuleDefinition[]>();
  for (const definition of definitions) {
    const list: AnyModuleDefinition[] = [];
    for (const token of definition.requires) {
      const provider = providerOfToken.get(token.id);
      if (!provider) {
        problems.push(`module ${definition.id} requires ${token.id}; no module in the experience provides it`);
      } else {
        list.push(provider);
      }
    }
    dependencies.set(definition, list);
  }

  const placed = new Set<AnyModuleDefinition>();
  const ordered: AnyModuleDefinition[] = [];
  while (ordered.length < definitions.length) {
    const next = definitions.find((definition) => !placed.has(definition) && dependencies.get(definition)!.every((dependency) => placed.has(dependency)));
    if (!next) {
      const cycle = findCycle(definitions.filter((definition) => !placed.has(definition)), dependencies);
      problems.push(`modules form a dependency cycle: ${cycle.join(" -> ")}`);
      return undefined;
    }
    placed.add(next);
    ordered.push(next);
  }
  return ordered;
}

/** A cycle among `remaining` as a path of module ids that ends where it starts. */
function findCycle(remaining: readonly AnyModuleDefinition[], dependencies: ReadonlyMap<AnyModuleDefinition, readonly AnyModuleDefinition[]>): string[] {
  const inRemaining = new Set(remaining);
  const path: AnyModuleDefinition[] = [];
  const visit = (definition: AnyModuleDefinition): string[] | undefined => {
    const at = path.indexOf(definition);
    if (at >= 0) return [...path.slice(at), definition].map((entry) => entry.id);
    path.push(definition);
    for (const dependency of dependencies.get(definition)!) {
      if (!inRemaining.has(dependency)) continue;
      const found = visit(dependency);
      if (found) return found;
    }
    path.pop();
    return undefined;
  };
  for (const definition of remaining) {
    const found = visit(definition);
    if (found) return found;
  }
  return remaining.map((definition) => definition.id);
}

/** Rules 5 and 11 for what definitions declare. */
function checkDefinitions(definitions: readonly AnyModuleDefinition[], options: ComposeOptions, problems: string[]): void {
  const declaredBy = new Map<string, string>();
  const core = new Set(options.coreObjectKinds);
  const owned = new Set(options.moduleOwnedCoreKinds ?? []);
  for (const definition of definitions) {
    for (const declaration of definition.objectKinds) {
      const other = declaredBy.get(declaration.kind);
      if (core.has(declaration.kind) && !owned.has(declaration.kind)) {
        problems.push(`module ${definition.id} declares the object kind ${declaration.kind}, which is a core kind`);
      } else if (other !== undefined) {
        problems.push(`the object kind ${declaration.kind} is declared twice, by ${other} and by ${definition.id}`);
      }
      declaredBy.set(declaration.kind, definition.id);
      checkName(definition.id, "object kind", declaration.kind, problems);
    }
    for (const kind of definition.writesCoreKinds ?? []) {
      if (!core.has(kind)) problems.push(`module ${definition.id} lists ${kind} in writesCoreKinds, which is not a core kind`);
    }
    for (const toolId of definition.toolIds ?? []) {
      checkName(definition.id, "tool id", toolId, problems);
    }
  }
}

/** Rule 11 for one contributed name. */
function checkName(moduleId: string, what: string, name: string, problems: string[]): void {
  if (!contributedNamePattern.test(name) || !name.startsWith(`${moduleId}/`)) {
    problems.push(`module ${moduleId}: the ${what} "${name}" is not of the form ${moduleId}/<noun>`);
  }
}

/** Rules 6 to 9, 11 and 12 for what instances declare. Fills `handlers`. */
function checkInstances(
  modules: readonly ComposedModule[],
  knownToolIds: ReadonlySet<string>,
  coreKinds: ReadonlySet<string>,
  handlers: Map<string, ComposedHandler>,
  problems: string[],
): void {
  const toolDefinedBy = new Map<string, string>();
  for (const module of modules) {
    const moduleId = module.definition.id;
    for (const toolId of module.definition.toolIds ?? []) {
      const other = toolDefinedBy.get(toolId);
      if (other !== undefined) problems.push(`the tool id ${toolId} is defined by both ${other} and ${moduleId}`);
      toolDefinedBy.set(toolId, moduleId);
    }

    const commands = module.instance.commands as Record<string, { run: ComposedHandler["run"]; requiresTool?: RuntimeToolId; moduleOnly?: true }>;
    for (const [kind, handler] of Object.entries(commands)) {
      checkName(moduleId, "command", kind, problems);
      const other = handlers.get(kind);
      if (other) problems.push(`the command ${kind} has handlers in both ${other.moduleId} and ${moduleId}`);
      if (handler.requiresTool !== undefined && !knownToolIds.has(handler.requiresTool)) {
        problems.push(`module ${moduleId}: the command ${kind} requires the tool ${handler.requiresTool}, which no module in the experience defines`);
      }
      handlers.set(kind, { moduleId, run: handler.run, requiresTool: handler.requiresTool, moduleOnly: handler.moduleOnly === true });
    }

    for (const tick of module.instance.ticks) {
      checkName(moduleId, "tick", tick.id, problems);
      for (const kind of tick.writes) {
        if (!module.declaredKinds.has(kind)) problems.push(`module ${moduleId}: the tick ${tick.id} writes ${kind}, which the module does not declare`);
      }
    }
  }

  checkSubscriptions(modules, coreKinds, problems);
}

/** Rules 8 and 9: a derive tick subscribes only to kinds it may see, and never to a kind a later derive tick writes. */
function checkSubscriptions(modules: readonly ComposedModule[], coreKinds: ReadonlySet<string>, problems: string[]): void {
  const deriveTicks: { readonly moduleId: string; readonly tick: ModuleTick; readonly visible: ReadonlySet<string> }[] = [];
  const kindsDeclaredBy = new Map(modules.map((module) => [module.definition.id, module.declaredKinds] as const));
  const requiredBy = new Map(modules.map((module) => [module.definition.id, module.requiredModuleIds] as const));
  for (const module of modules) {
    const visibleModules = new Set<string>([module.definition.id]);
    const queue = [...module.requiredModuleIds];
    while (queue.length > 0) {
      const id = queue.pop()!;
      if (visibleModules.has(id)) continue;
      visibleModules.add(id);
      queue.push(...(requiredBy.get(id) ?? []));
    }
    const visible = new Set<string>();
    for (const id of visibleModules) {
      for (const kind of kindsDeclaredBy.get(id) ?? []) visible.add(kind);
    }
    for (const tick of module.instance.ticks) {
      if (tick.phase === "derive") deriveTicks.push({ moduleId: module.definition.id, tick, visible });
    }
  }

  deriveTicks.forEach(({ moduleId, tick, visible }, position) => {
    for (const kind of tick.subscribes ?? []) {
      if (!visible.has(kind) && !coreKinds.has(kind)) {
        problems.push(`module ${moduleId}: the derive tick ${tick.id} subscribes to ${kind}, which no module it requires declares`);
      }
      const later = deriveTicks.findIndex((other, otherPosition) => otherPosition > position && other.tick.writes.includes(kind));
      if (later >= 0) {
        problems.push(`module ${moduleId}: the derive tick ${tick.id} subscribes to ${kind}, which the later derive tick ${deriveTicks[later]!.tick.id} writes`);
      }
    }
  });
}

