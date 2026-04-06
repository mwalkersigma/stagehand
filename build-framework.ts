import { ScriptApp } from "./modules/classes/appScript";
import { Option } from "@commander-js/extra-typings";
import path from "node:path";
import fs from "node:fs/promises";

await new ScriptApp('stagehand-build')
  .meta({
    company: "SIGMA Group",
    author: "Michael Walker",
    version: "1.0.0",
    dateCreated: "04/02/2026",
  })
  .command({
    name: 'build',
    description: 'Build the stagehand framework for npm publishing',
    build: (cmd) => {
      return cmd
        .addOption(new Option('-d, --dry-run', 'Preview steps without executing').default(false, 'false'))
        .option('--no-test', 'Skip test stage')
        .option('--no-clean', 'Skip clean stage');
    },
    handler: ({ defineProcessor }) =>
      defineProcessor({
        id: 'build-framework',
        title: 'Stagehand Build',
      })
        .errors({
          CLEAN_FAILED: 'Failed to clean build output directory',
          ENV_CHECK_FAILED: 'Required build tool is missing',
          TYPE_CHECK_FAILED: 'TypeScript type checking failed',
          COMPILE_FAILED: 'TypeScript compilation failed',
          TEST_FAILED: 'Test suite failed',
          PACKAGE_FAILED: 'Failed to prepare package artifacts',
        })
        .createShared(async () => {
          const projectRoot = path.resolve(import.meta.dir);
          const distDir = path.join(projectRoot, 'dist');
          return {
            projectRoot,
            distDir,
            startedAt: Date.now(),
          };
        })

        // ═══════════════════════════════════════════════════════════════
        // Stage 1 — Clean Build Output
        //
        // Removes the dist/ directory so we start from a fresh slate.
        // Skipped when --no-clean is passed.
        // ═══════════════════════════════════════════════════════════════
        .stage('clean', 'Clean Build Output', (stage) =>
          stage
            .step({
              id: 'remove-dist',
              title: 'Remove dist/ directory',
              effect: 'delete',
              compensation: { kind: 'none' },
              when: (ctx) => ctx.runtime.flags.clean,
              run: async (ctx) => {
                if (ctx.isDryRun()) {
                  ctx.setTaskOutput(`[dry-run] Would remove ${ctx.shared.distDir}`);
                  return { artifact: { removed: false } };
                }

                try {
                  const stat = await fs.stat(ctx.shared.distDir);
                  if (stat.isDirectory()) {
                    await fs.rm(ctx.shared.distDir, { recursive: true, force: true });
                    ctx.setTaskOutput('Removed dist/ directory');
                    return { artifact: { removed: true } };
                  }
                } catch {
                  // Directory doesn't exist — nothing to clean
                }

                ctx.setTaskOutput('dist/ does not exist — nothing to clean');
                return { artifact: { removed: false } };
              },
            })
        )
        // ═══════════════════════════════════════════════════════════════
        // Stage 2 — Type Check
        //
        // Runs `tsc --noEmit` to verify the codebase has no type errors
        // before we attempt to emit output files.
        // ═══════════════════════════════════════════════════════════════
        .stage('type-check', 'Type Check', (stage) =>
          stage
            .step({
              id: 'tsc-noEmit',
              title: 'Run tsc --noEmit',
              effect: 'read',
              compensation: { kind: 'none' },
              run: async (ctx) => {
                try {
                  await ctx.$(
                    'npx', ['tsc', '--noEmit'],
                    {
                      cwd: ctx.shared.projectRoot,
                      preview: true,
                      clearPreviewOnSuccess: false,
                    },
                  );
                } catch (err) {
                  throw ctx.errors.create(
                    'TYPE_CHECK_FAILED',
                    'TypeScript type checking found errors',
                    err,
                  );
                }
                ctx.setTaskOutput('Type check passed');
                return { artifact: { passed: true as const } };
              },
            })
        )
// ═══════════════════════════════════════════════════════════════
        // Stage 3 — Run Tests
        //
        // Executes the full test suite via `bun test`.
        // Skipped when --no-test is passed.
        // ═══════════════════════════════════════════════════════════════
        .stage('test', 'Run Tests', (stage) =>
          stage
            .step({
              id: 'bun-test',
              title: 'Run bun test',
              effect: 'read',
              compensation: { kind: 'none' },
              when: (ctx) => ctx.runtime.flags.test,
              run: async (ctx) => {
                try {
                  await ctx.$(
                    'bun', ['test'],
                    {
                      cwd: ctx.shared.projectRoot,
                      preview: true,
                      clearPreviewOnSuccess: false,
                    },
                  );
                } catch (err) {
                  throw ctx.errors.create(
                    'TEST_FAILED',
                    'Test suite failed',
                    err,
                  );
                }
                ctx.setTaskOutput('All tests passed');
                return { artifact: { passed: true as const } };
              },
            })
        )
        // ═══════════════════════════════════════════════════════════════
        // Stage 4 — Compile
        //
        // Emits compiled JavaScript and declaration files into dist/
        // using tsconfig.build.json, then copies a publish-ready
        // package.json into the output directory.
        // ═══════════════════════════════════════════════════════════════
        .stage('compile', 'Compile', (stage) =>
          stage
            .step({
              id: 'tsc-build',
              title: 'Compile TypeScript to dist/',
              effect: 'create',
              compensation: { kind: 'best-effort' },
              run: async (ctx) => {
                if (ctx.isDryRun()) {
                  ctx.setTaskOutput(`[dry-run] Would compile to ${ctx.shared.distDir}`);
                  return { artifact: { outputDir: ctx.shared.distDir } };
                }

                try {
                  await ctx.$(
                    'npx', ['tsc', '-p', 'tsconfig.build.json'],
                    {
                      cwd: ctx.shared.projectRoot,
                      preview: true,
                      clearPreviewOnSuccess: false,
                    },
                  );
                } catch (err) {
                  throw ctx.errors.create(
                    'COMPILE_FAILED',
                    'TypeScript compilation failed',
                    err,
                  );
                }

                ctx.setTaskOutput(`Compiled to ${ctx.shared.distDir}`);
                return { artifact: { outputDir: ctx.shared.distDir } };
              },
              compensate: async (ctx) => {
                await fs.rm(ctx.shared.distDir, { recursive: true, force: true });
              },
            })
            .step({
              id: 'copy-package-json',
              title: 'Prepare package.json for dist/',
              effect: 'create',
              compensation: { kind: 'best-effort' },
              run: async (ctx) => {
                const packagePath = path.join(ctx.shared.distDir, 'package.json');

                if (ctx.isDryRun()) {
                  ctx.setTaskOutput(`[dry-run] Would write ${packagePath}`);
                  return { artifact: { packagePath } };
                }

                const sourcePath = path.join(ctx.shared.projectRoot, 'package.json');
                const raw = await fs.readFile(sourcePath, 'utf-8');
                const pkg = JSON.parse(raw) as Record<string, unknown>;

                const publishPkg: Record<string, unknown> = {
                  name: pkg['name'],
                  version: pkg['version'],
                  description: pkg['description'],
                  keywords: pkg['keywords'],
                  author: pkg['author'],
                  license: pkg['license'],
                  dependencies: pkg['dependencies'],
                  main: 'index.js',
                  types: 'index.d.ts',
                  module: 'index.js',
                  exports: {
                    '.': {
                      import: './index.js',
                      types: './index.d.ts',
                    },
                  },
                };

                await fs.mkdir(ctx.shared.distDir, { recursive: true });
                await fs.writeFile(packagePath, JSON.stringify(publishPkg, null, 2) + '\n');
                ctx.setTaskOutput(`Wrote publish-ready package.json`);
                return { artifact: { packagePath } };
              },
              compensate: async (ctx) => {
                const packagePath = path.join(ctx.shared.distDir, 'package.json');
                try {
                  await fs.unlink(packagePath);
                } catch {
                  // File may not exist if compile step also failed
                }
              },
            })
            .step({
              id: 'copy-package-docs',
              title: 'Copy README and LICENSE to dist/',
              effect: 'create',
              compensation: { kind: 'best-effort' },
              run: async (ctx) => {
                const readmeSource = path.join(ctx.shared.projectRoot, 'README.md');
                const licenseSource = path.join(ctx.shared.projectRoot, 'LICENSE');
                const readmeTarget = path.join(ctx.shared.distDir, 'README.md');
                const licenseTarget = path.join(ctx.shared.distDir, 'LICENSE');

                if (ctx.isDryRun()) {
                  ctx.setTaskOutput(`[dry-run] Would copy ${readmeSource} and ${licenseSource} to dist`);
                  return {
                    artifact: {
                      copied: false,
                      readmePath: readmeTarget,
                      licensePath: licenseTarget,
                    },
                  };
                }

                try {
                  await fs.copyFile(readmeSource, readmeTarget);
                  await fs.copyFile(licenseSource, licenseTarget);
                } catch (err) {
                  throw ctx.errors.create(
                    'PACKAGE_FAILED',
                    'Failed to copy README and LICENSE into dist',
                    err,
                  );
                }

                ctx.setTaskOutput('Copied README.md and LICENSE to dist/');
                return {
                  artifact: {
                    copied: true,
                    readmePath: readmeTarget,
                    licensePath: licenseTarget,
                  },
                };
              },
              compensate: async (_ctx, artifact) => {
                if (!artifact.copied) {
                  return;
                }

                try {
                  await fs.unlink(artifact.readmePath);
                } catch {
                  // File may already be gone
                }

                try {
                  await fs.unlink(artifact.licensePath);
                } catch {
                  // File may already be gone
                }
              },
            })
        )

        // ═══════════════════════════════════════════════════════════════
        // Finalize
        //
        // Computes total elapsed time and returns the build summary.
        // ═══════════════════════════════════════════════════════════════
        .finalize(async (ctx) => {
          const elapsed = Date.now() - ctx.shared.startedAt;
          return {
            distDir: ctx.shared.distDir,
            elapsed: `${(elapsed / 1000).toFixed(1)}s`,
          };
        })
        .build()
  })
  .parseAsync();
