import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

export interface AiSystemConfig {
  env: 'development' | 'production' | 'test';
  databaseUrl: string;
  databaseUrlUnpooled: string;
  neonBranch: string;
  geminiApiKey?: string;
  maxExecutionTimeMs: number;
  maxTokensPerTask: number;
  confidenceThreshold: number;
  safetyStrictness: 'high' | 'medium' | 'low';
}

export const config: AiSystemConfig = {
  env: (process.env.NODE_ENV as 'development' | 'production' | 'test') || 'development',
  databaseUrl: process.env.DATABASE_URL || '',
  databaseUrlUnpooled: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || '',
  neonBranch: process.env.NEON_BRANCH || 'production',
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.NEO_API_KEY,
  maxExecutionTimeMs: 30000, // 30s timeout per reasoning task
  maxTokensPerTask: 4000,
  confidenceThreshold: 0.70, // Below this is flagged as a Knowledge Gap
  safetyStrictness: 'high',
};
