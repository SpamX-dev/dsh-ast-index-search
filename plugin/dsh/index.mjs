import { fileURLToPath } from 'node:url';
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem';
import { registerCli } from './cli.mjs';

export const name = 'dsh-ast-index';
export const inject = ['skills', 'shellEnv'];

export function apply(ctx) {
  registerCli(ctx);
  ctx.skills.registerProvider(control => new FileSystemSkillProvider(ctx, control, {
    providerName: name,
    bundledSkillDir: fileURLToPath(new URL('../skills/', import.meta.url)),
    includeDefaultRoots: false,
    watch: false,
  }));
}
