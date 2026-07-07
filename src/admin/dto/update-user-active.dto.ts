import { IsBoolean } from 'class-validator';

/** Activates or deactivates a workspace member. */
export class UpdateUserActiveDto {
  @IsBoolean()
  isActive!: boolean;
}
