import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** A natural-language instruction for Viktor to act on. */
export class RunPromptDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  prompt!: string;
}
