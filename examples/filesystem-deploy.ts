/**
 * ┌────────────────────────────────────────────────────────────────────┐
 * │  Virtual Filesystem Deploy — Comprehensive Stagehand Example      │
 * └────────────────────────────────────────────────────────────────────┘
 *
 * This example demonstrates ALL major features of the Stagehand Script
 * Framework using a virtual (in-memory) file system to simulate a folder
 * copy/deploy operation.
 *
 * KEY DEMONSTRATION:
 *   - SUCCESS path → files appear in the virtual FS, manifest is generated
 *   - FAILURE path → compensation runs, virtual FS is cleaned up (no files)
 *
 * ── Features Demonstrated ─────────────────────────────────────────────
 *
 *  #  │ Feature                                    │ Skill
 * ────┼────────────────────────────────────────────┼───────────────────────────
 *  1  │ ScriptApp with .meta()                     │ scaffold-cli-app
 *  2  │ Multiple CLI commands                      │ scaffold-cli-app
 *  3  │ Typed flags (addOption, choices, mandatory) │ scaffold-cli-app
 *  4  │ Typed error registry + ctx.fail()          │ compensation-and-rollback
 *  5  │ createShared() for derived state           │ define-processor
 *  6  │ Sequential stages                          │ define-processor
 *  7  │ Parallel stages (.parallel())              │ define-processor
 *  8  │ Conditional steps (when() guards)          │ define-processor
 *  9  │ All step effects (read/create/update/      │ define-processor
 *     │   delete/external)                         │
 * 10  │ Compensation policies (none/best-effort/   │ compensation-and-rollback
 *     │   required)                                │
 * 11  │ Artifact-driven rollback                   │ compensation-and-rollback
 * 12  │ Stage artifacts via .buildArtifact()       │ define-processor
 * 13  │ Stage-level compensation                   │ compensation-and-rollback
 * 14  │ Collapse levels (stage/tasks/none)         │ theming-and-output
 * 15  │ In-flight feedback (setTaskTitle, etc.)    │ theming-and-output
 * 16  │ Dry-run mode via ctx.isDryRun()            │ define-processor
 * 17  │ Shell execution via ctx.$()                │ migrate-from-bash
 * 18  │ Text formatting (Bold, colors, gradient)   │ theming-and-output
 * 19  │ ProcessorResult inspection                 │ compensation-and-rollback
 * 20  │ Custom theme override (.theme())           │ theming-and-output
 * 21  │ getStepArtifact() / getStageArtifact()     │ define-processor
 *
 * ── Usage ─────────────────────────────────────────────────────────────
 *
 *   # Successful deploy (files appear in virtual FS)
 *   bun run examples/filesystem-deploy.ts deploy -s /mock/project --dest /deploy/out
 *
 *   # Dry-run mode (no actual changes to virtual FS)
 *   bun run examples/filesystem-deploy.ts deploy -s /mock/project --dest /deploy/out --dry-run
 *
 *   # Simulate failure at copy stage (triggers compensation/rollback)
 *   bun run examples/filesystem-deploy.ts deploy -s /mock/project --dest /deploy/out --fail-at copy
 *
 *   # Simulate failure at directory creation stage
 *   bun run examples/filesystem-deploy.ts deploy -s /mock/project --dest /deploy/out --fail-at mkdir
 *
 *   # With task-level collapse (hide individual steps after completion)
 *   bun run examples/filesystem-deploy.ts deploy -s /mock/project --dest /deploy/out --collapse tasks
 *
 *   # Skip verification step
 *   bun run examples/filesystem-deploy.ts deploy -s /mock/project --dest /deploy/out --no-verify
 *
 *   # Status command — inspect the virtual file system
 *   bun run examples/filesystem-deploy.ts status --format json
 *   bun run examples/filesystem-deploy.ts status --format table --path demo
 */

// ═══════════════════════════════════════════════════════════════════════════
// Imports
// ═══════════════════════════════════════════════════════════════════════════

import { ScriptApp } from "../modules/classes/appScript";
// CRITICAL: Import Option from '@commander-js/extra-typings', NOT 'commander'.
// Using the wrong import kills type inference on flags.
import { Option } from "@commander-js/extra-typings";
// Feature 18: Text formatting utilities — all are (text: string) => string
import { Bold, green, red, yellow, blue, darkGray, GradientText } from "../modules/textFormatting";
import type { ScriptTheme } from "../modules/types";


// ═══════════════════════════════════════════════════════════════════════════
// Virtual File System
// ═══════════════════════════════════════════════════════════════════════════
//
// An in-memory file system used to demonstrate side effects and rollback
// without touching the real disk.
//
// SUCCESS → files appear in the VFS after deploy
// FAILURE → compensation cleans up, VFS is empty (no destination files)

class VirtualFS {
  private files = new Map<string, string>();

  exists(path: string): boolean {
    return this.files.has(path);
  }

  isDirectory(path: string): boolean {
    const normalized = path.endsWith("/") ? path : path + "/";
    return this.files.has(normalized);
  }

