import { readFileSync } from "fs";
import { join } from "path";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";

const indexHtml = readFileSync(join(__dirname, "index.html"), "utf-8");

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: indexHtml,
  };
};