import { Body, Controller, Get, Headers, Post, RawBodyRequest, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser, Public } from '../common/decorators';
import { UsageService } from '../usage/usage.service';
import { BillingService } from './billing.service';
import { TopupDto } from './dto';

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly usageService: UsageService,
  ) {}

  /** Everything the billing page needs: balance, offered packs, grant history. */
  @Get('summary')
  async summary(@CurrentUser('workspaceId') workspaceId: string) {
    const [balance, grants] = await Promise.all([
      this.usageService.getBalance(workspaceId),
      this.usageService.findGrantsForWorkspace(workspaceId),
    ]);
    return { balance, packs: this.billingService.getPacks(), grants };
  }

  /** Start a Stripe Checkout for a credit pack; returns the payment URL. */
  @Post('topup')
  topup(
    @CurrentUser('workspaceId') workspaceId: string,
    @CurrentUser('userId') userId: string | null,
    @Body() dto: TopupDto,
  ) {
    return this.billingService.createTopupSession(workspaceId, userId ?? null, dto.packId);
  }

  /**
   * Stripe webhook receiver. Public by necessity — authenticity is enforced by
   * verifying Stripe's HMAC signature over the raw payload.
   */
  @Public()
  @Post('webhook')
  webhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    return this.billingService.handleWebhook(request.rawBody, signature);
  }
}
