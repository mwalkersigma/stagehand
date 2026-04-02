import { expectTypeOf } from "bun:test";
import { Command } from "@commander-js/extra-typings";
import { ProcessorBuilder } from "../modules/classes/processorBuilder";
import { Processor } from "../modules/classes/processor";
import { ExecutionContext } from "../modules/classes/executionContext";
import {
  CommandProcessorFactoryApi,
  CommandProcessorFactory,
  CommandProcessor,
  CommandDefinition,
  ExtractCommandOpts,
  Runtime,
} from "../modules/types";

// ─── Test setup: concrete Flags type and a Command parameterized with it ─────

type Flags = { dryRun: boolean; install: boolean; git: boolean };

type TestCmd = Command<[], Flags>;

// ─── Helper: extract TFlags from a ProcessorBuilder via its createShared ─────
//
// Classes with private fields defeat direct conditional-type extraction
// (e.g. `T extends ProcessorBuilder<any,any,infer F,…> ? F : never` yields `never`).
// Instead we look at the public `createShared` method signature, which exposes
// `Runtime<TFlags>` as the second parameter of its handler argument.
//
//   createShared<TNextShared>(
//     handler: (input: TInput, runtime: Runtime<TFlags>) => Awaitable<TNextShared>,
//   ): ProcessorBuilder<…>
//
// Parameters<GenericMethod> instantiates unconstrained type-params to `unknown`,
// but the concrete TFlags is preserved.

type ExtractBuilderFlags<TBuilder extends { createShared: (...args: any) => any }> =
  Parameters<Parameters<TBuilder["createShared"]>[0]>[1] extends Runtime<infer F> ? F : never;

// ─── Helper: extract TFlags from a Processor via its public `run` method ─────
//
//   run(input: TInput, runtime: Runtime<TFlags>, meta?: …): Promise<…>

type ExtractProcessorFlags<TProc extends { run: (...args: any) => any }> =
  Parameters<TProc["run"]>[1] extends Runtime<infer F> ? F : never;

// ═══════════════════════════════════════════════════════════════════════════════
// 1. ExtractCommandOpts extracts flags from a Command
//    Given Command<[], Flags>, ExtractCommandOpts should yield Flags.
// ═══════════════════════════════════════════════════════════════════════════════

type Test1_ExtractedOpts = ExtractCommandOpts<TestCmd>;

expectTypeOf<Test1_ExtractedOpts>().toEqualTypeOf<Flags>();

// ═══════════════════════════════════════════════════════════════════════════════
// 2. defineProcessor creates a builder with correct TFlags
//    CommandProcessorFactoryApi<TestCmd>.defineProcessor() returns a
//    ProcessorBuilder whose TFlags = ExtractCommandOpts<TestCmd> = Flags.
//    We verify by inspecting the createShared handler's runtime parameter.
// ═══════════════════════════════════════════════════════════════════════════════

type Test2_InitialBuilder = ReturnType<CommandProcessorFactoryApi<TestCmd>["defineProcessor"]>;

type Test2_Flags = ExtractBuilderFlags<Test2_InitialBuilder>;

expectTypeOf<Test2_Flags>().toEqualTypeOf<Flags>();

// Also verify the runtime parameter directly:
type Test2_CreateSharedHandler = Parameters<Test2_InitialBuilder["createShared"]>[0];
type Test2_RuntimeParam = Parameters<Test2_CreateSharedHandler>[1];

expectTypeOf<Test2_RuntimeParam>().toEqualTypeOf<Runtime<Flags>>();

// ═══════════════════════════════════════════════════════════════════════════════
// 3. TFlags preserved through .errors()
//    .errors<TNextRegistry>() changes TRegistry but must NOT alter TFlags.
//    We verify both by constructing the expected type and by inspecting the
//    return type of the actual .errors() method on the initial builder.
// ═══════════════════════════════════════════════════════════════════════════════

type TestRegistry = { NOT_FOUND: string; TIMEOUT: { message: string } };

// 3a. Manually constructed post-errors builder preserves TFlags:
type Test3_AfterErrors = ProcessorBuilder<[], never, Flags, TestRegistry, void, {}>;

type Test3a_Flags = ExtractBuilderFlags<Test3_AfterErrors>;

expectTypeOf<Test3a_Flags>().toEqualTypeOf<Flags>();

// 3b. The .errors() method's ReturnType on the initial builder also preserves TFlags.
//     ReturnType instantiates TNextRegistry with its constraint (ErrorRegistryInput).
type Test3_ErrorsReturn = ReturnType<ProcessorBuilder<[], never, Flags, {}, void, {}>["errors"]>;

type Test3b_Flags = ExtractBuilderFlags<Test3_ErrorsReturn>;

expectTypeOf<Test3b_Flags>().toEqualTypeOf<Flags>();

