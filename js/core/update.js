// Finding, announcing and applying a new version of the app (the worker in sw.js does the caching).

const controllerOf = (container) => container?.controller ?? null;
const serviceWorkers = () => globalThis.navigator?.serviceWorker;

/** The current registration, or undefined where there is none (not installed, no worker support, tests). */
export async function currentRegistration() {
  try {
    return await serviceWorkers()?.getRegistration();
  } catch {
    return undefined;
  }
}

/** Calls show() once when a new worker finishes installing while the page already has a worker (a real update, not the first install). */
export function watchForUpdate(registration, show, container = serviceWorkers()) {
  let shown = false;
  const announce = () => { if (!shown) { shown = true; show(); } };
  const follow = (worker) => {
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && controllerOf(container)) announce();
    });
  };
  if (registration.waiting && controllerOf(container)) announce();
  follow(registration.installing);
  registration.addEventListener("updatefound", () => follow(registration.installing));
}

/** Whether to register the worker: https, or localhost only with ?sw=1; never in the ?backend=memory test mode. */
export function shouldRegisterWorker({ protocol, hostname, search }) {
  const params = new URLSearchParams(search);
  if (params.get("backend") === "memory") return false;
  if (protocol === "https:") return true;
  return ["localhost", "127.0.0.1"].includes(hostname) && params.get("sw") === "1";
}

/** Tells the waiting worker to take over, then reloads once when it has. With nothing waiting (another tab already updated) it just reloads. */
export function applyUpdate(registration, container = serviceWorkers(), reload = () => location.reload()) {
  if (!registration.waiting) { reload(); return; }
  let reloaded = false;
  container.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    reload();
  });
  registration.waiting.postMessage({ type: "skip-waiting" });
}

/** Asks the server for a newer version. Resolves to whether one is now waiting. */
export async function checkForUpdate(registration) {
  if (!registration) return false;
  await registration.update();
  const worker = registration.installing;
  if (worker && !registration.waiting) {
    await new Promise((resolve) => {
      const done = () => { if (worker.state === "installed" || worker.state === "redundant") resolve(); };
      worker.addEventListener("statechange", done);
      done();
    });
  }
  return !!registration.waiting;
}
