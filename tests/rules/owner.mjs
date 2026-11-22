// Reads the owner's user ID out of the text of firestore.rules.
const OWNER_RE = /function ownerUid\(\)\s*\{\s*return "([^"]+)";/;

export function ownerUidFromRules(rulesText) {
  const m = OWNER_RE.exec(rulesText);
  if (!m) throw new Error('Could not find function ownerUid() in firestore.rules');
  return m[1];
}
