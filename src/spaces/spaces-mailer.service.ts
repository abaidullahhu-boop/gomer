import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';

/**
 * Delivers Space magic-link emails. There is no email provider configured
 * locally, so the only transport today is a console/dev one that logs the link
 * and reports back that we are in dev — letting the API surface the link in its
 * response so a developer (or the demo) can follow it without a real inbox.
 *
 * Swapping in a real transport (SES, Postmark, …) later means implementing
 * `send` against this same shape; nothing else in the feature changes.
 */
@Injectable()
export class SpacesMailerService {
  private readonly logger = new Logger(SpacesMailerService.name);

  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  /** True when we have no real email provider and may reveal links in dev. */
  get isDev(): boolean {
    return this.configService.get('app.nodeEnv', { infer: true }) !== 'production';
  }

  /** "Send" a magic link. In dev this just logs it. */
  async sendMagicLink(email: string, link: string): Promise<void> {
    this.logger.log(`Magic link for ${email}: ${link}`);
    return Promise.resolve();
  }
}
