import { Injectable } from '@nestjs/common';

/**
 * Scaffold for the AI orchestration layer. This will own model invocation,
 * prompt assembly (workspace instructions + skills + tool calling) and
 * conversation persistence in later phases.
 */
@Injectable()
export class AiService {
  getStatus(): { module: string; ready: boolean; provider: string } {
    return { module: 'ai', ready: true, provider: 'unconfigured' };
  }
}
