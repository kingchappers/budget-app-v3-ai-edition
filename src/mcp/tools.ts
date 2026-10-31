import { categoryDetailTool } from './tools/categoryDetail';
import { monthReviewTool } from './tools/monthReview';
import type { McpTool } from './types';

export const MCP_TOOLS: McpTool[] = [monthReviewTool, categoryDetailTool];
