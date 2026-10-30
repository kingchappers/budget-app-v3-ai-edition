import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { SECURITY_HEADERS } from '../api/constants';
import { err, ok, parseJsonObject } from '../api/http';
import type { ApiResponse } from '../api/types';
import { ConditionFailedError } from '../store';
import type { Store } from '../store';
import { clearedCookie, originAllowed, readSessionCookie, sessionCookie } from './cookies';
import {
  clearThrottle, createAccount, createSession, deleteAllSessions, deleteSession, getAccount, normaliseEmail,
  readSession, recordFailure, replacePassword, throttleRemaining,
} from './localData';
import { MAX_PASSWORD_LENGTH, dummyRecord, validatePassword, verifyPassword } from './password';
import { serialisedPasswordAttempt } from './passwordAttempts';
import type { SetupCode } from './setupCode';
import { revokeAllTokens } from './tokens';

export interface AuthRouteContext {
  store: Store;
  setupCode: SetupCode | undefined;
  // True while a password recovery is open: an account exists and setupCode can replace its password.
  recovery?: boolean;
  // Called once when the code has been spent, so the host can remove any copy of it.
  onCodeUsed?: () => void;
  secureCookie: boolean;
  appOrigin?: string;
  nowSeconds(): number;
}

const MAX_EMAIL_LENGTH = 254;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/;
const NO_STORE = { 'Cache-Control': 'no-store' };

function withCookie(response: ApiResponse, cookie: string): ApiResponse {
  return { ...response, headers: { ...response.headers, ...NO_STORE }, cookies: [cookie] };
}

function noStore(response: ApiResponse): ApiResponse {
  return { ...response, headers: { ...response.headers, ...NO_STORE } };
}

async function status(ctx: AuthRouteContext): Promise<ApiResponse> {
  return noStore(ok({ setupRequired: (await getAccount(ctx.store)) === undefined, recoveryOpen: ctx.recovery === true }));
}

type JsonBody = NonNullable<ReturnType<typeof parseJsonObject>>;

// Replaces the password on the existing account. The account's id, email and data are untouched.
function recover(body: JsonBody, ctx: AuthRouteContext, account: { userId: string; email: string }): Promise<ApiResponse> {
  return serialisedPasswordAttempt(() => attemptRecovery(body, ctx, account));
}

async function attemptRecovery(body: JsonBody, ctx: AuthRouteContext, account: { userId: string; email: string }): Promise<ApiResponse> {
  const code = ctx.setupCode;
  if (typeof body.code !== 'string' || !code?.matches(body.code)) return err(403, 'Invalid recovery code');
  const passwordProblem = validatePassword(body.password);
  if (passwordProblem) return err(400, passwordProblem);

  // Spend the code before the first await, so two simultaneous requests cannot both use it.
  code.clear();
  ctx.recovery = false;
  try {
    await deleteAllSessions(ctx.store);
    await revokeAllTokens(ctx.store);
    await replacePassword(ctx.store, body.password as string);
    await clearThrottle(ctx.store);
    const token = await createSession(ctx.store, account.userId, ctx.nowSeconds());
    return withCookie(ok({ userId: account.userId, email: account.email }), sessionCookie(token, ctx.secureCookie));
  } finally {
    ctx.onCodeUsed?.();
  }
}

async function setup(event: APIGatewayProxyEventV2, ctx: AuthRouteContext): Promise<ApiResponse> {
  const body = parseJsonObject(event);
  if (!body) return err(400, 'Request body must be a JSON object');

  const existing = await getAccount(ctx.store);
  if (existing) return ctx.recovery ? recover(body, ctx, existing) : err(409, 'This instance is already set up');
  if (typeof body.code !== 'string' || !ctx.setupCode?.matches(body.code)) return err(403, 'Invalid setup code');

  const { email, password } = body;
  if (typeof email !== 'string' || email.length > MAX_EMAIL_LENGTH || !EMAIL_SHAPE.test(email.trim())) {
    return err(400, 'A valid email address is required');
  }
  const passwordProblem = validatePassword(password);
  if (passwordProblem) return err(400, passwordProblem);

  try {
    const account = await createAccount(ctx.store, email, password as string);
    ctx.setupCode.clear();
    ctx.onCodeUsed?.();
    const token = await createSession(ctx.store, account.userId, ctx.nowSeconds());
    return withCookie(ok({ userId: account.userId, email: account.email }), sessionCookie(token, ctx.secureCookie));
  } catch (error) {
    if (error instanceof ConditionFailedError) return err(409, 'This instance is already set up');
    throw error;
  }
}

