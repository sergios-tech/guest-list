import {
  CanActivate, ExecutionContext, Injectable, SetMetadata,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';

export const JwtAuthGuard = AuthGuard('jwt');

export const Roles = (...roles: Array<'OWNER' | 'EDITOR' | 'VIEWER'>) =>
  SetMetadata('roles', roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.get<string[]>('roles', ctx.getHandler());
    if (!required) return true;
    const user = ctx.switchToHttp().getRequest().user;
    if (!user || !required.includes(user.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
