import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { getJwtSecret } from '../../config/jwt.config';
import { User } from '../../entities/user.entity';

// Role is no longer carried in the token — it is now per-client and resolved
// from the user_client membership by ClientContextGuard on each request.
export interface JwtPayload {
  sub: string;
  email: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
    });
  }

  // Re-read the user on every request so role demotions, deletions, and
  // soft-deletes take effect immediately instead of within JWT_EXPIRES_IN
  // (default 12h). The lookup is a single PK select on app_user — well
  // under a millisecond — so a cache is not warranted at this scale.
  async validate(payload: JwtPayload) {
    const u = await this.users.findOne({
      where: { id: payload.sub, deletedAt: IsNull() },
      select: ['id', 'email', 'isSuperAdmin'],
    });
    if (!u) throw new UnauthorizedException();
    // attached to request.user. The per-client role is resolved later by
    // ClientContextGuard from the X-Client-Id header + user_client membership.
    return { id: u.id, email: u.email, isSuperAdmin: u.isSuperAdmin };
  }
}
