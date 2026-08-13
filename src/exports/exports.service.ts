import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CronExpressionParser } from 'cron-parser';
import { Repository } from 'typeorm';
import { ExportDataset, ScheduledExport } from '../database/entities';
import { IntegrationsService } from '../integrations/integrations.service';
import { MetaAdsService } from '../integrations/meta-ads.service';
import { RoasService } from '../integrations/roas.service';
import { SheetsService, type ExportTable } from '../integrations/sheets.service';
import { RulesService } from '../rules/rules.service';
import {
  CAMPAIGN_INSIGHT_FIELDS,
  campaignInsightTable,
  roasSnapshotTable,
  ruleActionTable,
  type CampaignInsightRow,
} from './export-tables';

/** Most rows one run appends, bounding a first run over a long backlog. */
const MAX_ROWS_PER_RUN = 500;

/** The datasets an export may target. */
export const EXPORT_DATASETS: ExportDataset[] = [
  'roas_snapshots',
  'campaign_insights',
  'rule_actions',
];

/** What a member supplies to define an export, one-off or recurring. */
export interface ExportRequest {
  dataset: ExportDataset;
  /** Required by `campaign_insights`. */
  adAccountId?: string | null;
  windowDays?: number;
  spreadsheetId?: string | null;
  spreadsheetTitle?: string | null;
  sheetTitle?: string | null;
}

export interface CreateScheduledExportInput extends ExportRequest {
  name: string;
  cronExpression: string;
  timezone?: string | null;
  slackChannelId?: string | null;
}

/** The outcome of one export run, for the caller (tool or scheduler) to relay. */
export interface ExportRunResult {
  dataset: ExportDataset;
  rowsExported: number;
  spreadsheetId: string;
  spreadsheetUrl: string;
  sheetTitle: string;
  /** True when the run created the spreadsheet rather than appending to one. */
  spreadsheetCreated: boolean;
  /** Window the rows cover, for the confirmation message. */
  since: string;
  until: string;
}

/** A scheduled export's report, for the scheduler to deliver to Slack. */
export interface ExportRunReport {
  exportId: string;
  exportName: string;
  workspaceId: string;
  slackChannelId: string | null;
  /** Slack mrkdwn to post, or null when the run had nothing worth surfacing. */
  message: string | null;
}

/**
 * Google Sheets export automation: writes Gomer's own reporting data (verified
 * ROAS, campaign performance, rule-engine actions) into a spreadsheet, either
 * once on request or on a recurring schedule.
 *
 * The write path is deterministic and model-free by design — a scheduled export
 * fires at 6am with nobody to correct a misapplied tool call, so it resolves the
 * data and the destination itself rather than asking the assistant to drive
 * Google Sheets MCP actions.
 *
 * Slack notification is intentionally NOT done here: {@link runDueExports}
 * returns per-export reports and the leaf scheduler posts them, keeping this
 * service free of a SlackModule import (which would cycle back through AiModule)
 * — the same split as the rule engine.
 */
@Injectable()
export class ExportsService {
  private readonly logger = new Logger(ExportsService.name);

  constructor(
    @InjectRepository(ScheduledExport)
    private readonly exportRepository: Repository<ScheduledExport>,
    private readonly integrationsService: IntegrationsService,
    private readonly sheets: SheetsService,
    private readonly roasService: RoasService,
    private readonly rulesService: RulesService,
    private readonly metaAds: MetaAdsService,
  ) {}

  // ── One-off exports ────────────────────────────────────────────────────────

