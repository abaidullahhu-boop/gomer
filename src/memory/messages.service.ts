import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessageRole } from '../common/enums';
import { Message } from '../database/entities';

/** A prior conversation turn, shaped for replay into an AI run. */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** How many prior turns are replayed into a run at most. */
const HISTORY_TURN_LIMIT = 20;

/** Cap each replayed turn so one huge answer can't blow the context budget. */
const TURN_CHAR_LIMIT = 4000;

/**
 * Persists conversation turns and reads them back as run history, giving Gomer
 * continuity within a thread. Writes are best-effort — losing a turn must never
 * fail the reply it belongs to — so failures are logged, not thrown.
 */
@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
  ) {}

  /** Record one turn of a thread. Best-effort: failures are logged, not thrown. */
  async appendTurn(
    workspaceId: string,
    threadId: string,
    userId: string | null,
    role: MessageRole,
    content: string,
  ): Promise<void> {
    if (!content.trim()) return;
    try {
      await this.messageRepository.save(
        this.messageRepository.create({ workspaceId, threadId, userId, role, content }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to persist ${role} turn for thread ${threadId}: ${message}`);
    }
  }

  /**
   * The most recent turns of a thread, oldest-first, ready to seed a run's
   * message history. Best-effort: a read failure returns an empty history.
   */
  async getThread(
    workspaceId: string,
    threadId: string,
    limit = HISTORY_TURN_LIMIT,
  ): Promise<ConversationTurn[]> {
    try {
      const rows = await this.messageRepository.find({
        where: { workspaceId, threadId },
        order: { createdAt: 'DESC' },
        take: limit,
      });
      return rows.reverse().map((row) => ({
        role: row.role === MessageRole.ASSISTANT ? 'assistant' : 'user',
        content:
          row.content.length > TURN_CHAR_LIMIT
            ? `${row.content.slice(0, TURN_CHAR_LIMIT)}…`
            : row.content,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to load history for thread ${threadId}: ${message}`);
      return [];
    }
  }
}
