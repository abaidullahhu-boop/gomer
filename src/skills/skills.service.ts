import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Skill, UserSkill } from '../database/entities';

/**
 * Scaffold service exposing the skill catalogue and a user's installed skills.
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

  findCatalogue(): Promise<Skill[]> {
    return this.skillRepository.find({ order: { name: 'ASC' } });
  }

  findInstalledForUser(userId: string): Promise<UserSkill[]> {
    return this.userSkillRepository.find({
      where: { userId },
      relations: { skill: true },
    });
  }
}
