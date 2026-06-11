import { UserSubscriber } from './user.subscriber';

export * from './user.subscriber';

/** All entity subscribers, registered with the runtime DataSource. */
export const subscribers = [UserSubscriber];
