// Publica dist/ en la rama gh-pages (alternativa manual al workflow de Actions).
// Uso: npm run deploy
import { execSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';

const run = (cmd, cwd = '.') => execSync(cmd, { cwd, stdio: 'inherit' });
const remote = execSync('git remote get-url origin').toString().trim();
const sha = execSync('git rev-parse --short HEAD').toString().trim();

run('npm run build');
writeFileSync('dist/.nojekyll', '');
rmSync('dist/.git', { recursive: true, force: true });
run('git init -q -b gh-pages', 'dist');
run('git add -A', 'dist');
run(`git commit -q -m "deploy: ${sha}"`, 'dist');
run(`git push -f "${remote}" gh-pages`, 'dist');
rmSync('dist/.git', { recursive: true, force: true });
console.log('Publicado en la rama gh-pages.');
