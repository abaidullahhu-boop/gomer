export * from './workspace.entity';
export * from './user.entity';
export * from './integration.entity';
export * from './skill.entity';
export * from './user-skill.entity';
export * from './scheduled-task.entity';
export * from './credit-event.entity';
export * from './message.entity';
export * from './space.entity';
export * from './space-user.entity';
export * from './space-auth-token.entity';
export * from './space-record.entity';

import { CreditEvent } from './credit-event.entity';
import { Integration } from './integration.entity';
import { Message } from './message.entity';
import { ScheduledTask } from './scheduled-task.entity';
import { Skill } from './skill.entity';
import { SpaceAuthToken } from './space-auth-token.entity';
import { SpaceRecord } from './space-record.entity';
import { SpaceUser } from './space-user.entity';
import { Space } from './space.entity';
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
  Space,
  SpaceUser,
  SpaceAuthToken,
  SpaceRecord,
];
