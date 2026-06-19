import { Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators';
import { SkillsService, SkillView } from './skills.service';

@ApiTags('skills')
@Controller('skills')
export class SkillsController {
  constructor(private readonly skillsService: SkillsService) {}

  /** Browse the available skill catalogue, flagged with the user's install state. */
  @Get()
  catalogue(@CurrentUser('userId') userId: string): Promise<SkillView[]> {
    return this.skillsService.findCatalogue(userId);
  }

  /** List the skills installed by the current user. */
  @Get('installed')
  installed(@CurrentUser('userId') userId: string): Promise<SkillView[]> {
    return this.skillsService.findInstalledForUser(userId);
  }

  /** Install a skill for the current user. */
  @Post(':id/install')
  install(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SkillView> {
    return this.skillsService.install(userId, id);
  }

  /** Uninstall a skill for the current user. */
  @Delete(':id/install')
  uninstall(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SkillView> {
    return this.skillsService.uninstall(userId, id);
  }
}
