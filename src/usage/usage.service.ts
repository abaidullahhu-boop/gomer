import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreditEvent } from '../database/entities';

export interface UsageSummary {
  totalCreditsUsed: number;
  totalTokensUsed: number;
  eventCount: number;
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
