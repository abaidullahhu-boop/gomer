import { EntitySubscriberInterface, EventSubscriber, InsertEvent } from 'typeorm';
import { UserRole } from '../../common/enums';
import { User } from '../entities/user.entity';

/**
 * Example entity subscriber. Ensures a sensible default role is always present
 * before a User is persisted. Subscribers are auto-registered via DatabaseModule.
 */
@EventSubscriber()
export class UserSubscriber implements EntitySubscriberInterface<User> {
  listenTo(): typeof User {
    return User;
  }

  beforeInsert(event: InsertEvent<User>): void {
    if (!event.entity.role) {
      event.entity.role = UserRole.MEMBER;
    }
  }
}
