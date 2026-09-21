import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsEmail } from 'class-validator';
import { MAX_INVITES_PER_REQUEST } from '../invites.service';

/** Body for `POST /users/invites`: the addresses an admin typed into the invite dialog. */
export class InviteMembersDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_INVITES_PER_REQUEST)
  @IsEmail({}, { each: true })
  emails!: string[];
}
