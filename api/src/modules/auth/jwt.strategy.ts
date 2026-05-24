import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { getJwtSecret } from '../../config/jwt.config';

export interface JwtPayload {
  sub: string;
  email: string;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
    });
  }
  async validate(payload: JwtPayload) {
    // attached to request.user
    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}
