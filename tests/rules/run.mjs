// Runs the Firestore rules tests inside the emulator, which needs Java.
// With no Java (e.g. Tom's Mac) it says so and exits 0; with CI set it exits 1.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const NO_JAVA = 'Java not found — rules tests run on GitHub';

// Pure decision. Missing Java is fine on a dev Mac, but in CI it must fail the build.
export function decideJavaAction(javaOk, isCI) {
  if (javaOk) return { run: true };
  return { run: false, message: NO_JAVA, exitCode: isCI ? 1 : 0 };
}

function main() {
  const javaCheck = spawnSync('java', ['-version'], { stdio: 'ignore' });
  const javaOk = !javaCheck.error && javaCheck.status === 0;
  const decision = decideJavaAction(javaOk, Boolean(process.env.CI));
  if (!decision.run) {
    (decision.exitCode ? console.error : console.log)(decision.message);
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
