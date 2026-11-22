/** Runs `run` each time the page comes back into view (on a phone: each time the app is reopened). Returns a stop function. */
export function onVisible(run, doc = document) {
  const onChange = () => { if (doc.visibilityState === "visible") run(); };
  doc.addEventListener("visibilitychange", onChange);
  return () => doc.removeEventListener("visibilitychange", onChange);
}
