import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import * as bcrypt from 'bcrypt';
import { User } from '../../entities/user.entity';
import { UserClient } from '../../entities/user-client.entity';
import { getGoogleClientId } from '../../config/google.config';

@Injectable()
export class AuthService {
  // Resolved lazily on first Google login, NOT in a field initializer.
  // getGoogleClientId() throws in prod when GOOGLE_OAUTH_CLIENT_ID is unset;
  // reading it at construction would make that throw abort app BOOT — taking
  // down password login and all CRUD because an *optional* feature's config is
  // missing. Deferring keeps the rest of the app bootable and lets the failure
  // surface loudly on /auth/google instead (see resolveGoogleClient usage). The
  // OAuth2Client is memoised so google-auth-library's signing-cert cache is
  // shared across requests.
  private googleClientId?: string;
  private googleClient?: OAuth2Client;

  private resolveGoogleClient(): { client: OAuth2Client; clientId: string } {
    if (!this.googleClient || !this.googleClientId) {
      this.googleClientId = getGoogleClientId();
      this.googleClient = new OAuth2Client(this.googleClientId);
    }
    return { client: this.googleClient, clientId: this.googleClientId };
  }

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserClient) private readonly memberships: Repository<UserClient>,
    private readonly jwt: JwtService,
  ) {}

  async register(
    email: string,
    password: string,
    displayName: string,
    role: 'OWNER' | 'EDITOR' | 'VIEWER',
    locale: 'en' | 'sr' = 'sr',
  ) {
    const existing = await this.users.findOne({ where: { email } });
    if (existing) throw new ConflictException('Email already in use');
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.users.save(this.users.create({
      email, passwordHash, displayName, role, locale,
    }));
    // A super-admin is provisioning someone else's account — return the user
    // view, NOT a token (we are not logging the new user in). Client membership
    // is granted separately via the clients admin module.
    return this.buildUserView(user);
  }

  async login(email: string, password: string) {
    const user = await this.users.findOne({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    return this.issueToken(user);
  }

  // Sign in with a Google ID token (issued in the browser by Google Identity
  // Services). We verify the token's signature/exp/issuer/audience against
  // Google's published keys, then match the verified email to an EXISTING
  // app_user. Policy is "existing users only": an unknown email is rejected
  // rather than auto-provisioned, so this never writes to app_user and the
  // invite-only model is preserved. (To allow self-signup later, swap the
  // `if (!user) throw` below for a find-or-create guarded by an allowlist.)
  async loginWithGoogle(idToken: string) {
    // EVERY failure path below throws the SAME generic 401. Distinct messages
    // (bad-token vs unverified vs no-account) would be an account-enumeration
    // oracle: anyone holding a valid Google token could probe which emails are
    // provisioned. The UI turns this single 401 into a helpful "ask the owner"
    // hint client-side; the server stays opaque.
    // Resolve config OUTSIDE the try so a misconfigured deploy (missing client
    // id in prod) surfaces as a loud 500 on THIS endpoint rather than collapsing
    // into the generic 401 below — the 401 must mean "token/account rejected",
    // not "server misconfigured".
    const { client, clientId } = this.resolveGoogleClient();
    let payload: TokenPayload | undefined;
    try {
      const ticket = await client.verifyIdToken({ idToken, audience: clientId });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Invalid Google login');
    }
    if (!payload?.email || payload.email_verified !== true) {
      throw new UnauthorizedException('Invalid Google login');
    }
    // Mirror jwt.strategy's active-user filter so a soft-deleted (deactivated)
    // user can't log back in via Google. citext column → case-insensitive match.
    const user = await this.users.findOne({
      where: { email: payload.email, deletedAt: IsNull() },
    });
    if (!user) throw new UnauthorizedException('Invalid Google login');
    return this.issueToken(user);
  }

  private async issueToken(user: User) {
    const payload = { sub: user.id, email: user.email };
    return {
      accessToken: this.jwt.sign(payload),
      user: await this.buildUserView(user),
    };
  }

  // The user view returned on login and from /auth/me. `clients` is the list of
  // tenant memberships with the per-client role; the frontend uses it to build
  // the client selector and gate per-client actions.
  private async buildUserView(user: User) {
    const memberships = await this.memberships.find({
      where: { userId: user.id },
      relations: ['client'],
    });
    const clients = memberships
      .map((m) => ({ id: m.clientId, name: m.client?.name ?? '', role: m.role }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isSuperAdmin: user.isSuperAdmin,
      locale: user.locale,
      clients,
    };
  }

  // Re-fetch the current user + memberships (for GET /auth/me on reload).
  async me(userId: string) {
    const user = await this.users.findOne({ where: { id: userId, deletedAt: IsNull() } });
    if (!user) throw new UnauthorizedException();
    return this.buildUserView(user);
  }
}
