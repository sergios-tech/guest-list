import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getJwtExpiresIn, getJwtSecret } from '../../config/jwt.config';
import { User } from '../../entities/user.entity';
import { UserClient } from '../../entities/user-client.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { ClientContextGuard } from './client-context.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserClient]),
    PassportModule,
    JwtModule.register({
      secret: getJwtSecret(),
      signOptions: { expiresIn: getJwtExpiresIn() },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, ClientContextGuard],
  exports: [AuthService, ClientContextGuard],
})
export class AuthModule {}
