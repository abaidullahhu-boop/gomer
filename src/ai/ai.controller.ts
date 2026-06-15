import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators';
import { AiRunResult, AiService } from './ai.service';
import { RunPromptDto } from './dto';

@ApiTags('ai')
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get('status')
  status(): { module: string; ready: boolean; provider: string } {
    return this.aiService.getStatus();
  }

  /** Run a prompt for the current workspace, acting across its connected apps. */
  @Post('run')
  run(
    @CurrentUser('workspaceId') workspaceId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: RunPromptDto,
  ): Promise<AiRunResult> {
    return this.aiService.run(workspaceId, userId, dto.prompt);
  }
}
