import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { getGoogleClientId } from '../../config/google.config';
import { THROTTLER } from '../../config/throttler.config';
import { AuthService } from './auth.service';
import { JwtAuthGuard, SuperAdminGuard } from './jwt-auth.guard';

class LoginDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(6) password!: string;
}

class CreateUserDto extends LoginDto {
  @IsString() @MaxLength(120) displayName!: string;
  @IsIn(['OWNER', 'EDITOR', 'VIEWER']) role!: 'OWNER' | 'EDITOR' | 'VIEWER';
  @IsOptional() @IsIn(['en', 'sr']) locale?: 'en' | 'sr';
}

class GoogleLoginDto {
  // The Google-signed ID token (JWT) produced in the browser by GIS.
  @IsString() @IsNotEmpty() idToken!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  // Override the configured 'long' throttler (app.module.ts names its throttlers
  // 'short'/'long' — a key that matches no configured throttler is silently
  // ignored and leaves the global 30/min in force, which is why the key comes
  // from the shared THROTTLER const). The global 'short' 5/sec guard still applies.
  @Throttle({ [THROTTLER.LONG]: { limit: 5, ttl: 60_000 } })    // 5 attempts / min / IP
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  // Public: the SPA fetches the (public) Google client id at runtime to
  // initialise the GIS button, instead of baking it in at Vite build time.
  @Get('config')
  config() {
    return { googleClientId: getGoogleClientId() };
  }

  // Public: identity is proven by the Google-signed ID token in the body, not
  // an Authorization header. Same throttle window as login (a bit more lenient
  // since GIS can fire a couple of times around the account chooser).
  @Post('google')
  @Throttle({ [THROTTLER.LONG]: { limit: 10, ttl: 60_000 } })   // 10 / min / IP
  googleLogin(@Body() dto: GoogleLoginDto) {
    return this.auth.loginWithGoogle(dto.idToken);
  }

  // User provisioning is a platform action: only super-admins create accounts.
  // Membership in a specific client is granted separately via /api/clients.
  @Post('register')
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Throttle({ [THROTTLER.LONG]: { limit: 3, ttl: 3_600_000 } }) // 3 / hour / IP
  register(@Body() dto: CreateUserDto) {
    return this.auth.register(dto.email, dto.password, dto.displayName, dto.role, dto.locale);
  }

  // The SPA calls this on reload to rebuild its client selector + role gates
  // without forcing a fresh login. Returns the same user view as login,
  // including the caller's client memberships.
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: any) {
    return this.auth.me(req.user.id);
  }
}
