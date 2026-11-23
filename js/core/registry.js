// Plug-in points. Each part of the dashboard (trading now; weather, lessons, calendar, Farm Ledger later)
// registers its sidebar tab, its Overview cards, its piece of the "Your day" line and its Settings card here.

export function createRegistry() {
  const lists = { tabs: [], cards: [], dayParts: [], settingsCards: [] };
  const add = (kind) => (spec) => {
    if (lists[kind].some((item) => item.id === spec.id)) throw new Error(`duplicate id: ${spec.id}`);
    lists[kind].push(spec);
  };
  const sorted = (kind) => () => [...lists[kind]].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return {
    registerTab: add("tabs"), registerCard: add("cards"), registerDayPart: add("dayParts"), registerSettingsCard: add("settingsCards"),
    tabs: sorted("tabs"), cards: sorted("cards"), dayParts: sorted("dayParts"), settingsCards: sorted("settingsCards"),
  };
}

const shared = createRegistry();
export const { registerTab, registerCard, registerDayPart, registerSettingsCard, tabs, cards, dayParts, settingsCards } = shared;
