import type { ChatTurn } from '../llm/gateway';

export interface Line {
  from: 'you' | 'partner';
  text: string;
}

/**
 * Turns the chat so far into Messages API turns: the partner is "user", the bot is "assistant".
 * Consecutive lines from one side are merged, and the list always starts and ends with a user turn.
 */
export function buildMessages(lines: Line[], note: string): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const line of lines) {
    const role = line.from === 'you' ? 'assistant' : 'user';
    const last = turns.at(-1);
    if (last?.role === role) last.content += `\n${line.text}`;
    else turns.push({ role, content: line.text });
  }
  if (turns[0]?.role !== 'user') {
    const opener = turns.length ? '(chat started, you went first)' : '(chat started, you go first)';
    turns.unshift({ role: 'user', content: opener });
  }
  if (turns.at(-1)?.role !== 'user')
    turns.push({ role: 'user', content: "(they haven't replied)" });
  turns[0]!.content = `${note}\n${turns[0]!.content}`;
  return turns;
}
