export * from './workspace.entity';
export * from './user.entity';
export * from './integration.entity';
export * from './skill.entity';
export * from './user-skill.entity';
export * from './scheduled-task.entity';
export * from './credit-event.entity';
export * from './message.entity';

import { CreditEvent } from './credit-event.entity';
import { Integration } from './integration.entity';
import { Message } from './message.entity';
import { ScheduledTask } from './scheduled-task.entity';
import { Skill } from './skill.entity';
import { User } from './user.entity';
import { UserSkill } from './user-skill.entity';
import { Workspace } from './workspace.entity';

/** Convenience array of every entity, used for TypeORM registration. */
export const entities = [
  Workspace,
  User,
  Integration,
  Skill,
  UserSkill,
  ScheduledTask,
  CreditEvent,
  Message,
];
