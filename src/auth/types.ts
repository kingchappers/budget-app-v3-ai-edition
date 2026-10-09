import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { ApiResponse } from '../api/types';

export type AuthResult = { userId: string } | { rejection: ApiResponse };

export interface AuthProvider {
  authenticate(event: APIGatewayProxyEventV2): Promise<AuthResult>;
  // Routes that need no session (local mode's login endpoints). Resolves to
  // undefined when the request is not one of them.
  handlePublic?(event: APIGatewayProxyEventV2): Promise<ApiResponse | undefined>;
}
