import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { ApiResponse } from '../api/types';

export type AuthResult = { userId: string } | { rejection: ApiResponse };

export type AuthMode = 'local' | 'auth0';

export interface AuthProvider {
  // Which credential the provider checks. Read this rather than process.env.AUTH_MODE, which the container never sets.
  mode: AuthMode;
  authenticate(event: APIGatewayProxyEventV2): Promise<AuthResult>;
  // Routes that need no session (local mode's login endpoints). Resolves to
  // undefined when the request is not one of them.
  handlePublic?(event: APIGatewayProxyEventV2): Promise<ApiResponse | undefined>;
}
