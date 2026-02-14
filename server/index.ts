import { readFileSync } from "fs";
import { join } from "path";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";

const indexHtml = readFileSync(
  join(__dirname, "../client/index.html"),
  "utf-8"
);

/**
 * Lambda handler for React Router SPA application
 * Serves static assets from /build/client and returns index.html for client-side routing.
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  // Return index.html for all routes (SPA routing)
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
    body: indexHtml,
  };
};