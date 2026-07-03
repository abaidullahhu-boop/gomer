import { IsIn, IsOptional } from 'class-validator';
import type { IntegrationAccessLevel } from '../../database/entities';

/**
 * Query for starting a Meta Ads connect. The access level decides whether the
 * resulting connection is shared with the whole team or kept private to the
 * connecting member, and is stamped onto the integration row after consent.
 * Defaults to `team`.
 */
export class MetaAuthorizeDto {
  @IsOptional()
  @IsIn(['team', 'private'])
  accessLevel?: IntegrationAccessLevel;
}
