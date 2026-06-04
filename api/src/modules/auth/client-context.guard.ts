import {
  CanActivate, ExecutionContext, Injectable,
  BadRequestException, ForbiddenException, InternalServerErrorException,
  createParamDecorator,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserClient } from '../../entities/user-client.entity';

// Resolves the "current client" for tenant-scoped requests from the X-Client-Id
// header, then verifies the authenticated user has an active membership in that
// client. On success it stamps:
//   req.clientId        — the active tenant id (read via @CurrentClientId)
//   req.membershipRole  — the caller's role within that client (read by RolesGuard)
//
// Chosen over baking the client into the JWT so switching clients is stateless
// (no token reissue) and membership/role changes take effect immediately —
// mirroring why jwt.strategy re-reads the user on every request.
@Injectable()
export class ClientContextGuard implements CanActivate {
  constructor(
    @InjectRepository(UserClient)
    private readonly memberships: Repository<UserClient>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header = req.headers['x-client-id'];
    const clientId = Array.isArray(header) ? header[0] : header;
    if (!clientId) {
      throw new BadRequestException('Missing X-Client-Id header');
    }
    const membership = await this.memberships.findOne({
      where: { userId: req.user.id, clientId },
    });
    if (!membership) {
      // 403, not 404: don't reveal whether the client exists to non-members.
      throw new ForbiddenException('Not a member of this client');
    }
    req.clientId = clientId;
    req.membershipRole = membership.role;
    return true;
  }
}

// Inject the validated current client id into a handler param. Requires
// ClientContextGuard to have run first — throws if the guard was omitted.
export const CurrentClientId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const clientId: string | undefined = ctx.switchToHttp().getRequest().clientId;
    if (!clientId) {
      throw new InternalServerErrorException(
        'CurrentClientId used without ClientContextGuard (req.clientId is unset)',
      );
    }
    return clientId;
  },
);

// Convenience: inject the authenticated user id (replaces ad-hoc req.user.id).
export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string =>
    ctx.switchToHttp().getRequest().user.id,
);
