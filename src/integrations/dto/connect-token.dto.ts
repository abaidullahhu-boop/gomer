import { IsIn, IsOptional } from 'class-validator';
import type { IntegrationAccessLevel } from '../../database/entities';

/**
 * Sent when minting a Pipedream Connect token. The access level decides which
 * Pipedream `external_user_id` the about-to-be-connected account lives under,
 * so it must be chosen before the popup opens. Defaults to `team`.
 */
export class ConnectTokenDto {
  @IsOptional()
  @IsIn(['team', 'private'])
  accessLevel?: IntegrationAccessLevel;
}
