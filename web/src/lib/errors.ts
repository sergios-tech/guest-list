import type { AxiosError } from 'axios';
import type { TFunction } from 'i18next';

interface ApiErrorBody {
  code?: string;
  message?: string | string[];
  statusCode?: number;
}

// Translate an axios error into a user-facing message. The API attaches a
// stable `code` to validation failures (see InvitationsService.rethrowDbError);
// when present, we look up `errors.<CODE>` so messages are localised. Falls
// back to the server's plain message, then to a generic key.
export function apiErrorMessage(err: unknown, t: TFunction): string {
  const axErr = err as AxiosError<ApiErrorBody> | undefined;
  const body = axErr?.response?.data;
  if (body?.code) {
    const key = `errors.${body.code}`;
    const translated = t(key);
    if (translated !== key) return translated;
  }
  if (typeof body?.message === 'string') return body.message;
  if (Array.isArray(body?.message)) return body.message.join('; ');
  return t('errors.GENERIC');
}

// Pull the HTTP status off an axios error, if any. Centralised so call sites
// (Login, InvitationDetail, …) don't each hand-roll the
// `(err as { response?: { status?: number } })` cast.
export function apiErrorStatus(err: unknown): number | undefined {
  return (err as AxiosError<ApiErrorBody> | undefined)?.response?.status;
}
