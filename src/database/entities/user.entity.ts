import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { UserRole } from '../../common/enums';
import { CreditEvent } from './credit-event.entity';
import { Message } from './message.entity';
import { UserSkill } from './user-skill.entity';
import { Workspace } from './workspace.entity';

/**
 * A Slack-authenticated member of a workspace.
 * (slackUserId, workspaceId) is unique — the same Slack user can exist across tenants.
 */
@Entity({ name: 'users' })
@Unique('UQ_users_workspace_slack_user', ['workspaceId', 'slackUserId'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 64 })
  slackUserId!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email!: string | null;

  @Column({ type: 'text', nullable: true })
  avatarUrl!: string | null;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.MEMBER })
  role!: UserRole;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  lastActiveAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  refreshTokenHash!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => Workspace, (workspace) => workspace.users, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspaceId' })
  workspace!: Workspace;

  @OneToMany(() => UserSkill, (userSkill) => userSkill.user)
  userSkills!: UserSkill[];

  @OneToMany(() => CreditEvent, (creditEvent) => creditEvent.user)
  creditEvents!: CreditEvent[];

  @OneToMany(() => Message, (message) => message.user)
  messages!: Message[];
}
