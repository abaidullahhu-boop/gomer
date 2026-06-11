import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Message } from '../database/entities';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [TypeOrmModule.forFeature([Message])],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
