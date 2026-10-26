// Runs as the root `preinstall` script. This repo is a pnpm workspace:
// npm/yarn cannot resolve `workspace:*` dependencies and would leave the
// apps without node_modules. Fail early with a clear message instead.
const agent = process.env.npm_config_user_agent ?? '';
if (!agent.startsWith('pnpm/')) {
  console.error(
    [
      '',
      'This repository uses pnpm workspaces. Please install with pnpm, not npm or yarn:',
      '',
      '  npm install -g pnpm@10.28.0   # or: corepack enable (Node <= 24)',
      '  pnpm install',
      '',
      'If you already ran `npm install`, delete node_modules/ and package-lock.json first.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}
