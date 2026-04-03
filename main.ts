// ──────────────────────────────────────────────────────────────────────────────
// Script Framework — Entry Point
// ──────────────────────────────────────────────────────────────────────────────
//
// Run the example CLI app:
//   bun run main.ts build
//   bun run main.ts build --dry-run
//
// ──────────────────────────────────────────────────────────────────────────────

// ─── Tasuku v3 Reference Examples ────────────────────────────────────────────
//
// Sequential stages (flat):
//
//   await task.group(task => [
//     task('A', async () => {
//       await new Promise(resolve => setTimeout(resolve, 1000));
//       return 1;
//     }),
//     task('B', async () => {
//       await new Promise(resolve => setTimeout(resolve, 500));
//       return 2;
//     }),
//   ])
//
// Nested sequential (stage → steps):
//
//   await task('outer task', async ({ setStatus }) => {
//     await task('inner task 1', async () => {
//       await new Promise(resolve => setTimeout(resolve, 1000));
//       return 'result 1';
//     });
//     await task('inner task 2', async () => {
//       await new Promise(resolve => setTimeout(resolve, 500));
//       return 'result 2';
//     });
//     setStatus('complete')
//     return 'outer result';
//   })
//
// Parallel nested (stage → parallel steps):
//
//   await task('outer task', async ({ setStatus }) => {
//     task('inner task 1', async () => {
//       await new Promise(resolve => setTimeout(resolve, 1000));
//       return 'result 1';
//     })
//     task('inner task 2', async () => {
//       await new Promise(resolve => setTimeout(resolve, 1000));
//       return 'result 2';
//     })
//     setStatus('complete')
//     return 'outer result';
//   })
//
// Stage-level collapse:
//
//   await task('outer task', async ({ setStatus }) => {
//     task('inner task 1', async () => { ... })
//     task('inner task 2', async () => { ... })
//     setStatus('complete')
//     return 'outer result';
//   }).clear()
//
// Step-level collapse:
//
//   await task('outer task', async ({ setStatus }) => {
//     task('inner task 1', async () => { ... }).clear()
//     task('inner task 2', async () => { ... }).clear()
//     setStatus('complete')
//     return 'outer result';
//   })
//
// ─────────────────────────────────────────────────────────────────────────────

import "./examples/filesystem-deploy";