  /**
   * Export a dataset to a sheet right now. Throws when Google Sheets isn't
   * connected or the write fails — the tool dispatcher turns that into an error
   * result the model can relay.
   */
  async exportNow(
    workspaceId: string,
    userId: string | null,
    request: ExportRequest,
  ): Promise<ExportRunResult> {
    this.validateRequest(request);
    const windowDays = request.windowDays ?? 7;
    const { since, until } = this.window(windowDays);
    // A one-off export covers the whole window rather than resuming a watermark:
    // asking for "the last 30 days" should produce the last 30 days.
    const { table } = await this.buildTable(
      workspaceId,
      userId,
      request,
      this.daysAgo(windowDays),
      { since, until },
    );
    const written = await this.write(workspaceId, userId, request, table);
    return {
      dataset: request.dataset,
      rowsExported: table.rows.length,
      spreadsheetId: written.spreadsheetId,
      spreadsheetUrl: written.spreadsheetUrl,
      sheetTitle: written.sheetTitle,
      spreadsheetCreated: written.spreadsheetCreated,
      since,
      until,
    };
  }

  // ── CRUD for recurring exports ─────────────────────────────────────────────

  async create(
    workspaceId: string,
    userId: string | null,
    input: CreateScheduledExportInput,
  ): Promise<ScheduledExport> {
    this.validateRequest(input);
    const timezone = input.timezone ?? null;
    return this.exportRepository.save(
      this.exportRepository.create({
        workspaceId,
        name: input.name,
        dataset: input.dataset,
        adAccountId: input.adAccountId ?? null,
        windowDays: input.windowDays ?? 7,
        spreadsheetId: input.spreadsheetId ?? null,
        spreadsheetTitle: input.spreadsheetTitle ?? input.name,
        sheetTitle: input.sheetTitle ?? this.defaultSheetTitle(input.dataset),
        cronExpression: input.cronExpression,
        timezone,
        slackChannelId: input.slackChannelId ?? null,
        isActive: true,
        createdByUserId: userId,
        nextRun: this.nextRunFrom(input.cronExpression, timezone),
      }),
    );
  }

  list(workspaceId: string): Promise<ScheduledExport[]> {
    return this.exportRepository.find({ where: { workspaceId }, order: { createdAt: 'DESC' } });
  }

  async setActive(workspaceId: string, id: string, isActive: boolean): Promise<ScheduledExport> {
    const scheduled = await this.findOwned(workspaceId, id);
    scheduled.isActive = isActive;
    if (isActive) {
      scheduled.nextRun = this.nextRunFrom(scheduled.cronExpression, scheduled.timezone);
    }
    return this.exportRepository.save(scheduled);
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    const scheduled = await this.findOwned(workspaceId, id);
    await this.exportRepository.remove(scheduled);
  }

  /** Run a scheduled export immediately, without disturbing its schedule. */
  async runNow(workspaceId: string, id: string): Promise<ExportRunReport> {
    const scheduled = await this.findOwned(workspaceId, id);
    return this.runExport(scheduled, { advanceSchedule: false });
  }

  // ── Scheduled execution ────────────────────────────────────────────────────

  /**
   * Run every active export that is due and return a report per export for the
   * scheduler to deliver. One export's failure never blocks the others.
   */
  async runDueExports(now: Date = new Date()): Promise<ExportRunReport[]> {
    const due = await this.exportRepository
      .createQueryBuilder('export')
      .where('export.isActive = :active', { active: true })
      .andWhere('export.nextRun IS NOT NULL')
      .andWhere('export.nextRun <= :now', { now })
      .getMany();

    const reports: ExportRunReport[] = [];
    for (const scheduled of due) {
      reports.push(await this.runExport(scheduled, { advanceSchedule: true }));
    }
    return reports;
  }

