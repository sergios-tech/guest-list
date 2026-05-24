import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { getJwtSecret } from '../../config/jwt.config';
import { User } from '../../entities/user.entity';

export interface JwtPayload {
  sub: string;
  email: string;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
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
      select: ['id', 'email', 'role'],
    });
    if (!u) throw new UnauthorizedException();
    // attached to request.user
    return { id: u.id, email: u.email, role: u.role };
  }
}
