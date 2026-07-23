import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators';
import { AiRunResult, AiService } from './ai.service';
import { ModelDefinition } from './providers/model-catalog';
import { RunPromptDto } from './dto';

@ApiTags('ai')
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get('status')
  status(): { module: string; ready: boolean; providers: string[] } {
    return this.aiService.getStatus();
  }

  /**
   * The models this deployment can run, for the settings picker. `available` is
   * false for a model whose provider has no credentials configured.
   */
  @Get('models')
  models(): Array<ModelDefinition & { available: boolean }> {
    return this.aiService.listModels();
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
