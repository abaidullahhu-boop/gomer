import { Body, Controller, Get, Headers, Post, RawBodyRequest, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser, Public, RateLimit } from '../common/decorators';
import { UsageService } from '../usage/usage.service';
import { BillingService } from './billing.service';
import { SubscriptionsService } from './subscriptions.service';
import { SubscribeDto, TopupDto } from './dto';

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly usageService: UsageService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  /**
   * Everything the billing page needs: the bucket-split balance, the plans and
   * packs on offer, the current subscription, and the grant history.
   */
  @Get('summary')
  async summary(@CurrentUser('workspaceId') workspaceId: string) {
    const [balance, grants, subscription] = await Promise.all([
      this.usageService.getBalance(workspaceId),
      this.usageService.findGrantsForWorkspace(workspaceId),
      this.subscriptionsService.findForWorkspace(workspaceId),
    ]);
    return {
      balance,
      packs: this.billingService.getPacks(),
      plans: this.billingService.getPlans(),
      subscription,
      grants,
    };
  }

  /**
   * Start a subscription checkout. Rate-limited like the top-up route, for the
   * same reason: an unbounded loop here spends our Stripe API quota.
   */
  /**
   * A link into Stripe's billing portal, where a member can update a failed
   * card, cancel, resume, or fetch invoices. Rate-limited like the checkout
   * routes, since each call is a Stripe API request on our quota.
   */
  @RateLimit({ limit: 15, windowSeconds: 15 * 60 })
  @Post('portal')
  portal(@CurrentUser('workspaceId') workspaceId: string) {
    return this.billingService.createPortalSession(workspaceId);
  }

  @RateLimit({ limit: 15, windowSeconds: 15 * 60 })
  @Post('subscribe')
  subscribe(
    @CurrentUser('workspaceId') workspaceId: string,
    @CurrentUser('userId') userId: string | null,
    @Body() dto: SubscribeDto,
  ) {
    return this.billingService.createSubscriptionSession(workspaceId, userId ?? null, dto.planId);
  }

  /**
   * Start a Stripe Checkout for a credit pack; returns the payment URL. Limited
   * per member so a loop can't hammer Stripe's API on our account's quota.
   */
  @RateLimit({ limit: 15, windowSeconds: 15 * 60 })
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
