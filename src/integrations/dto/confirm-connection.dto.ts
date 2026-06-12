import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Sent by the frontend after the Pipedream Connect popup succeeds, carrying the
 * newly connected account id so the backend can fetch and persist it.
 */
export class ConfirmConnectionDto {
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  @IsString()
  @IsNotEmpty()
  appSlug!: string;
}
