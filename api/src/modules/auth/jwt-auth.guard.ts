import {
  CanActivate, ExecutionContext, Injectable, SetMetadata,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';

export const JwtAuthGuard = AuthGuard('jwt');

export const Roles = (...roles: Array<'OWNER' | 'EDITOR' | 'VIEWER'>) =>
  SetMetadata('roles', roles);

// Gate by the caller's role WITHIN the current client. The per-client role is
// set on req.membershipRole by ClientContextGuard, so pair this guard with it:
// @UseGuards(JwtAuthGuard, ClientContextGuard, RolesGuard).
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.get<string[]>('roles', ctx.getHandler());
    if (!required) return true;
    const req = ctx.switchToHttp().getRequest();
    const role = req.membershipRole;
    if (!role || !required.includes(role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}

// Gate platform-admin endpoints (client + membership management). Independent
// of per-client roles — checks the is_super_admin flag set on req.user by the
// JWT strategy. Use WITHOUT ClientContextGuard (these endpoints are not scoped
// to a single client).
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest().user;
    if (!user?.isSuperAdmin) {
      throw new ForbiddenException('Super-admin only');
    }
    return true;
  }
}
