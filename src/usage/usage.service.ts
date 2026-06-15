import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreditEventType } from '../common/enums';
import { CreditEvent } from '../database/entities';

export interface UsageSummary {
  totalCreditsUsed: number;
  totalTokensUsed: number;
  eventCount: number;
}

/** Tokens consumed per credit. Placeholder billing rate until pricing lands. */
const TOKENS_PER_CREDIT = 1000;

/** A single unit of metered consumption to persist. */
export interface RecordUsageInput {
  workspaceId: string;
  userId?: string | null;
  model: string;
  tokensUsed: number;
  /** Human label for what spent the credits, e.g. an app or feature name. */
  sourceName: string;
  type?: CreditEventType;
}

/**
 * Scaffold service for credit/token usage reporting.
 */
@Injectable()
export class UsageService {
  constructor(
    @InjectRepository(CreditEvent)
    private readonly creditEventRepository: Repository<CreditEvent>,
  ) {}

  /**
   * Persist an immutable usage event. Credits are derived from tokens at a flat
   * placeholder rate; swap {@link TOKENS_PER_CREDIT} for real pricing later.
   */
  recordEvent(input: RecordUsageInput): Promise<CreditEvent> {
    const event = this.creditEventRepository.create({
      workspaceId: input.workspaceId,
      userId: input.userId ?? null,
      type: input.type ?? CreditEventType.THREAD,
      sourceName: input.sourceName,
      tokensUsed: input.tokensUsed,
      creditsUsed: Math.ceil(input.tokensUsed / TOKENS_PER_CREDIT),
      model: input.model,
    });
    return this.creditEventRepository.save(event);
  }

  findRecentForWorkspace(workspaceId: string, limit = 50): Promise<CreditEvent[]> {
    return this.creditEventRepository.find({
      where: { workspaceId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async summarizeForWorkspace(workspaceId: string): Promise<UsageSummary> {
    const { credits, tokens, count } = await this.creditEventRepository
      .createQueryBuilder('event')
      .select('COALESCE(SUM(event.creditsUsed), 0)', 'credits')
      .addSelect('COALESCE(SUM(event.tokensUsed), 0)', 'tokens')
      .addSelect('COUNT(event.id)', 'count')
      .where('event.workspaceId = :workspaceId', { workspaceId })
      .getRawOne<{ credits: string; tokens: string; count: string }>()
      .then((raw) => raw ?? { credits: '0', tokens: '0', count: '0' });

    return {
      totalCreditsUsed: Number(credits),
      totalTokensUsed: Number(tokens),
      eventCount: Number(count),
    };
  }
}