// ═══════════════════════════════════════════════════════════════════════════════
// 4. TFlags preserved through .createShared()
//    .createShared<TNextShared>() changes TShared but must NOT alter TFlags.
//    We verify via the finalize handler's ExecutionContext.
// ═══════════════════════════════════════════════════════════════════════════════

type SharedData = { projectRoot: string; config: Record<string, unknown> };

// 4a. Manually constructed post-createShared builder:
type Test4_AfterCreateShared = ProcessorBuilder<[], SharedData, Flags, TestRegistry, void, {}>;

// Inspect via the finalize handler's context parameter:
type Test4_FinalizeHandler = Parameters<Test4_AfterCreateShared["finalize"]>[0];
type Test4_FinalizeCtx = Parameters<Test4_FinalizeHandler>[0];
type Test4a_Flags = Test4_FinalizeCtx["runtime"]["flags"];

expectTypeOf<Test4a_Flags>().toEqualTypeOf<Flags>();

// 4b. The .createShared() method's ReturnType on the post-errors builder:
//     ReturnType instantiates TNextShared with unknown, but TFlags is preserved.
type Test4_CSReturn = ReturnType<Test3_AfterErrors["createShared"]>;
type Test4_CSReturnFinalizeHandler = Parameters<Test4_CSReturn["finalize"]>[0];
type Test4_CSReturnFinalizeCtx = Parameters<Test4_CSReturnFinalizeHandler>[0];
type Test4b_Flags = Test4_CSReturnFinalizeCtx["runtime"]["flags"];

expectTypeOf<Test4b_Flags>().toEqualTypeOf<Flags>();

// ═══════════════════════════════════════════════════════════════════════════════
// 5. createShared callback receives Runtime<Flags>
//    The handler passed to .createShared() must receive Runtime<Flags> as its
//    second argument, ensuring flags are available when building shared state.
// ═══════════════════════════════════════════════════════════════════════════════

// Extract the handler parameter type from the post-errors builder's createShared:
type Test5_CSHandler = Parameters<Test3_AfterErrors["createShared"]>[0];
type Test5_RuntimeParam = Parameters<Test5_CSHandler>[1];

expectTypeOf<Test5_RuntimeParam>().toEqualTypeOf<Runtime<Flags>>();

// Verify Runtime<Flags> has the expected flags property:
type Test5_FlagsFromRuntime = Test5_RuntimeParam["flags"];

expectTypeOf<Test5_FlagsFromRuntime>().toEqualTypeOf<Flags>();

// ═══════════════════════════════════════════════════════════════════════════════
// 6. TFlags preserved through .stage()
//    .stage() extends TStages with a new stage definition but must NOT alter
//    TFlags. We verify by checking the return type's finalize handler context.
// ═══════════════════════════════════════════════════════════════════════════════

// ReturnType instantiates stage's generic params (TStageId→string, etc.)
// but TFlags is concrete and unchanged.
type Test6_StageReturn = ReturnType<Test4_AfterCreateShared["stage"]>;

// Check via the finalize handler's context:
type Test6_FinalizeHandler = Parameters<Test6_StageReturn["finalize"]>[0];
type Test6_FinalizeCtx = Parameters<Test6_FinalizeHandler>[0];
type Test6_Flags = Test6_FinalizeCtx["runtime"]["flags"];

expectTypeOf<Test6_Flags>().toEqualTypeOf<Flags>();

// Also verify via createShared on the returned builder:
type Test6_FlagsViaCS = ExtractBuilderFlags<Test6_StageReturn>;

expectTypeOf<Test6_FlagsViaCS>().toEqualTypeOf<Flags>();

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Step run callback gets correct flags via ExecutionContext
//    ExecutionContext<TInput, TShared, TFlags, TRegistry, TStages> exposes
//    runtime: Runtime<TFlags>, and runtime.flags must equal Flags.
// ═══════════════════════════════════════════════════════════════════════════════

type Test7_ExecCtx = ExecutionContext<[], never, Flags, {}, {}>;

type Test7_CtxRuntime = Test7_ExecCtx["runtime"];

expectTypeOf<Test7_CtxRuntime>().toEqualTypeOf<Runtime<Flags>>();

type Test7_CtxFlags = Test7_ExecCtx["runtime"]["flags"];

expectTypeOf<Test7_CtxFlags>().toEqualTypeOf<Flags>();

// Verify with the full registry/shared combination too:
type Test7_FullExecCtx = ExecutionContext<[], SharedData, Flags, TestRegistry, {}>;

type Test7_FullCtxFlags = Test7_FullExecCtx["runtime"]["flags"];

expectTypeOf<Test7_FullCtxFlags>().toEqualTypeOf<Flags>();

// ═══════════════════════════════════════════════════════════════════════════════
// 8. TFlags preserved through .finalize()
//    .finalize<TNextResult>() changes TResult but must NOT alter TFlags.
//    We verify via the build() return type's run method.
// ═══════════════════════════════════════════════════════════════════════════════

