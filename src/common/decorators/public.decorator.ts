import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../constants';

/**
 * Marks a route as publicly accessible, bypassing the global JWT auth guard.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
