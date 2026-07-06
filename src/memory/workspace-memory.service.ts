import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkspaceMemory } from '../database/entities';

/** Longest allowed fact key, mirroring the column width. */
const KEY_MAX_LENGTH = 128;

/** Longest allowed fact value — memory holds facts, not documents. */
const VALUE_MAX_LENGTH = 2000;

/** Character budget for the memory block injected into the system prompt. */
const PROMPT_BUDGET_CHARS = 4000;

/**
 * Durable, workspace-scoped key/value memory: facts, targets, and standing
 * instructions the assistant retains across conversations (e.g. "target_roas"
 * → "3.0"). The model reads and writes it through the memory tools; every run
 * gets the current facts injected into its system prompt.
 */
@Injectable()
export class WorkspaceMemoryService {
  private readonly logger = new Logger(WorkspaceMemoryService.name);

  constructor(
    @InjectRepository(WorkspaceMemory)
    private readonly memoryRepository: Repository<WorkspaceMemory>,
  ) {}

  /** All facts for a workspace, most recently updated first. */
  list(workspaceId: string): Promise<WorkspaceMemory[]> {
    return this.memoryRepository.find({
      where: { workspaceId },
      order: { updatedAt: 'DESC' },
    });
  }

  /** Create or overwrite a fact. Throws on an invalid key/value. */
  async remember(
    workspaceId: string,
    userId: string | null,
    key: string,
    value: string,
  ): Promise<WorkspaceMemory> {
    const normalizedKey = key.trim();
    const normalizedValue = value.trim();
    if (!normalizedKey || normalizedKey.length > KEY_MAX_LENGTH) {
      throw new Error(`Fact key must be 1-${KEY_MAX_LENGTH} characters`);
    }
    if (!normalizedValue || normalizedValue.length > VALUE_MAX_LENGTH) {
      throw new Error(`Fact value must be 1-${VALUE_MAX_LENGTH} characters`);
    }

    const existing = await this.memoryRepository.findOne({
      where: { workspaceId, key: normalizedKey },
    });
    if (existing) {
      existing.value = normalizedValue;
      existing.updatedByUserId = userId;
      return this.memoryRepository.save(existing);
    }
    return this.memoryRepository.save(
      this.memoryRepository.create({
        workspaceId,
        key: normalizedKey,
        value: normalizedValue,
        updatedByUserId: userId,
      }),
    );
  }

  /** Delete a fact. Returns whether one existed. */
  async forget(workspaceId: string, key: string): Promise<boolean> {
    const result = await this.memoryRepository.delete({ workspaceId, key: key.trim() });
    return (result.affected ?? 0) > 0;
  }

  /**
   * The workspace's facts rendered as a system-prompt block, or null when there
   * are none. Bounded: facts are included newest-first until the budget runs
   * out, so a bloated memory degrades gracefully instead of flooding the prompt.
   * Best-effort — a read failure returns null rather than failing the run.
   */
  async buildPromptBlock(workspaceId: string): Promise<string | null> {
    let facts: WorkspaceMemory[];
    try {
      facts = await this.list(workspaceId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to load workspace memory for ${workspaceId}: ${message}`);
      return null;
    }
    if (!facts.length) return null;

    const lines: string[] = [];
    let used = 0;
    for (const fact of facts) {
      const line = `- ${fact.key}: ${fact.value}`;
      if (used + line.length > PROMPT_BUDGET_CHARS) break;
      lines.push(line);
      used += line.length;
    }
    return `Workspace memory (durable facts saved in earlier conversations):\n${lines.join('\n')}`;
  }
}
