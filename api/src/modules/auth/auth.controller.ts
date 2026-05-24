import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { JwtAuthGuard, Roles, RolesGuard } from './jwt-auth.guard';

class LoginDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(6) password!: string;
}

class CreateUserDto extends LoginDto {
  @IsString() @MaxLength(120) displayName!: string;
  @IsIn(['OWNER', 'EDITOR', 'VIEWER']) role!: 'OWNER' | 'EDITOR' | 'VIEWER';
  @IsOptional() @IsIn(['en', 'sr']) locale?: 'en' | 'sr';
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Post('register')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  register(@Body() dto: CreateUserDto) {
    return this.auth.register(dto.email, dto.password, dto.displayName, dto.role, dto.locale);
  }
}