  mkdir(path: string): void {
    const normalized = path.endsWith("/") ? path : path + "/";
    this.files.set(normalized, "[directory]");
  }

  writeFile(path: string, content: string): void {
    this.files.set(path, content);
  }

  readFile(path: string): string | undefined {
    return this.files.get(path);
  }

  remove(path: string): boolean {
    let removed = this.files.delete(path);
    const alt = path.endsWith("/") ? path.slice(0, -1) : path + "/";
    removed = this.files.delete(alt) || removed;
    return removed;
  }

  removeTree(basePath: string): string[] {
    const removed: string[] = [];
    const prefix = basePath.endsWith("/") ? basePath : basePath + "/";
    for (const key of [...this.files.keys()]) {
      if (key === prefix || key.startsWith(prefix)) {
        this.files.delete(key);
        removed.push(key);
      }
    }
    return removed;
  }

  listAll(): Array<{ path: string; content: string }> {
    return Array.from(this.files.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, content]) => ({ path, content }));
  }

  get size(): number {
    return this.files.size;
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// Seed Data
// ═══════════════════════════════════════════════════════════════════════════

// Global VFS instance — shared across the process
const vfs = new VirtualFS();

/** Seeds mock source files into the virtual FS. */
function seedSourceFiles(sourcePath: string): void {
  const base = sourcePath.endsWith("/") ? sourcePath : sourcePath + "/";
  vfs.mkdir(base);
  vfs.mkdir(base + "src/");
  vfs.mkdir(base + "src/components/");
  vfs.mkdir(base + "assets/");
  vfs.writeFile(base + "index.ts", 'export default function main() { console.log("hello"); }');
  vfs.writeFile(base + "src/app.ts", 'import main from "../index";\nmain();');
  vfs.writeFile(base + "src/components/Button.ts", 'export const Button = () => "click me";');
  vfs.writeFile(base + "assets/logo.png", "[binary:89504e470d0a1a0a]");
  vfs.writeFile(base + "assets/style.css", "body { margin: 0; padding: 0; }");
  vfs.writeFile(base + "README.md", "# Mock Project\nA demo project for the Stagehand framework.");
}


// ═══════════════════════════════════════════════════════════════════════════
// Application
// ═══════════════════════════════════════════════════════════════════════════

await new ScriptApp("fs-deploy")

  // ── Feature 1: Metadata via .meta() ─────────────────────────────────
  // Displayed in the header box printed at the start of each run.
  .meta({
    company: "Stagehand Examples",
    author: "Framework Demo",
    version: "1.0.0",
  })

  // ── Feature 20: Custom theme override via .theme() ──────────────────
  // .theme() deep-merges with DEFAULT_THEME — only supply overrides.
  //
  // CRITICAL: Colors are FUNCTIONS (text: string) => string, never strings.
  //           gradient is the ONE exception: [string, string] hex tuple.
  .theme({
    colors: {
      primary: blue,
      accent: green,
      warning: yellow,
      error: red,
      gradient: ["#00BFFF", "#FF6347"], // Deep sky blue → Tomato
    },
    headerStyle: "fancy", // Bordered header box
  } as ScriptTheme)


  // ═══════════════════════════════════════════════════════════════════════
  // ── Feature 2: Multiple CLI Commands ────────────────────────────────
  // Each .command() registers a separate CLI subcommand with its own
  // independently typed flags and its own processor.
  // ═══════════════════════════════════════════════════════════════════════


  // ┌──────────────────────────────────────────────────────────────────────┐
  // │  COMMAND 1: deploy                                                  │
  // │  Copy files from source → destination in a virtual file system.     │
  // │  This is the comprehensive showcase demonstrating all features.     │
  // └──────────────────────────────────────────────────────────────────────┘
  .command({
    name: "deploy",
    description: "Copy files from source to destination in a virtual file system",

    // ── Feature 3: Typed flags via addOption(new Option(...)) ──────────
    // MUST use @commander-js/extra-typings Option for full type inference.
    // Using .addOption(new Option(...)) instead of .option() gives proper
    // type narrowing on ctx.runtime.flags.
    build: (cmd) =>
      cmd
        // Boolean flag with default value
        .addOption(
          new Option("-d, --dry-run", "Simulate without making changes")
            .default(false, "false"),
        )
        // Mandatory string option — user must supply a value
        .addOption(
          new Option("-s, --source <path>", "Source directory path")
            .makeOptionMandatory(),
        )
        // Another mandatory string option
        .addOption(
          new Option("--dest <path>", "Destination directory path")
            .makeOptionMandatory(),
        )
        // Choices with constrained literal type
        .addOption(
          new Option("--collapse <level>", "Task collapse level")
            .choices(["stage", "tasks", "none"] as const)
            .default("none" as const),
        )
        // Simple boolean flag
        .addOption(
          new Option("-v, --verbose", "Enable verbose output")
            .default(false),
        )
        // Negatable boolean: --no-verify sets flags.verify = false
        .addOption(
          new Option("--no-verify", "Skip post-copy verification"),
        )
        // Choices for simulating failures (demo only)
        .addOption(
          new Option("--fail-at <stage>", "Simulate failure at a stage (for demo)")
            .choices(["validate", "mkdir", "copy", "manifest", "none"] as const)
            .default("none" as const),
        ),

    handler: ({ defineProcessor }) =>
      defineProcessor({
        id: "deploy-processor",
        title: "Virtual FS Deploy",
      })

        // ── Feature 4: Typed error registry ───────────────────────────
        // Define error codes upfront. ctx.fail('CODE') autocompletes and
        // throws a typed FrameworkError. NEVER throw raw Error — use the
        // registry to keep errors consistent and typed.
        .errors({
          SOURCE_NOT_FOUND: "Source directory does not exist in virtual FS",
          DEST_ALREADY_EXISTS: "Destination directory already exists",
          MKDIR_FAILED: "Failed to create directory in virtual FS",
          COPY_FAILED: "File copy operation failed",
          VERIFY_FAILED: "Post-copy verification failed",
          MANIFEST_FAILED: "Failed to generate deployment manifest",
        })

        // ── Feature 5: createShared() for derived state ───────────────
        // Runs once before any stages execute. Derive computed state
        // from input and flags. Available in every step via ctx.shared.
        .createShared(async (_input, runtime) => {
          // Seed mock source files into the virtual FS
          seedSourceFiles(runtime.flags.source);

          const sourceBase = runtime.flags.source.endsWith("/")
            ? runtime.flags.source
            : runtime.flags.source + "/";
          const destBase = runtime.flags.dest.endsWith("/")
            ? runtime.flags.dest
            : runtime.flags.dest + "/";

          // Seed a stale lock file to demonstrate the delete effect
          vfs.writeFile(destBase + ".deploy.lock", "locked-by-previous-run");

          // Discover source files and directories
          const allEntries = vfs.listAll().filter(f => f.path.startsWith(sourceBase));
          const sourceFiles = allEntries.filter(f => f.content !== "[directory]");
          const sourceDirs = allEntries.filter(f => f.content === "[directory]");

          return {
            startedAt: new Date().toISOString(),
            sourceBase,
            destBase,
            sourceFiles,
            sourceDirs,
            vfs, // Pass VFS through shared state so steps can access it
          };
        })


        // ───────────────────────────────────────────────────────────────
        // STAGE 1: Validate Environment
        // ───────────────────────────────────────────────────────────────
        // Features: 7 (parallel), 8 (when guard), 9 (read effect),
        //           10 (compensation: none), 14 (collapse: tasks),
        //           15 (in-flight feedback)
        .stage("validate", "Validate Environment", (stage) =>
          stage
            // ── Feature 7: Parallel execution ──────────────────────
            // Steps in this stage fire simultaneously, gathered with
            // Promise.allSettled by the processor.
            .parallel()
            // ── Feature 14: Collapse level — 'tasks' ──────────────
            // Individual steps are hidden after completion; the stage
            // title stays visible.
            .collapse("tasks")

            // Step: Validate source exists
            .step({
              id: "check-source",
              title: "Verify source directory",
              // ── Feature 9: Read effect ──────────────────────────
              // Read-only — no side effects, no compensation needed.
              effect: "read",
              // ── Feature 10: Compensation policy — 'none' ────────
              // Correct for read effects: nothing to undo.
              compensation: { kind: "none" },

              run: async (ctx) => {
                await new Promise(r => setTimeout(r, 300));
                // ── Feature 15: In-flight feedback ────────────────
                ctx.setTaskStatus("scanning...");

                const exists = ctx.shared.vfs.isDirectory(ctx.shared.sourceBase);
                if (!exists) {
                  // ── Feature 4: ctx.fail() with typed error code ─
                  // Throws FrameworkError with code 'SOURCE_NOT_FOUND'.
                  ctx.fail("SOURCE_NOT_FOUND", `Path: ${ctx.shared.sourceBase}`);
                }

                // Simulate validate failure for demo
                if (ctx.runtime.flags.failAt === "validate") {
                  ctx.fail("SOURCE_NOT_FOUND", "Simulated validation failure");
                }

                const fileCount = ctx.shared.sourceFiles.length;
                const dirCount = ctx.shared.sourceDirs.length;

                // ── Feature 15: Update task title and output ──────
                ctx.setTaskTitle("✓ Source directory verified");
                ctx.setTaskOutput(`Found ${fileCount} files in ${dirCount} directories`);

                return {
                  artifact: { fileCount, dirCount, path: ctx.shared.sourceBase },
                };
              },
            })

            // Step: Check destination is empty (conditional)
            .step({
              id: "check-dest",
              title: "Verify destination is clear",
              effect: "read",
              compensation: { kind: "none" },

              // ── Feature 8: Conditional step with when() guard ───
              // This step is SKIPPED when --no-verify is passed.
              // Returning false from when() skips the step entirely.
              when: (ctx) => ctx.runtime.flags.verify !== false,

              run: async (ctx) => {
                await new Promise(r => setTimeout(r, 200));
                // The stale lock file exists, but not a directory — that's OK
                const dirExists = ctx.shared.vfs.isDirectory(ctx.shared.destBase);
                if (dirExists) {
                  ctx.fail("DEST_ALREADY_EXISTS", `Path: ${ctx.shared.destBase}`);
                }
                ctx.setTaskTitle("✓ Destination is clear");
                return { artifact: { clear: true } };
              },
            })

            // Step: Check available space (simulated)
            .step({
              id: "check-space",
              title: "Check available space",
              effect: "read",
              compensation: { kind: "none" },

              run: async (ctx) => {
                await new Promise(r => setTimeout(r, 150));
                const totalSize = ctx.shared.sourceFiles
                  .reduce((sum, f) => sum + f.content.length, 0);
                ctx.setTaskOutput(`Required: ${totalSize} bytes — Available: ∞`);
                ctx.setTaskTitle("✓ Space check passed");
                return { artifact: { requiredBytes: totalSize } };
              },
            })
        )


        // ───────────────────────────────────────────────────────────────
        // STAGE 2: Prepare Destination
        // ───────────────────────────────────────────────────────────────
        // Features: 6 (sequential), 9 (delete + create effects),
        //           10+11 (required & best-effort compensation w/ artifacts),
        //           12 (stage artifact), 13 (stage compensation),
        //           14 (collapse: none), 16 (dry-run mode)
        .stage("prepare", "Prepare Destination", (stage) =>
          stage
            // ── Feature 14: Collapse level — 'none' ───────────────
            // Everything stays visible — useful for important stages.
            .collapse("none")

            // Step: Remove stale lock file from a previous run
            .step({
              id: "clean-stale",
              title: "Remove stale lock files",
              // ── Feature 9: Delete effect ────────────────────────
              // Deleting resources requires compensation to restore them.
              effect: "delete",
              // ── Feature 10: Required compensation ───────────────
              // The compensate handler MUST exist for 'required' policy.
              // If missing, a CompensationFailure is recorded.
              compensation: { kind: "required" },

              run: async (ctx) => {
                const lockPath = ctx.shared.destBase + ".deploy.lock";
                let removedContent: string | undefined;

                // ── Feature 16: Dry-run mode ──────────────────────
                // ctx.isDryRun() checks flags.dryRun. When true, skip
                // side effects and log what WOULD have happened.
                if (ctx.isDryRun()) {
                  ctx.setTaskOutput(`[dry-run] Would remove: ${lockPath}`);
                  return { artifact: { removed: false, lockPath, previousContent: undefined } };
                }

                if (ctx.shared.vfs.exists(lockPath)) {
                  // Save the content before deleting — needed for rollback
                  removedContent = ctx.shared.vfs.readFile(lockPath);
                  ctx.shared.vfs.remove(lockPath);
                  ctx.setTaskTitle("✓ Removed stale lock file");
                  ctx.setTaskOutput(lockPath);
                } else {
                  ctx.setTaskTitle("✓ No stale lock files found");
                }

                return {
                  artifact: {
                    removed: removedContent !== undefined,
                    lockPath,
                    previousContent: removedContent,
                  },
                };
              },

              // ── Feature 11: Artifact-driven rollback ────────────
              // Use the artifact to know exactly WHAT was deleted
              // and restore it. Never hardcode values.
              compensate: async (ctx, artifact) => {
                if (artifact.removed && artifact.previousContent !== undefined) {
                  ctx.shared.vfs.writeFile(artifact.lockPath, artifact.previousContent);
                  ctx.runtime.log.info(`  ↩ Restored lock file: ${artifact.lockPath}`);
                }
              },
            })

            // Step: Create root destination directory
            .step({
              id: "create-root",
              title: "Create destination root",
              // ── Feature 9: Create effect ────────────────────────
              effect: "create",
              // ── Feature 10: Required compensation ───────────────
              compensation: { kind: "required" },

              run: async (ctx) => {
                if (ctx.isDryRun()) {
                  ctx.setTaskOutput(`[dry-run] Would create: ${ctx.shared.destBase}`);
                  return { artifact: { created: false, path: ctx.shared.destBase } };
                }

                // Simulate failure for demo
                if (ctx.runtime.flags.failAt === "mkdir") {
                  ctx.fail("MKDIR_FAILED", "Simulated mkdir failure");
                }

                ctx.shared.vfs.mkdir(ctx.shared.destBase);
                ctx.setTaskTitle("✓ Created destination root");
                ctx.setTaskOutput(ctx.shared.destBase);
                return { artifact: { created: true, path: ctx.shared.destBase } };
              },

              // ── Feature 11: Artifact-driven rollback ────────────
              compensate: async (ctx, artifact) => {
                if (artifact.created) {
                  ctx.shared.vfs.remove(artifact.path);
                  ctx.runtime.log.info(`  ↩ Removed directory: ${artifact.path}`);
                }
              },
            })

            // Step: Create subdirectories (mirrors source structure)
            .step({
              id: "create-subdirs",
              title: "Mirror subdirectories",
              effect: "create",
              // ── Feature 10: Best-effort compensation ─────────────
              // Tries to undo on failure. If the compensate handler
              // itself throws, the error is recorded but doesn't stop
              // the compensation phase.
              compensation: { kind: "best-effort" },

              run: async (ctx) => {
                const createdPaths: string[] = [];

                if (ctx.isDryRun()) {
                  for (const dir of ctx.shared.sourceDirs) {
                    const relative = dir.path.slice(ctx.shared.sourceBase.length);
                    ctx.setTaskOutput(`[dry-run] Would create: ${ctx.shared.destBase}${relative}`);
                  }
                  return { artifact: { created: false, paths: createdPaths } };
                }

                for (const dir of ctx.shared.sourceDirs) {
                  const relative = dir.path.slice(ctx.shared.sourceBase.length);
                  const destPath = ctx.shared.destBase + relative;
                  ctx.shared.vfs.mkdir(destPath);
                  createdPaths.push(destPath);
                  // ── Feature 15: Progress updates ────────────────
                  ctx.setTaskOutput(`Created: ${destPath}`);
                  await new Promise(r => setTimeout(r, 100));
                }

                ctx.setTaskTitle(`✓ Mirrored ${createdPaths.length} subdirectories`);
                return { artifact: { created: true, paths: createdPaths } };
              },

              compensate: async (ctx, artifact) => {
                if (artifact.created) {
                  // Remove deepest directories first
                  for (const p of [...artifact.paths].reverse()) {
                    ctx.shared.vfs.remove(p);
                  }
                  ctx.runtime.log.info(`  ↩ Removed ${artifact.paths.length} subdirectories`);
                }
              },
            })

            // ── Feature 12: Stage artifact via .buildArtifact() ───
            // Runs after all steps in this stage complete. Produces a
            // summary artifact accessible via ctx.getStageArtifact().
            .buildArtifact(async (ctx) => {
              const root = ctx.getStepArtifact("prepare", "create-root");
              const subdirs = ctx.getStepArtifact("prepare", "create-subdirs");
              return {
                rootCreated: root.created,
                totalDirs: subdirs.paths.length + (root.created ? 1 : 0),
                allPaths: [
                  ...(root.created ? [root.path] : []),
                  ...subdirs.paths,
                ],
              };
            })

            // ── Feature 13: Stage-level compensation ──────────────
            // Runs during rollback AFTER individual step compensators
            // for this stage have run. Use for aggregate cleanup.
            // Note: TStageArtifact isn't inferred through .buildArtifact()
            // since it returns `this`, so we cast the artifact here.
            .compensate(async (ctx, artifact) => {
              const typed = artifact as { rootCreated: boolean; totalDirs: number; allPaths: string[] } | undefined;
              if (typed && typed.rootCreated) {
                const removed = ctx.shared.vfs.removeTree(ctx.shared.destBase);
                ctx.runtime.log.info(
                  `  ↩ Stage cleanup: removed ${removed.length} entries from ${ctx.shared.destBase}`,
                );
              }
            })
        )


        // ───────────────────────────────────────────────────────────────
        // STAGE 3: Copy Files
        // ───────────────────────────────────────────────────────────────
        // Features: 6 (sequential), 9 (create + update effects),
        //           10+11 (artifact-driven compensation),
        //           15 (real-time progress), 16 (dry-run)
        .stage("copy-files", "Copy Files", (stage) =>
          stage

            // Step: Copy all source files to destination
            .step({
              id: "copy-source-files",
              title: "Copy source files to destination",
              effect: "create",
              compensation: { kind: "best-effort" },

              run: async (ctx) => {
                const copiedFiles: Array<{ src: string; dest: string }> = [];

                if (ctx.isDryRun()) {
                  for (const file of ctx.shared.sourceFiles) {
                    const relative = file.path.slice(ctx.shared.sourceBase.length);
                    ctx.setTaskOutput(`[dry-run] Would copy: ${relative}`);
                  }
                  return { artifact: { copied: false, files: copiedFiles } };
                }

                // Simulate PARTIAL failure for demo: copy some files, then fail.
                // This demonstrates that compensation rolls back only what was done.
                if (ctx.runtime.flags.failAt === "copy") {
                  const partial = ctx.shared.sourceFiles.slice(0, 2);
                  for (const file of partial) {
                    const relative = file.path.slice(ctx.shared.sourceBase.length);
                    const destPath = ctx.shared.destBase + relative;
                    ctx.shared.vfs.writeFile(destPath, file.content);
                    copiedFiles.push({ src: file.path, dest: destPath });
                  }
                  // ctx.fail() throws a typed FrameworkError
                  ctx.fail("COPY_FAILED", "Simulated copy failure after partial transfer");
                }

                let copied = 0;
                for (const file of ctx.shared.sourceFiles) {
                  const relative = file.path.slice(ctx.shared.sourceBase.length);
                  const destPath = ctx.shared.destBase + relative;
                  ctx.shared.vfs.writeFile(destPath, file.content);
                  copiedFiles.push({ src: file.path, dest: destPath });
                  copied++;
                  // ── Feature 15: Real-time progress ──────────────
                  ctx.setTaskOutput(
                    `Copied ${copied}/${ctx.shared.sourceFiles.length}: ${relative}`,
                  );
                  await new Promise(r => setTimeout(r, 150));
                }

                ctx.setTaskTitle(`✓ Copied ${copiedFiles.length} files`);
                return { artifact: { copied: true, files: copiedFiles } };
              },

              // ── Feature 11: Artifact-driven compensation ────────
              // The artifact tells us exactly which files were copied,
              // so we can remove precisely those on rollback.
              compensate: async (ctx, artifact) => {
                if (artifact.files.length > 0) {
                  for (const f of artifact.files) {
                    ctx.shared.vfs.remove(f.dest);
                  }
                  ctx.runtime.log.info(
                    `  ↩ Removed ${artifact.files.length} copied files`,
                  );
                }
              },
            })

            // Step: Write deployment metadata
            .step({
              id: "write-metadata",
              title: "Write deployment metadata",
              // ── Feature 9: Update effect ────────────────────────
              // Represents modifying existing state/resources.
              effect: "update",
              compensation: { kind: "best-effort" },

              run: async (ctx) => {
                await new Promise(r => setTimeout(r, 100));
                const timestamp = new Date().toISOString();
                const metadataPath = ctx.shared.destBase + ".deploy-meta";

                if (!ctx.isDryRun()) {
                  ctx.shared.vfs.writeFile(
                    metadataPath,
                    JSON.stringify({
                      deployedAt: timestamp,
                      source: ctx.shared.sourceBase,
                      dryRun: false,
                    }),
                  );
                }

                ctx.setTaskTitle("✓ Metadata written");
                return { artifact: { timestamp, path: metadataPath } };
              },

              compensate: async (ctx, artifact) => {
                ctx.shared.vfs.remove(artifact.path);
                ctx.runtime.log.info(`  ↩ Removed metadata: ${artifact.path}`);
              },
            })
        )


        // ───────────────────────────────────────────────────────────────
        // STAGE 4: Generate Manifest
        // ───────────────────────────────────────────────────────────────
        // Features: 14 (collapse: 'stage'), 17 (ctx.$()),
        //           21 (getStepArtifact + getStageArtifact)
        .stage("manifest", "Generate Deployment Manifest", (stage) =>
          stage
            // ── Feature 14: Collapse level — 'stage' ──────────────
            // The ENTIRE stage (including children) is hidden after
            // it completes. Good for housekeeping stages.
            .collapse("stage")

            .step({
              id: "write-manifest",
              title: "Write deployment manifest",
              effect: "create",
              compensation: { kind: "required" },

              run: async (ctx) => {
                await new Promise(r => setTimeout(r, 300));

                if (ctx.runtime.flags.failAt === "manifest") {
                  ctx.fail("MANIFEST_FAILED", "Simulated manifest failure");
                }

                // ── Feature 21: Access previous step and stage artifacts ──
                //
                // getStageArtifact<T>(stageId) — retrieves the stage-level
                // artifact built by .buildArtifact() in the prepare stage.
                const dirInfo = ctx.getStageArtifact<{
                  rootCreated: boolean;
                  totalDirs: number;
                  allPaths: string[];
                }>("prepare");

                // getStepArtifact(stageId, stepId) — retrieves the artifact
                // from a specific step. Both IDs autocomplete via generics.
                const copyInfo = ctx.getStepArtifact("copy-files", "copy-source-files");

                const manifest = {
                  deployedAt: ctx.shared.startedAt,
                  source: ctx.shared.sourceBase,
                  destination: ctx.shared.destBase,
                  directoriesCreated: dirInfo.totalDirs,
                  filesCopied: copyInfo.files.length,
                  dryRun: ctx.isDryRun(),
                };

                const manifestPath = ctx.shared.destBase + "MANIFEST.json";
                if (!ctx.isDryRun()) {
                  ctx.shared.vfs.writeFile(
                    manifestPath,
                    JSON.stringify(manifest, null, 2),
                  );
                }

                // ── Feature 17: Shell execution via ctx.$() ───────
                // ctx.$() wraps execa. It's dry-run aware: when
                // isDryRun() is true, it logs and returns a noop result.
                //
                // In a real script, you'd run actual shell commands:
                //   const hash = await ctx.$('sha256sum', [manifestPath]);
                //
                // For this demo, we run 'echo' to show the API:
                if (ctx.runtime.flags.verbose) {
                  await ctx.$("echo", ["Manifest generated at", manifestPath]);
                }

                ctx.setTaskOutput(`Manifest: ${manifestPath}`);
                return { artifact: { manifestPath, manifest } };
              },

              compensate: async (ctx, artifact) => {
                ctx.shared.vfs.remove(artifact.manifestPath);
                ctx.runtime.log.info(`  ↩ Removed manifest: ${artifact.manifestPath}`);
              },
            })
        )


        // ───────────────────────────────────────────────────────────────
        // STAGE 5: Verify Deployment
        // ───────────────────────────────────────────────────────────────
        // Features: 8 (when guards), 9 (external effect),
        //           18 (text formatting: Bold, colors, GradientText)
        .stage("verify", "Verify Deployment", (stage) =>
          stage

            // Step: Verify files exist at destination
            .step({
              id: "verify-files",
              title: "Verify deployed files",
              effect: "read",
              compensation: { kind: "none" },

              // ── Feature 8: when() guard ─────────────────────────
              // Multiple conditions: skip if --no-verify OR --dry-run.
              // An explicit `false` return skips the step.
              when: (ctx) =>
                ctx.runtime.flags.verify !== false && !ctx.isDryRun(),

              run: async (ctx) => {
                await new Promise(r => setTimeout(r, 200));

                const destFiles = ctx.shared.vfs.listAll()
                  .filter(f => f.path.startsWith(ctx.shared.destBase));

                const expectedCount =
                  ctx.shared.sourceFiles.length +
                  ctx.shared.sourceDirs.length +
                  2; // +1 manifest, +1 metadata

                if (destFiles.length < expectedCount) {
                  ctx.fail(
                    "VERIFY_FAILED",
                    `Expected at least ${expectedCount} entries, found ${destFiles.length}`,
                  );
                }

                // ── Feature 18: Text formatting in output ─────────
                // Bold(), green(), etc. are TTY-aware ANSI formatters.
                const summary = [
                  `${Bold("Deployment verified!")}`,
                  `  Files found: ${green(String(destFiles.length))}`,
                  `  Expected:    ${green(String(expectedCount))}`,
                ].join("\n");

                ctx.setTaskOutput(summary);
                ctx.setTaskTitle("✓ Deployment verified");

                return {
                  artifact: { totalEntries: destFiles.length, verified: true },
                };
              },
            })

            // Step: Send external notification (simulated)
            .step({
              id: "notify",
              title: "Send deployment notification",
              // ── Feature 9: External effect ──────────────────────
              // Represents calls to external systems (APIs, webhooks,
              // notifications). Best-effort compensation is recommended.
              effect: "external",
              compensation: { kind: "best-effort" },

              // Skip notifications in dry-run mode
              when: (ctx) => !ctx.isDryRun(),

              run: async (ctx) => {
                await new Promise(r => setTimeout(r, 100));

                // ── Feature 18: GradientText formatting ───────────
                // Per-character RGB gradient using 24-bit ANSI codes.
                const message = GradientText(
                  "✨ Deployment complete!",
                  "#00BFFF",
                  "#FF6347",
                );

                ctx.setTaskOutput(message);
                ctx.setTaskTitle("✓ Notification sent");

                return {
                  artifact: {
                    notified: true,
                    timestamp: new Date().toISOString(),
                  },
                };
              },

              // External effect compensation: undo the external action
              compensate: async (ctx, artifact) => {
                if (artifact.notified) {
                  ctx.runtime.log.info(
                    `  ↩ Cancelled notification from ${artifact.timestamp}`,
                  );
                }
              },
            })
        )


        // ── Feature 19 + 21: Finalize with artifact aggregation ───────
        // Runs after ALL stages complete successfully. Aggregates artifacts
        // from across stages into the final ProcessorResult value.
        // This is also where we print the final VFS state.
        .finalize(async (ctx) => {
          // ── Feature 21: getStepArtifact + getStageArtifact ──────
          const sourceCheck = ctx.getStepArtifact("validate", "check-source");
          const copyResult = ctx.getStepArtifact("copy-files", "copy-source-files");
          const manifestResult = ctx.getStepArtifact("manifest", "write-manifest");

          // Stage artifact from the prepare stage
          const dirSummary = ctx.getStageArtifact<{
            rootCreated: boolean;
            totalDirs: number;
            allPaths: string[];
          }>("prepare");

          // ── Feature 19: Print final VFS snapshot ────────────────
          // On SUCCESS, the virtual FS contains all deployed files.
          // On FAILURE (which never reaches finalize), compensation
          // cleans up and the VFS would be empty.
          const destFiles = ctx.shared.vfs.listAll()
            .filter(f => f.path.startsWith(ctx.shared.destBase));

          // ── Feature 18: Formatted summary output ────────────────
          console.log(
            "\n" + Bold(GradientText(
              "═══ Deploy Summary ═══",
              "#00BFFF",
              "#FF6347",
            )),
          );
          console.log(`  Source:       ${green(sourceCheck.path)}`);
          console.log(`  Destination:  ${green(ctx.shared.destBase)}`);
          console.log(`  Directories:  ${green(String(dirSummary.totalDirs))}`);
          console.log(`  Files copied: ${green(String(copyResult.files.length))}`);
          console.log(`  Manifest:     ${green(manifestResult.manifestPath)}`);
          console.log(
            `  Dry run:      ${ctx.isDryRun() ? yellow("yes") : green("no")}`,
          );

          if (destFiles.length > 0) {
            console.log(`\n  ${Bold("Virtual FS contents:")}`);
            for (const entry of destFiles) {
              const isDir = entry.content === "[directory]";
              const icon = isDir ? "📁" : "📄";
              const label = isDir ? blue(entry.path) : darkGray(entry.path);
              console.log(`    ${icon} ${label}`);
            }
          }
          console.log("");

          return {
            source: sourceCheck.path,
            destination: ctx.shared.destBase,
            directoriesCreated: dirSummary.totalDirs,
            filesCopied: copyResult.files.length,
            manifestPath: manifestResult.manifestPath,
            dryRun: ctx.isDryRun(),
            totalEntries: destFiles.length,
          };
        })
        .build(),
  })


  // ┌──────────────────────────────────────────────────────────────────────┐
  // │  COMMAND 2: status                                                  │
  // │  Inspect the virtual file system contents.                          │
  // │  Demonstrates: multi-command, different flag types, text formatting,│
  // │  simple sequential read-only processor.                             │
  // └──────────────────────────────────────────────────────────────────────┘
  .command({
    name: "status",
    description: "Inspect the virtual file system contents",

    // Different flag shapes than the deploy command — each command
    // has independently typed flags.
    build: (cmd) =>
      cmd
        .addOption(
          new Option("--format <type>", "Output format")
            .choices(["table", "json", "simple"] as const)
            .default("table" as const),
        )
        .addOption(
          new Option("--path <dir>", "Directory to inspect")
            .default("demo"),
        ),

    handler: ({ defineProcessor }) =>
      defineProcessor({
        id: "status-processor",
        title: "Virtual FS Status",
      })
        .errors({
          PATH_NOT_FOUND: "Requested path does not exist in virtual FS",
        })

        .createShared(async (_input, runtime) => {
          // Seed some demo data so status always has something to show
          seedSourceFiles("demo/project");
          return {
            vfs,
            basePath: runtime.flags.path,
            format: runtime.flags.format,
          };
        })

        // Read-only scan stage — simple sequential steps
        .stage("scan", "Scan Virtual File System", (stage) =>
          stage
            .step({
              id: "list-entries",
              title: "List all entries",
              effect: "read",
              compensation: { kind: "none" },

              run: async (ctx) => {
                await new Promise(r => setTimeout(r, 200));
                const entries = ctx.shared.vfs.listAll()
                  .filter(e => e.path.startsWith(ctx.shared.basePath));

                if (entries.length === 0) {
                  ctx.fail("PATH_NOT_FOUND", `No entries under: ${ctx.shared.basePath}`);
                }

                const dirs = entries.filter(e => e.content === "[directory]");
                const files = entries.filter(e => e.content !== "[directory]");

                ctx.setTaskTitle(`✓ Found ${entries.length} entries`);
                ctx.setTaskOutput(`${dirs.length} directories, ${files.length} files`);

                return {
                  artifact: {
                    entries,
                    dirCount: dirs.length,
                    fileCount: files.length,
                  },
                };
              },
            })
        )

        // Display stage — formats and outputs the scan results
        .stage("display", "Format Output", (stage) =>
          stage
            .collapse("stage") // Hide this housekeeping stage after completion
            .step({
              id: "format-output",
              title: "Render output",
              effect: "read",
              compensation: { kind: "none" },

              run: async (ctx) => {
                // ── Feature 21: Access artifacts from prior stage ──
                const { entries } = ctx.getStepArtifact("scan", "list-entries");

                // ── Feature 18: Text formatting showcase ──────────
                switch (ctx.shared.format) {
                  case "json":
                    console.log(JSON.stringify(entries, null, 2));
                    break;

                  case "simple":
                    for (const e of entries) {
                      console.log(e.path);
                    }
                    break;

                  case "table":
                  default: {
                    // GradientText, Bold, blue, green, darkGray
                    console.log(
                      "\n" + Bold(GradientText(
                        "═══ Virtual FS Status ═══",
                        "#00BFFF",
                        "#FF6347",
                      )),
                    );
                    console.log(`  Base path: ${blue(ctx.shared.basePath)}\n`);

                    for (const entry of entries) {
                      const isDir = entry.content === "[directory]";
                      const icon = isDir ? "📁" : "📄";
                      const name = isDir ? blue(entry.path) : entry.path;
                      const size = isDir
                        ? darkGray("dir")
                        : darkGray(`${entry.content.length}b`);
                      console.log(`  ${icon} ${name}  ${size}`);
                    }

                    console.log(`\n  Total: ${green(String(entries.length))} entries`);
                    break;
                  }
                }

                return { artifact: null };
              },
            })
        )

        .finalize(async (ctx) => {
          const scan = ctx.getStepArtifact("scan", "list-entries");
          return {
            path: ctx.shared.basePath,
            format: ctx.shared.format,
            totalEntries: scan.entries.length,
            directories: scan.dirCount,
            files: scan.fileCount,
          };
        })
        .build(),
  })


  // ── CRITICAL: Await .parseAsync() ───────────────────────────────────
  // Forgetting to call or await .parseAsync() causes a silent exit —
  // absolutely nothing runs. This is the #1 mistake new users make.
  .parseAsync();
