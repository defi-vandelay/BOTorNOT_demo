import { describe, expect, it } from 'vitest';
import { MAX_MESSAGE_CHARS, parseClientMessage } from '../src';

describe('parseClientMessage', () => {
  it('accepts a valid chat message', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'chat.send', text: 'hi there' }))).toEqual({
      type: 'chat.send',
      text: 'hi there',
    });
  });

  it('rejects messages over the character limit', () => {
    const text = 'x'.repeat(MAX_MESSAGE_CHARS + 1);
    expect(parseClientMessage(JSON.stringify({ type: 'chat.send', text }))).toBeNull();
  });

  it('rejects unknown types and bad JSON', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'nope' }))).toBeNull();
    expect(parseClientMessage('{not json')).toBeNull();
  });
});
