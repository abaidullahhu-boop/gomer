import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { UserSkill } from './user-skill.entity';

/**
 * A reusable capability/persona that users can install. A "bundle" groups
 * several skills and may require external integrations to function.
 */
@Entity({ name: 'skills' })
export class Skill {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'varchar', length: 128 })
  category!: string;

  @Column({ type: 'text' })
  systemPrompt!: string;

  @Column({ type: 'varchar', length: 255 })
  author!: string;

  @Column({ type: 'simple-array', default: '' })
  tags!: string[];

  @Column({ type: 'boolean', default: false })
  isBundle!: boolean;

  @Column({ type: 'simple-array', default: '' })
  requiredIntegrations!: string[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => UserSkill, (userSkill) => userSkill.skill)
  userSkills!: UserSkill[];
}
