/**
 * Auth guards are implemented in `common/guards` so they can be applied
 * globally (JwtAuthGuard, RolesGuard). Re-exported here for module locality.
 */
export { JwtAuthGuard, RolesGuard } from '../../common/guards';
