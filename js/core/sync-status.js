// The small "Offline — changes will sync" note. syncText is pure; startSyncStatus wires it to the page.
export function syncText({ online, pending }) {
  return !online || pending ? "Offline — changes will sync" : null;
}

/** Shows or hides `node` as the connection and the backend's waiting writes change. Returns a stop function. */
export function startSyncStatus(node, dataApi) {
  let pending = false;
  const show = () => {
    const text = syncText({ online: navigator.onLine !== false, pending });
    node.textContent = text || "";
    node.hidden = !text;
  };
  const stopPending = dataApi.onPending((value) => { pending = !!value; show(); });
  pending = !!dataApi.pending();
  window.addEventListener("online", show);
  window.addEventListener("offline", show);
  show();
  return () => {
    if (typeof stopPending === "function") stopPending();
    window.removeEventListener("online", show);
    window.removeEventListener("offline", show);
  };
}
