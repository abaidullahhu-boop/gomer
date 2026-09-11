import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';

/**
 * The single answer to "is this person the platform owner?".
 *
 * Lives apart from the guard because two callers need it and only one of them
 * is guarding anything: the guard gates `/super-admin`, while `/auth/me`
 * reports the same answer so the dashboard can decide whether to render the
 * panel's nav entry at all. Both must agree — a UI that offers a link the API
 * then refuses is worse than no link.
 */
@Injectable()
export class SuperAdminAccessService {
  private readonly allowlist: ReadonlySet<string>;

  constructor(configService: ConfigService<AppConfig, true>) {
    this.allowlist = new Set(configService.get('superAdmin', { infer: true }).emails);
  }

  /**
   * Whether an email is on the allowlist.
   *
   * A user with no email is never a super admin. Slack can withhold the address
   * (the `users:read.email` scope is not granted, or a bot-ish account has
   * none), and treating a missing email as anything but a refusal would make
   * "no identity" the way in.
   */
  isSuperAdmin(email: string | null | undefined): boolean {
    if (!email) return false;
    return this.allowlist.has(email.trim().toLowerCase());
  }

  /** True when this deployment has no owner configured — the default. */
  get isConfigured(): boolean {
    return this.allowlist.size > 0;
  }
}
