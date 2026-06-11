import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../common/decorators';
import { Skill, UserSkill } from '../database/entities';
import { SkillsService } from './skills.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('skills')
@Controller('skills')
export class SkillsController {
  constructor(private readonly skillsService: SkillsService) {}

  /** Browse the available skill catalogue. */
  @Get()
  catalogue(): Promise<Skill[]> {
    return this.skillsService.findCatalogue();
  }

  /** List the skills installed by the current user. */
  @Get('installed')
  installed(@CurrentUser('userId') userId: string): Promise<UserSkill[]> {
    return this.skillsService.findInstalledForUser(userId);
  }
}
