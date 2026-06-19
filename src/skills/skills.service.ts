import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Skill, UserSkill } from '../database/entities';

/** A category slug/label pair derived from a skill's free-text category. */
export interface SkillCategoryView {
  slug: string;
  label: string;
}

/**
 * A skill shaped for the dashboard, including whether the current user has it
 * installed. This is the contract the frontend consumes.
 */
export interface SkillView {
  id: string;
  slug: string;
  title: string;
  category: SkillCategoryView;
  description: string;
  tags: string[];
  author: string;
  isBundle: boolean;
  requiredIntegrations: string[];
  installed: boolean;
}

/** "Google Ads" -> "google-ads". */
function categorySlug(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, '-');
}

/**
 * Exposes the skill catalogue and lets a user install/uninstall skills.
 * Skill execution wiring will follow in a later phase.
 */
@Injectable()
export class SkillsService {
  constructor(
    @InjectRepository(Skill)
    private readonly skillRepository: Repository<Skill>,
    @InjectRepository(UserSkill)
    private readonly userSkillRepository: Repository<UserSkill>,
  ) {}

  /** The full catalogue, with each entry flagged by the user's install state. */
  async findCatalogue(userId: string): Promise<SkillView[]> {
    const [skills, installedIds] = await Promise.all([
      this.skillRepository.find({ order: { name: 'ASC' } }),
      this.installedSkillIds(userId),
    ]);
    return skills.map((skill) => this.toView(skill, installedIds.has(skill.id)));
  }

  /** Only the skills the user has installed. */
  async findInstalledForUser(userId: string): Promise<SkillView[]> {
    const userSkills = await this.userSkillRepository.find({
      where: { userId },
      relations: { skill: true },
      order: { installedAt: 'DESC' },
    });
    return userSkills.map((userSkill) => this.toView(userSkill.skill, true));
  }

  /** Install a skill for the user. Idempotent — re-installing is a no-op. */
  async install(userId: string, skillId: string): Promise<SkillView> {
    const skill = await this.skillRepository.findOne({ where: { id: skillId } });
    if (!skill) {
      throw new NotFoundException('Skill not found');
    }
    const existing = await this.userSkillRepository.findOne({ where: { userId, skillId } });
    if (!existing) {
      await this.userSkillRepository.insert({ userId, skillId });
    }
    return this.toView(skill, true);
  }

  /** Uninstall a skill for the user. Idempotent — uninstalling twice is fine. */
  async uninstall(userId: string, skillId: string): Promise<SkillView> {
    const skill = await this.skillRepository.findOne({ where: { id: skillId } });
    if (!skill) {
      throw new NotFoundException('Skill not found');
    }
    await this.userSkillRepository.delete({ userId, skillId });
    return this.toView(skill, false);
  }

  private async installedSkillIds(userId: string): Promise<Set<string>> {
    const rows = await this.userSkillRepository.find({
      where: { userId },
      select: { skillId: true },
    });
    return new Set(rows.map((row) => row.skillId));
  }

  private toView(skill: Skill, installed: boolean): SkillView {
    return {
      id: skill.id,
      slug: skill.slug,
      title: skill.name,
      category: { slug: categorySlug(skill.category), label: skill.category },
      description: skill.description,
      tags: skill.tags,
      author: skill.author,
      isBundle: skill.isBundle,
      requiredIntegrations: skill.requiredIntegrations,
      installed,
    };
  }
}
