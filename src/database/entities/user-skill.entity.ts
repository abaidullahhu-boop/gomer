import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Skill } from './skill.entity';
import { User } from './user.entity';

/**
 * Join entity recording that a user has installed a skill.
 */
@Entity({ name: 'user_skills' })
@Unique('UQ_user_skills_user_skill', ['userId', 'skillId'])
export class UserSkill {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @Index()
  @Column({ type: 'uuid' })
  skillId!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  installedAt!: Date;

  @ManyToOne(() => User, (user) => user.userSkills, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @ManyToOne(() => Skill, (skill) => skill.userSkills, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'skillId' })
  skill!: Skill;
}
