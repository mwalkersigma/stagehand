import { ScriptApp } from "./modules/classes/appScript";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

await new ScriptApp("stagehand-publish")
  .meta({
    company: "SIGMA Group",
    author: "Michael Walker",
    version: "1.0.0",
    dateCreated: "04/03/2026",
  })
  .command({
    name: "publish",
    description: "Build and publish the package to npm using token from .env",
    build: (cmd, Option) => {
      return cmd
        .addOption(
          new Option("-d, --dry-run", "Preview publish without uploading")
            .default(false, "false"),
        )
        .addOption(
          new Option("--tag <name>", "npm dist-tag to publish under")
            .default("latest"),
        )
        .addOption(
          new Option("--access <level>", "npm access level")
            .choices(["public", "restricted"] as const)
            .default("public" as const),
        )
        .addOption(
          new Option("--otp <code>", "One-time password for npm 2FA (if required)"),
        )
        .addOption(
          new Option("--no-build", "Skip running build before publish"),
        );
    },
    handler: ({ defineProcessor }) =>
      defineProcessor({
        id: "publish-framework",
        title: "Stagehand Publish",
      })
        .errors({
          TOKEN_MISSING: "NPM_TOKEN is missing. Add it to .env or your environment",
          AUTH_CONFIG_FAILED: "Failed to configure temporary npm auth",
          BUILD_FAILED: "Build failed before publish",
          PUBLISH_FAILED: "npm publish failed",
        })
        .createShared(async (_input, _runtime) => {
          const projectRoot = path.resolve(import.meta.dir);

          return {
            projectRoot,
            distDir: path.join(projectRoot, "dist"),
            npmConfigPath: undefined as string | undefined,
          };
        })
        .stage("auth", "Configure npm auth", (stage) =>
          stage
            .step({
              id: "load-token",
              title: "Load NPM token",
              effect: "read",
              compensation: { kind: "none" },
              run: async (ctx) => {
                const token = ctx.runtime.env.get("NPM_TOKEN");
                const hasToken = Boolean(token && token.trim().length > 0);

                if (!hasToken && !ctx.isDryRun()) {
                  ctx.fail("TOKEN_MISSING", "Missing NPM_TOKEN in .env or environment");
                }

                if (!hasToken) {
                  ctx.setTaskWarning("NPM_TOKEN not found. Dry-run publish will rely on npm login state.");
                } else {
                  ctx.setTaskOutput("Loaded NPM_TOKEN from runtime environment");
                }

                return {
                  artifact: {
                    hasToken,
                    token,
                  },
                };
              },
            })
            .step({
              id: "write-temp-npmrc",
              title: "Create temporary npm auth config",
              effect: "create",
              compensation: { kind: "best-effort" },
              run: async (ctx) => {
                const tokenInfo = ctx.getStepArtifact("auth", "load-token");
                const token = tokenInfo.token;
                if (!token) {
                  ctx.setTaskOutput("Skipping temporary npmrc (no token)");
                  return { artifact: { created: false, npmConfigPath: undefined as string | undefined } };
                }

                try {
                  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "stagehand-publish-"));
                  const npmConfigPath = path.join(tempDir, ".npmrc");
                  await fs.writeFile(
                    npmConfigPath,
                    `//registry.npmjs.org/:_authToken=${token}\n`,
                    "utf-8",
                  );

                  ctx.shared.npmConfigPath = npmConfigPath;
                  ctx.setTaskOutput(`Created temporary npm config at ${npmConfigPath}`);
                  return { artifact: { created: true, npmConfigPath } };
                } catch (error) {
                  ctx.fail("AUTH_CONFIG_FAILED", "Unable to create temporary npm auth config", error);
                  throw error;
                }
              },
              compensate: async (_ctx, artifact) => {
                if (!artifact.created || !artifact.npmConfigPath) {
                  return;
                }
                try {
                  await fs.rm(path.dirname(artifact.npmConfigPath), { recursive: true, force: true });
                } catch {
                  // best-effort cleanup
                }
              },
            })
        )
        .stage("build", "Build package", (stage) =>
          stage
            .step({
              id: "run-build",
              title: "Run framework build",
              effect: "create",
              compensation: { kind: "none" },
              when: (ctx) => ctx.runtime.flags.build,
              run: async (ctx) => {
                try {
                  await ctx.$(
                    "bun",
                    ["run", "build-framework.ts", "build"],
                    {
                      cwd: ctx.shared.projectRoot,
                      preview: true,
                      clearPreviewOnSuccess: false,
                    },
                  );
                  ctx.setTaskOutput("Build complete");
                  return { artifact: { built: true as const } };
                } catch (error) {
                  ctx.fail("BUILD_FAILED", "Build failed before publish", error);
                  throw error;
                }
              },
            })
        )
        .stage("publish", "Publish to npm", (stage) =>
          stage
            .step({
              id: "npm-publish",
              title: "Run npm publish",
              effect: "external",
              compensation: { kind: "none" },
              run: async (ctx) => {
                const args = [
                  "publish",
                  "./dist",
                  "--access",
                  ctx.runtime.flags.access,
                  "--tag",
                  ctx.runtime.flags.tag,
                ];

                if (ctx.isDryRun()) {
                  args.push("--dry-run");
                }

                if (ctx.runtime.flags.otp) {
                  args.push("--otp", ctx.runtime.flags.otp);
                }

                const env = ctx.shared.npmConfigPath
                  ? {
                      ...process.env,
                      npm_config_userconfig: ctx.shared.npmConfigPath,
                    }
                  : process.env;

                try {
                  await ctx.$(
                    "npm",
                    args,
                    {
                      cwd: ctx.shared.projectRoot,
                      env,
                      preview: true,
                      clearPreviewOnSuccess: false,
                    },
                  );

                  ctx.setTaskOutput(ctx.isDryRun() ? "Dry-run publish completed" : "Publish completed");
                  return { artifact: { published: !ctx.isDryRun() } };
                } catch (error) {
                  ctx.fail("PUBLISH_FAILED", "npm publish failed", error);
                  throw error;
                }
              },
            })
        )
        .finalize(async (ctx) => {
          return {
            dryRun: ctx.isDryRun(),
            distDir: ctx.shared.distDir,
            tag: ctx.runtime.flags.tag,
            access: ctx.runtime.flags.access,
          };
        })
        .build(),
  })
  .parseAsync();
