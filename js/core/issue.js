// Issues a write without awaiting the server (a Firestore write only resolves once the server answers, which
// offline is never). Only a rejected or throwing write is reported, through onFail.
const FAIL = "Couldn't save — try again";

export function issue(write, onFail) {
  let p;
  try { p = Promise.resolve(write()); } catch (err) { p = Promise.reject(err); }
  p.catch(() => { if (onFail) onFail(FAIL); });
}
