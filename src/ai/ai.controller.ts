import { Controller, Get } from '@nestjs/common';
import { AiService } from './ai.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('ai')
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get('status')
  status(): { module: string; ready: boolean; provider: string } {
    return this.aiService.getStatus();
  }
}
