// Runs the Firestore rules tests inside the emulator, which needs Java.
// With no Java (e.g. Tom's Mac) it says so and exits 0; the real run is on GitHub.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const NO_JAVA = 'Java not found — rules tests run on GitHub';

// `javaCheck` is the result of spawnSync('java', ['-version']).
export function decideJavaAction(javaCheck) {
  if (javaCheck.error || javaCheck.status !== 0) return { run: false, message: NO_JAVA, exitCode: 0 };
  return { run: true };
}

function main() {
  const decision = decideJavaAction(spawnSync('java', ['-version'], { stdio: 'ignore' }));
  if (!decision.run) {
    console.log(decision.message);
    process.exit(decision.exitCode);
  }
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const result = spawnSync(
    'npx',
    ['firebase', 'emulators:exec', '--only', 'firestore', '--project', 'demo-home-dashboard',
      'node --test tests/rules/rules.test.mjs'],
    { cwd: root, stdio: 'inherit' }
  );
  process.exit(result.status ?? 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
