import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AdRule } from './ad-rule.entity';
import { Workspace } from './workspace.entity';

/**
 * One action an {@link AdRule} took (or attempted) against a Meta entity during
 * an evaluation — the audit trail behind the rule engine. Also the source of
 * truth for the rolling daily-action guardrail (count rows in the last 24h) and
 * the after-the-fact Slack notification.
 */
@Entity({ name: 'ad_rule_actions' })
export class AdRuleAction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  ruleId!: string;

  @Index()
  @Column({ type: 'uuid' })
  workspaceId!: string;

  /** The kind of entity acted on: 'campaign' | 'adset' | 'account'. */
  @Column({ type: 'varchar', length: 16 })
  entityType!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  entityId!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  entityName!: string | null;

  /** The measured metric value that triggered (or was checked in) this action. */
  @Column({ type: 'numeric', precision: 14, scale: 4, nullable: true })
  metricValue!: string | null;

  /** What was done: 'alert' | 'pause' | 'scale'. */
  @Column({ type: 'varchar', length: 16 })
  action!: string;

  /** Human detail, e.g. "budget 500 → 600 PKR" or "paused (CPA 62 > 40)". */
  @Column({ type: 'text', nullable: true })
  detail!: string | null;

  @Column({ type: 'boolean', default: true })
  success!: boolean;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => AdRule, (rule) => rule.actions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ruleId' })
  rule!: AdRule;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspaceId' })
  workspace!: Workspace;
}
