import { IsEmail } from 'class-validator';

/** Body for requesting a Space magic-link login. */
export class RequestMagicLinkDto {
  @IsEmail()
  email!: string;
}
