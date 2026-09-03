import { IsNotEmpty, IsString } from 'class-validator';

/** Starts a Stripe Checkout for one of the offered recurring plans. */
export class SubscribeDto {
  @IsString()
  @IsNotEmpty()
  planId!: string;
}
