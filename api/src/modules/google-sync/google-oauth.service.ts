import {
  BadRequestException, Injectable, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { UserGoogleCredential } from '../../entities/user-google-credential.entity';
import { getGoogleClientId } from '../../config/google.config';
import { decrypt, encrypt } from './crypto.util';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];

// Same fallback strategy as JWT_SECRET (auth.module.ts): real value via env,
// dev placeholder only inside the container/dev shell.
function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v && v.trim()) return v.trim();
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env var ${name}`);
}

// Only the client id is centralised in config/google.config.ts — it is the one
// Google value shared with the auth/login flow (auth.service.ts), so it lives in
// one place to avoid drift. The secret, redirect URI, and state secret below are
// used ONLY by this Sheets-sync flow, so they stay local rather than bloating
// the shared config with sync-specific concerns.
function clientId():     string { return getGoogleClientId(); }
function clientSecret(): string { return env('GOOGLE_OAUTH_CLIENT_SECRET', 'dev-google-client-secret'); }
function redirectUri():  string {
  return env('GOOGLE_OAUTH_REDIRECT_URI', 'http://localhost:8080/api/google-sync/oauth/callback');
}
function stateSecret():  string { return env('GOOGLE_OAUTH_STATE_SECRET', env('JWT_SECRET', 'dev-secret')); }

/** Signed state payload — userId + nonce, HMAC'd so the callback can't be
 * tricked into binding someone else's Google account to my session. Standard
 * CSRF defence for OAuth authorization-code flow. */
interface StatePayload { userId: string; nonce: string; ts: number }

function signState(payload: StatePayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', stateSecret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verifyState(token: string): StatePayload {
  const parts = token.split('.');
  if (parts.length !== 2) throw new BadRequestException('Invalid OAuth state');
  const [body, mac] = parts;
  const expected = createHmac('sha256', stateSecret()).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new BadRequestException('OAuth state signature mismatch');
  }
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload;
  // 10-minute window — generous for slow consent screens, short enough that
  // a leaked URL can't be replayed days later.
  if (Date.now() - payload.ts > 10 * 60 * 1000) {
    throw new BadRequestException('OAuth state expired — please retry');
  }
  return payload;
}

@Injectable()
export class GoogleOauthService {
  constructor(
    @InjectRepository(UserGoogleCredential)
    private readonly repo: Repository<UserGoogleCredential>,
  ) {}

  private newClient(): OAuth2Client {
    return new google.auth.OAuth2(clientId(), clientSecret(), redirectUri());
  }

  /** Build the consent URL we send the user to.
   * - access_type=offline → Google issues a refresh token in addition to the access token.
   * - prompt=select_account+consent → always show Google's account-chooser modal AND the
   *   consent screen, even when the user has just one Google session active and has
   *   consented before. Without `consent`, re-connect after a disconnect silently fails
   *   because Google only returns a refresh_token on first consent. */
  buildAuthUrl(userId: string): string {
    const oauth = this.newClient();
    return oauth.generateAuthUrl({
      access_type: 'offline',
      prompt: 'select_account consent',
      scope: SCOPES,
      state: signState({ userId, nonce: randomBytes(8).toString('hex'), ts: Date.now() }),
      include_granted_scopes: true,
    });
  }

  /** Exchange the OAuth code for tokens, fetch the connected Google email, and
   * persist the refresh token encrypted. Returns the user id the state binds to. */
  async handleCallback(code: string, state: string): Promise<{ userId: string; googleAccount: string | null }> {
    const { userId } = verifyState(state);
    const oauth = this.newClient();
    const { tokens } = await oauth.getToken(code);
    const refreshToken = tokens.refresh_token;
    if (!refreshToken) {
      // Defensive: with prompt=consent we should always get one, but if the
      // user revoked + reconnected without prompt=consent we'd hit this.
      throw new BadRequestException(
        'Google did not return a refresh token — disconnect from Google Account permissions and retry.',
      );
    }
    oauth.setCredentials(tokens);

    let googleAccount: string | null = null;
    try {
      const info = await google.oauth2({ version: 'v2', auth: oauth }).userinfo.get();
      googleAccount = info.data.email ?? null;
    } catch {
      // userinfo scope isn't requested; some accounts return id without email.
      // Email is display-only, so we don't fail the connect on this.
    }

    const sealed = encrypt(refreshToken);
    await this.repo.save({
      userId,
      refreshTokenEnc: sealed.ciphertext,
      refreshTokenIv: sealed.iv,
      refreshTokenTag: sealed.tag,
      googleAccount,
    });
    return { userId, googleAccount };
  }

  /** Load encrypted refresh token, decrypt, and return an OAuth2Client ready to
   * drive the Sheets API. google-auth-library automatically refreshes the
   * short-lived access token in the background using the refresh token. */
  async getAuthorizedClient(userId: string): Promise<OAuth2Client> {
    const row = await this.repo.findOne({ where: { userId } });
    if (!row) throw new NotFoundException('Google not connected');
    const refreshToken = decrypt({
      ciphertext: row.refreshTokenEnc,
      iv: row.refreshTokenIv,
      tag: row.refreshTokenTag,
    });
    const oauth = this.newClient();
    oauth.setCredentials({ refresh_token: refreshToken });
    return oauth;
  }

  async getConnection(userId: string): Promise<UserGoogleCredential | null> {
    return this.repo.findOne({ where: { userId } });
  }

  async disconnect(userId: string): Promise<void> {
    await this.repo.delete({ userId });
  }
}
