import { IsEnum } from 'class-validator';
import { UserRole } from '../../common/enums';

/** Sent by an admin to promote or demote a workspace member. */
export class UpdateUserRoleDto {
  @IsEnum(UserRole)
  role!: UserRole;
}
