import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../ai/ai.module';
import { ScheduledTask } from '../database/entities';
import { TasksController } from './tasks.controller';
import { TasksScheduler } from './tasks.scheduler';
import { TasksService } from './tasks.service';

@Module({
  imports: [TypeOrmModule.forFeature([ScheduledTask]), AiModule],
  controllers: [TasksController],
  providers: [TasksService, TasksScheduler],
  exports: [TasksService],
})
export class TasksModule {}
