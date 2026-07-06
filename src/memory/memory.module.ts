import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Message, WorkspaceMemory } from '../database/entities';
import { MessagesService } from './messages.service';
import { WorkspaceMemoryService } from './workspace-memory.service';

/**
 * Gomer's memory layer: per-thread conversation history ({@link MessagesService})
 * and durable cross-conversation workspace facts ({@link WorkspaceMemoryService}).
 */
@Module({
  imports: [TypeOrmModule.forFeature([Message, WorkspaceMemory])],
  providers: [MessagesService, WorkspaceMemoryService],
  exports: [MessagesService, WorkspaceMemoryService],
})
export class MemoryModule {}
