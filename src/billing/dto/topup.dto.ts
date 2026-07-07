import { IsNotEmpty, IsString } from 'class-validator';

/** Starts a Stripe Checkout for one of the offered credit packs. */
export class TopupDto {
  @IsString()
  @IsNotEmpty()
  packId!: string;
}
