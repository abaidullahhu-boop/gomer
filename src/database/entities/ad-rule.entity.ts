import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AdRuleAction } from './ad-rule-action.entity';
import { User } from './user.entity';
import { Workspace } from './workspace.entity';

/** The performance metric a rule tests, evaluated over its lookback window. */
export type RuleMetric = 'spend' | 'cpa' | 'roas' | 'verified_roas' | 'ctr' | 'cpc';

/** How the metric is compared to the threshold. */
export type RuleComparator = 'gt' | 'lt' | 'gte' | 'lte';

/** The level the metric is read at and (for pause/scale) the entity acted on. */
export type RuleScope = 'account' | 'campaign' | 'adset';

/**
 * What a breach does:
 * - `alert`: notify only (the sole valid action at `account` scope).
 * - `pause`: pause the breaching campaign/ad set — reversible, so low-risk.
 * - `scale`: change the breaching entity's daily budget by `scalePct`.
 */
export type RuleActionType = 'alert' | 'pause' | 'scale';

/**
 * An automated rule that evaluates a Meta Ads metric on a schedule and acts on
 * the breaching entities — the "rule engine" for overnight pausing, CPA/ROAS
 * alerts, and budget scaling. Autonomous execution ({@link autoExecute}) is
 * bounded by guardrails ({@link maxScalePct}, {@link maxActionsPerRun},
 * {@link dailyActionCap}); pauses are reversible, scale-ups are hard-clamped.
 */
@Entity({ name: 'ad_rules' })
export class AdRule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  /** The Meta ad account the rule watches, e.g. "act_123". */
  @Column({ type: 'varchar', length: 64 })
  adAccountId!: string;

  @Column({ type: 'varchar', length: 16 })
  scope!: RuleScope;

  @Column({ type: 'varchar', length: 16 })
  metric!: RuleMetric;

  @Column({ type: 'varchar', length: 8 })
  comparator!: RuleComparator;

  @Column({ type: 'numeric', precision: 14, scale: 4 })
  threshold!: string;

  /** Lookback window in days the metric is measured over (e.g. 3 = last 3 days). */
  @Column({ type: 'integer', default: 3 })
  windowDays!: number;

  @Column({ type: 'varchar', length: 16 })
  action!: RuleActionType;

  /** For `scale`: percent change to the daily budget (e.g. -20 or 20). */
  @Column({ type: 'integer', nullable: true })
  scalePct!: number | null;

  // ── Guardrails ───────────────────────────────────────────────────────────

  /** Whether breaches execute autonomously (`scale`/`pause`) or only alert. */
  @Column({ type: 'boolean', default: true })
  autoExecute!: boolean;

  /** Hard ceiling on a single scale action's magnitude, in percent. */
  @Column({ type: 'integer', default: 25 })
  maxScalePct!: number;

  /** Most entities this rule may act on in one evaluation. */
  @Column({ type: 'integer', default: 10 })
  maxActionsPerRun!: number;

  /** Most actions this rule may take in a rolling 24h, across all runs. */
  @Column({ type: 'integer', default: 25 })
  dailyActionCap!: number;

  // ── Scheduling (mirrors ScheduledTask) ───────────────────────────────────

  @Column({ type: 'varchar', length: 128 })
  cronExpression!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  timezone!: string | null;

  /** Slack destination for alerts and post-action notifications. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  slackChannelId!: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastRun!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  nextRun!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspaceId' })
  workspace!: Workspace;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'createdByUserId' })
  createdBy!: User | null;

  @OneToMany(() => AdRuleAction, (action) => action.rule)
  actions!: AdRuleAction[];
}
