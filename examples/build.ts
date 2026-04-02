import { ScriptApp } from "../modules/classes/appScript";
import { Option } from "@commander-js/extra-typings";

await new ScriptApp(
  'My-CLI-APP'
)
  .meta({
    company: "SIGMA Group",
    author: 'Michael Walker',
    version: '1.0.0'
  })
  .command({
    name: 'build',
    description: 'compile an example app',
    build: (cmd) => {
      return cmd
        .addOption(new Option('-d, --dry-run', 'Run without making any changes').default(false, 'false'))
        .option('--no-install', 'Skip installation step')
        .option('--no-git', 'Skip git step');
    },
    handler: ({ defineProcessor }) =>
      defineProcessor({
        id: 'build-processor',
        title: 'Build Processor'
      })
        .errors({
          BUILD_ERRORS: 'Build Error'
        })
        .createShared(async () => ({
          startedAt: new Date().toISOString(),

        }))
        .stage(
          'check-env',
          'Check Execution Environment',
          (stage) =>
            stage
              .parallel()
              .collapse('none')
              .step({
                id: 'check-node',
                title: 'Check Node version',
                effect: 'read',
                compensation: { kind: 'none' },
                run: async (ctx) => {
                  await new Promise((resolve) => setTimeout(resolve, 1000));
                  const version = await ctx.runtime.shell.capture('node', ['--version']);
                  ctx.setTaskTitle('Step: Check Node Version: Complete')
                  ctx.setTaskOutput(`Node Version: ${version}`)
                  // ctx.fail('BUILD_ERRORS')
                  return { artifact: { version } };
                },
              })
              .step({
                id: 'check-bun',
                title: 'Check Bun version',
                effect: 'read',
                compensation: { kind: 'none' },
                when: (ctx) => !ctx.runtime.flags.dryRun, // Skip this step in dry-run mode
                run: async (ctx) => {
                  await new Promise((resolve) => setTimeout(resolve, 1000));
                  const version = await ctx.runtime.shell.capture('bun', ['--version']);
                  ctx.setTaskOutput(`Bun Version: ${version}`)
                  return { artifact: { version } };
                },
              })
        )
        .stage(
          'check stuff',
          'Check other stuff',
          (stage) =>
            stage
              .step({
                id: 'check-other',
                title: 'Check other stuff',
                effect: 'read',
                compensation: { kind: 'none' },
                run: async (ctx) => {
                  ctx.setTaskTitle('Checking other stuff...')
                  await new Promise((resolve) => setTimeout(resolve, 1000));
                  ctx.setTaskOutput('Other stuff is good!');
                  return { artifact: { info: 'other stuff is good' } };
                },
              })
              .step({
                id: 'check-other-2',
                title: 'Check other stuff 2',
                effect: 'read',
                compensation: { kind: 'none' },
                run: async (ctx) => {
                  ctx.setTaskTitle('Checking other stuff 2...')
                  await new Promise((resolve) => setTimeout(resolve, 1000));
                  ctx.setTaskOutput('Other stuff 2 is good!');
                  return { artifact: { info: 'other stuff 2 is good' } };
                },
              })
        )
        .finalize(
          async (ctx) => ({
            nodeVersion: ctx.getStepArtifact('check-env', 'check-node').version,
            bunVersion: ctx.getStepArtifact('check-env', 'check-bun').version
          })
        )
        .build()
  })
  .parseAsync()
