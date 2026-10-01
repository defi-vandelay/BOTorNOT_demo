import type { ServerMessage } from '@botornot/shared';
import type { Seat } from '../src/game/round';

/** A seat that records everything the round sends it. */
export class RecordingSeat implements Seat {
  readonly kind = 'human' as const;
  messages: ServerMessage[] = [];
  deliver(msg: ServerMessage) {
    this.messages.push(msg);
  }
  last<T extends ServerMessage['type']>(type: T) {
    return this.messages.filter((m) => m.type === type).at(-1) as
      Extract<ServerMessage, { type: T }> | undefined;
  }
  types() {
    return this.messages.map((m) => m.type);
  }
}