  /**
   * Execute one scheduled export: resume from its watermark, write, then record
   * the outcome. A failure is captured on the row (`lastError`) and reported
   * rather than thrown, so the schedule always advances and one broken export
   * never stalls the tick.
   */
  private async runExport(
    scheduled: ScheduledExport,
    options: { advanceSchedule: boolean },
  ): Promise<ExportRunReport> {
    const { since, until } = this.window(scheduled.windowDays);
    const startedAt = new Date();
    try {
      // Event datasets resume from the last exported row so repeat runs append
      // only what is new; the first run backfills the lookback window.
      const watermark = scheduled.lastExportedAt ?? this.daysAgo(scheduled.windowDays);
      const built = await this.buildTable(
        scheduled.workspaceId,
        scheduled.createdByUserId,
        scheduled,
        watermark,
        { since, until },
      );
      const written = await this.write(
        scheduled.workspaceId,
        scheduled.createdByUserId,
        scheduled,
        built.table,
      );

      scheduled.spreadsheetId = written.spreadsheetId;
      scheduled.spreadsheetUrl = written.spreadsheetUrl;
      scheduled.lastRowCount = built.table.rows.length;
      scheduled.lastError = null;
      // Advance only as far as the rows actually written; a run that exported
      // nothing still moves forward so it doesn't rescan the same empty span.
      scheduled.lastExportedAt = built.watermark ?? startedAt;
      return this.report(
        scheduled,
        this.successMessage(scheduled, built.table.rows.length, written.url),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Export ${scheduled.id} (${scheduled.name}) failed: ${message}`);
      scheduled.lastError = message;
      scheduled.lastRowCount = null;
      return this.report(scheduled, `⚠️ Export *${scheduled.name}* failed: ${message}`);
    } finally {
      scheduled.lastRun = new Date();
      if (options.advanceSchedule) {
        scheduled.nextRun = this.nextRunFrom(scheduled.cronExpression, scheduled.timezone);
      }
      await this.exportRepository.save(scheduled);
    }
  }

  // ── Data & destination ─────────────────────────────────────────────────────

  /**
   * Assemble the rows for a dataset over its window, along with the watermark a
   * repeat run should resume from. That watermark is the newest row actually
   * exported — not the wall clock — so rows written while a slow export is
   * running are picked up next time instead of being skipped, and a backlog
   * truncated at {@link MAX_ROWS_PER_RUN} resumes where it left off rather than
   * silently dropping the remainder.
   */
  private async buildTable(
    workspaceId: string,
    userId: string | null,
    request: ExportRequest,
    watermark: Date,
    window: { since: string; until: string },
  ): Promise<{ table: ExportTable; watermark: Date | null }> {
    switch (request.dataset) {
      case 'roas_snapshots': {
        const snapshots = await this.roasService.snapshotsSince(
          workspaceId,
          watermark,
          MAX_ROWS_PER_RUN,
        );
        return {
          table: roasSnapshotTable(snapshots),
          watermark: this.newest(snapshots.map((snapshot) => snapshot.createdAt)),
        };
      }
      case 'rule_actions': {
        const actions = await this.rulesService.actionsForWorkspace(
          workspaceId,
          watermark,
          MAX_ROWS_PER_RUN,
        );
        return {
          table: ruleActionTable(actions),
          watermark: this.newest(actions.map((action) => action.createdAt)),
        };
      }
      case 'campaign_insights': {
        const token = await this.integrationsService.getMetaAccessToken(workspaceId, userId);
        if (!token) throw new Error('No active Meta Ads connection is available.');
        const insights = await this.metaAds.getInsights(token, {
          adAccountId: request.adAccountId!,
          level: 'campaign',
          since: window.since,
          until: window.until,
          fields: CAMPAIGN_INSIGHT_FIELDS,
        });
        // Insights are a re-measurement of the window, not an event stream, so
        // there is no row watermark to resume from.
        return {
          table: campaignInsightTable((insights.data ?? []) as CampaignInsightRow[], {
            since: window.since,
            until: window.until,
            exportedAt: new Date(),
          }),
          watermark: null,
        };
      }
    }
  }

  /** The latest of a set of timestamps, or null when there were none. */
  private newest(dates: Date[]): Date | null {
    return dates.reduce<Date | null>(
      (latest, date) => (latest == null || date > latest ? date : latest),
      null,
    );
  }

  /** Resolve the Sheets token and write the table to its destination. */
  private async write(
    workspaceId: string,
    userId: string | null,
    request: ExportRequest,
    table: ExportTable,
  ): Promise<{
    spreadsheetId: string;
    spreadsheetUrl: string;
    sheetTitle: string;
    spreadsheetCreated: boolean;
    url: string;
  }> {
    const credential = await this.integrationsService.getGoogleSheetsCredential(
      workspaceId,
      userId,
    );
    if (!credential) {
      throw new Error(
        'No active Google Sheets connection is available — connect Google Sheets in Integrations first.',
      );
    }
    const destination = {
      spreadsheetId: request.spreadsheetId ?? null,
      spreadsheetTitle: request.spreadsheetTitle ?? this.defaultTitle(request.dataset),
      sheetTitle: request.sheetTitle ?? this.defaultSheetTitle(request.dataset),
    };

    // A failed write is never retried: it may have partially landed, and a
    // second attempt would duplicate rows in the sheet.
    const written = await this.sheets.writeTable(credential, destination, table);
    return { ...written, url: written.spreadsheetUrl };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private successMessage(scheduled: ScheduledExport, rows: number, url: string): string | null {
    // A recurring export with nothing new stays quiet rather than posting a
    // daily "0 rows" into the channel.
    if (!rows) return null;
    return (
      `📊 Export *${scheduled.name}* — ${rows} ${this.datasetLabel(scheduled.dataset)} row(s) ` +
      `added to <${url}|${scheduled.sheetTitle}>.`
    );
  }

  private datasetLabel(dataset: ExportDataset): string {
    switch (dataset) {
      case 'roas_snapshots':
        return 'verified ROAS';
      case 'campaign_insights':
        return 'campaign performance';
      case 'rule_actions':
        return 'rule action';
    }
  }

  private defaultTitle(dataset: ExportDataset): string {
    return `Gomer — ${this.defaultSheetTitle(dataset)}`;
  }

  private defaultSheetTitle(dataset: ExportDataset): string {
    switch (dataset) {
      case 'roas_snapshots':
        return 'Verified ROAS';
      case 'campaign_insights':
        return 'Campaign Performance';
      case 'rule_actions':
        return 'Rule Actions';
    }
  }

  private window(days: number): { since: string; until: string } {
    const until = new Date();
    return { since: this.date(this.daysAgo(days)), until: this.date(until) };
  }

  private daysAgo(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  private date(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  private report(scheduled: ScheduledExport, message: string | null): ExportRunReport {
    return {
      exportId: scheduled.id,
      exportName: scheduled.name,
      workspaceId: scheduled.workspaceId,
      slackChannelId: scheduled.slackChannelId,
      message,
    };
  }

  private async findOwned(workspaceId: string, id: string): Promise<ScheduledExport> {
    const scheduled = await this.exportRepository.findOne({ where: { id, workspaceId } });
    if (!scheduled) throw new NotFoundException('Export not found');
    return scheduled;
  }

  private validateRequest(request: ExportRequest & { cronExpression?: string }): void {
    if (!EXPORT_DATASETS.includes(request.dataset)) {
      throw new BadRequestException(
        `Unknown dataset "${request.dataset}" — expected one of ${EXPORT_DATASETS.join(', ')}`,
      );
    }
    if (request.dataset === 'campaign_insights' && !request.adAccountId) {
      throw new BadRequestException('campaign_insights exports need an ad account id');
    }
    if (request.windowDays != null && (request.windowDays < 1 || request.windowDays > 365)) {
      throw new BadRequestException('windowDays must be between 1 and 365');
    }
    if (request.cronExpression) {
      this.nextRunFrom(request.cronExpression, null); // validates cron
    }
  }

  private nextRunFrom(cronExpression: string, timezone: string | null): Date {
    try {
      return CronExpressionParser.parse(cronExpression, { tz: timezone ?? undefined })
        .next()
        .toDate();
    } catch {
      throw new BadRequestException(`Invalid cron expression: "${cronExpression}"`);
    }
  }
}