async function attemptLogin(event: APIGatewayProxyEventV2, ctx: AuthRouteContext): Promise<ApiResponse> {
  const body = parseJsonObject(event);
  if (!body) return err(400, 'Request body must be a JSON object');
  const { email, password } = body;
  if (typeof email !== 'string' || typeof password !== 'string') return err(400, 'Email and password are required');

  const now = ctx.nowSeconds();
  const wait = await throttleRemaining(ctx.store, now);
  if (wait > 0) {
    const limited = err(429, 'Too many attempts. Try again shortly.', { retryAfter: wait });
    return noStore({ ...limited, headers: { ...limited.headers, 'Retry-After': String(wait) } });
  }

  const invalid = async (): Promise<ApiResponse> => {
    await recordFailure(ctx.store, now);
    return noStore(err(401, 'Invalid email or password'));
  };

  // Bound the hashing cost and the input size before spending any of it.
  if (password.length > MAX_PASSWORD_LENGTH || email.length > MAX_EMAIL_LENGTH) return invalid();

  const account = await getAccount(ctx.store);
  // Always verify against some record, so an unknown email takes as long as a wrong password.
  let passwordMatches: boolean;
  try {
    passwordMatches = await verifyPassword(password, account ?? (await dummyRecord()));
  } catch (error) {
    // A stored record with unusable parameters cannot be verified, so it is a failed login. Log only the error message, never request data.
    console.error('Stored account password record could not be verified:', error instanceof Error ? error.message : String(error));
    return invalid();
  }
  if (!account || normaliseEmail(email) !== account.email || !passwordMatches) return invalid();

  await clearThrottle(ctx.store);
  const token = await createSession(ctx.store, account.userId, now);
  return withCookie(ok({ userId: account.userId, email: account.email }), sessionCookie(token, ctx.secureCookie));
}

function login(event: APIGatewayProxyEventV2, ctx: AuthRouteContext): Promise<ApiResponse> {
  return serialisedPasswordAttempt(() => attemptLogin(event, ctx));
}

async function logout(event: APIGatewayProxyEventV2, ctx: AuthRouteContext): Promise<ApiResponse> {
  await deleteSession(ctx.store, readSessionCookie(event, ctx.secureCookie));
  return withCookie(ok({}), clearedCookie(ctx.secureCookie));
}

async function me(event: APIGatewayProxyEventV2, ctx: AuthRouteContext): Promise<ApiResponse> {
  const session = await readSession(ctx.store, readSessionCookie(event, ctx.secureCookie), ctx.nowSeconds());
  const account = session ? await getAccount(ctx.store) : undefined;
  if (!session || !account) return noStore(err(401, 'Unauthorized'));
  return noStore(ok({ userId: session.userId, email: account.email }));
}

// A Map, not an object literal: a path like "/constructor" must not resolve to an inherited property.
const POST_ROUTES = new Map<string, (event: APIGatewayProxyEventV2, ctx: AuthRouteContext) => Promise<ApiResponse>>([
  ['/api/auth/setup', setup],
  ['/api/auth/login', login],
  ['/api/auth/logout', logout],
]);

const FORBIDDEN: ApiResponse = { statusCode: 403, headers: SECURITY_HEADERS, body: JSON.stringify({ error: 'Forbidden' }) };

// These are the only routes that answer without a session (the AUTH-05 exceptions).
export async function handleAuthRoute(event: APIGatewayProxyEventV2, ctx: AuthRouteContext): Promise<ApiResponse | undefined> {
  const method = event.requestContext.http.method;
  const path = event.rawPath;

  if (method === 'GET' && path === '/api/auth/status') return status(ctx);
  if (method === 'GET' && path === '/api/auth/me') return me(event, ctx);

  const handler = method === 'POST' ? POST_ROUTES.get(path) : undefined;
  if (!handler) return undefined;

  if (!originAllowed(event, ctx.appOrigin)) return FORBIDDEN;
  return handler(event, ctx);
}
