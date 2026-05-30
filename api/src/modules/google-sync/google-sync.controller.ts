import {
  BadRequestException, Body, Controller, Delete, Get, Post,
  Query, Req, Res, UseGuards,
} from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import type { Request, Response } from 'express';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/jwt-auth.guard';
import { ClientContextGuard, CurrentClientId } from '../auth/client-context.guard';
import { GoogleOauthService } from './google-oauth.service';
import { GoogleSyncService } from './google-sync.service';

// 'continue' = current "sheet wins" upsert; 'clean' = delete this client's
// invitations first, then re-import. Validated because main.ts runs
// ValidationPipe({ forbidNonWhitelisted: true }) — an unknown field 400s.
class RunSyncDto {
  @IsOptional()
  @IsIn(['continue', 'clean'])
  mode?: 'continue' | 'clean';
}

// Guards are applied per-handler instead of at the class level because the
// `oauth/callback` endpoint MUST be public: Google redirects the browser there
// as a top-level navigation, so no Authorization header (and no X-Client-Id
// header) is present. Identity on that endpoint is recovered from the signed
// `state` HMAC. Authenticated handlers add ClientContextGuard so RolesGuard can
// read req.membershipRole (set only by ClientContextGuard).
@Controller('google-sync')
export class GoogleSyncController {
  constructor(
    private readonly oauth: GoogleOauthService,
    private readonly sync: GoogleSyncService,
  ) {}

  @Get('status')
  @UseGuards(JwtAuthGuard, ClientContextGuard, RolesGuard)
  @Roles('OWNER', 'EDITOR')
  status(@Req() req: Request) {
    return this.sync.getStatus((req.user as any).id);
  }

  @Get('oauth/url')
  @UseGuards(JwtAuthGuard, ClientContextGuard, RolesGuard)
  @Roles('OWNER', 'EDITOR')
  authUrl(@Req() req: Request) {
    return { url: this.oauth.buildAuthUrl((req.user as any).id) };
  }

  @Get('oauth/callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    // Bounce back to the SPA in all branches so the user lands somewhere useful.
    if (error) {
      return res.redirect(`/?googleConnectError=${encodeURIComponent(error)}`);
    }
    if (!code || !state) {
      return res.redirect('/?googleConnectError=missing_params');
    }
    try {
      await this.oauth.handleCallback(code, state);
      return res.redirect('/?googleConnected=1');
    } catch (err: any) {
      const message = err?.response?.data?.message ?? err?.message ?? 'unknown';
      return res.redirect(`/?googleConnectError=${encodeURIComponent(String(message))}`);
    }
  }

  @Delete('connection')
  @UseGuards(JwtAuthGuard, ClientContextGuard, RolesGuard)
  @Roles('OWNER', 'EDITOR')
  async disconnect(@Req() req: Request) {
    await this.sync.disconnect((req.user as any).id);
    return { ok: true };
  }

  @Post('run')
  @UseGuards(JwtAuthGuard, ClientContextGuard, RolesGuard)
  @Roles('OWNER', 'EDITOR')
  async run(
    @Req() req: Request,
    @CurrentClientId() clientId: string,
    @Body() body: RunSyncDto,
  ) {
    const userId = (req.user as any)?.id;
    if (!userId) throw new BadRequestException('Missing user');
    return this.sync.run(userId, clientId, body.mode ?? 'continue');
  }
}
