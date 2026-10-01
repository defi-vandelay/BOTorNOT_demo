import type { Config } from '../config';
import { AnthropicGateway } from './anthropic';
import { MockGateway } from './mock';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ReplyRequest {
  system: string;
  messages: ChatTurn[];
  maxTokens?: number;
}

export interface Classification {
  flagged: boolean;
  category:
    | 'none'
    | 'hate'
    | 'sexual'
    | 'self_harm'
    | 'violence'
    | 'illegal'
    | 'personal_data'
    | 'jailbreak';
}

/** Every model call the game makes goes through this interface, so providers can be swapped. */
export interface LlmGateway {
  /** Next bot message, or null if the model declined or returned nothing usable. */
  reply(req: ReplyRequest): Promise<string | null>;
  /** Moderation check for one chat message. */
  classify(text: string): Promise<Classification>;
}

export function createGateway(config: Config): LlmGateway {
  return config.LLM_PROVIDER === 'anthropic'
    ? new AnthropicGateway({ apiKey: config.ANTHROPIC_API_KEY!, model: config.BOT_MODEL })
    : new MockGateway();
}