type FinalizeResult = { success: boolean; summary: string };

// 8a. Manually constructed post-finalize builder:
type Test8_AfterFinalize = ProcessorBuilder<[], SharedData, Flags, TestRegistry, FinalizeResult, {}>;

// Check that build()'s Processor still carries TFlags through its run method:
type Test8_BuildReturn = ReturnType<Test8_AfterFinalize["build"]>;
type Test8a_Flags = ExtractProcessorFlags<Test8_BuildReturn>;

expectTypeOf<Test8a_Flags>().toEqualTypeOf<Flags>();

// 8b. The .finalize() method's ReturnType on the post-createShared builder:
type Test8_FinalizeReturn = ReturnType<Test4_AfterCreateShared["finalize"]>;
type Test8_FinalizeReturnBuild = ReturnType<Test8_FinalizeReturn["build"]>;
type Test8b_Flags = ExtractProcessorFlags<Test8_FinalizeReturnBuild>;

expectTypeOf<Test8b_Flags>().toEqualTypeOf<Flags>();

// 8c. Also verify the finalize handler itself receives ExecutionContext with Flags:
type Test8_FinalizeHandlerParam = Parameters<Test4_AfterCreateShared["finalize"]>[0];
type Test8_FinalizeHandlerCtx = Parameters<Test8_FinalizeHandlerParam>[0];
type Test8c_Flags = Test8_FinalizeHandlerCtx["runtime"]["flags"];

expectTypeOf<Test8c_Flags>().toEqualTypeOf<Flags>();

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Built Processor has correct TFlags
//    The Processor produced by .build() must carry TFlags = Flags, which is
//    observable through its run() method's Runtime parameter.
// ═══════════════════════════════════════════════════════════════════════════════

type Test9_BuiltProcessor = Processor<[], SharedData, Flags, TestRegistry, FinalizeResult, {}>;

// 9a. Extract flags via the run method's runtime parameter:
type Test9_RunRuntime = Parameters<Test9_BuiltProcessor["run"]>[1];

expectTypeOf<Test9_RunRuntime>().toEqualTypeOf<Runtime<Flags>>();

// 9b. Extract flags via the helper:
type Test9_Flags = ExtractProcessorFlags<Test9_BuiltProcessor>;

expectTypeOf<Test9_Flags>().toEqualTypeOf<Flags>();

// 9c. Verify run's input parameter matches the command's args:
type Test9_RunInput = Parameters<Test9_BuiltProcessor["run"]>[0];

expectTypeOf<Test9_RunInput>().toEqualTypeOf<[]>();

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Processor satisfies CommandProcessor<TestCmd>
//     The built Processor must be structurally assignable to
//     CommandProcessor<TestCmd>, proving the full type chain from
//     Command → ExtractCommandOpts → ProcessorBuilder → Processor is coherent.
// ═══════════════════════════════════════════════════════════════════════════════

expectTypeOf<Test9_BuiltProcessor>().toMatchTypeOf<CommandProcessor<TestCmd>>();

// Also verify the Processor obtained from the builder chain satisfies CommandProcessor:
expectTypeOf<Test8_BuildReturn>().toMatchTypeOf<CommandProcessor<TestCmd>>();

// ═══════════════════════════════════════════════════════════════════════════════
// 11. End-to-end: CommandDefinition handler is a factory callback that threads
//     flags from the command into the ProcessorBuilder.
//
//     When `build` returns Command<[], Flags>, the `handler` field should be
//     CommandProcessorFactory<Command<[], Flags>>, meaning the callback receives
//     a CommandProcessorFactoryApi whose defineProcessor creates a builder
//     pre-typed with TFlags = Flags.
// ═══════════════════════════════════════════════════════════════════════════════

// The CommandDefinition for our test command:
type Test11_CmdDef = CommandDefinition<"build", TestCmd>;

// The handler field must be a factory callback:
type Test11_HandlerField = Test11_CmdDef["handler"];

expectTypeOf<Test11_HandlerField>().toEqualTypeOf<CommandProcessorFactory<TestCmd>>();

// The factory callback's parameter is CommandProcessorFactoryApi<TestCmd>:
type Test11_FactoryParam = Parameters<Test11_HandlerField>[0];

expectTypeOf<Test11_FactoryParam>().toEqualTypeOf<CommandProcessorFactoryApi<TestCmd>>();

// defineProcessor on that API creates a builder whose TFlags = Flags:
type Test11_Builder = ReturnType<Test11_FactoryParam["defineProcessor"]>;
type Test11_BuilderFlags = ExtractBuilderFlags<Test11_Builder>;

expectTypeOf<Test11_BuilderFlags>().toEqualTypeOf<Flags>();
