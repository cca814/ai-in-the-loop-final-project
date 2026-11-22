export function conversationContext(history, { maxTurns = 16, maxCharacters = 24_000 } = {}) {
  let size = 0;
  const selected = [];
  for (let index = history.length - 1; index >= 0 && selected.length < maxTurns; index--) {
    if (size + history[index].content.length > maxCharacters) break;
    selected.unshift(history[index]);
    size += history[index].content.length;
  }
  return { turns: selected, omitted: history.length - selected.length };
}
