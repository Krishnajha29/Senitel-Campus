import type { Plugin } from 'vite';
import { LocalDatabase } from '../services/localDb.ts';
import type { Student } from '../types/index.ts';

/**
 * Vite Dev Server API Plugin for Student App Check-in Integration
 * Exposes:
 *  - POST /api/presence/check-in
 *  - GET  /api/presence/health
 */
export function presenceApiPlugin(): Plugin {
  return {
    name: 'sentinel-presence-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0];

        // CORS preflight and headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Student-Id');

        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }

        // Health check endpoint for student app connectivity test
        if (req.method === 'GET' && url === '/api/presence/health') {
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 200;
          res.end(
            JSON.stringify({
              status: 'online',
              service: 'Sentinel Campus Student Presence API',
              version: '1.0.0',
              timestamp: new Date().toISOString(),
            })
          );
          return;
        }

        // Student presence check-in endpoint
        if (req.method === 'POST' && url === '/api/presence/check-in') {
          let bodyStr = '';
          req.on('data', (chunk) => {
            bodyStr += chunk;
          });

          req.on('end', async () => {
            try {
              res.setHeader('Content-Type', 'application/json');

              // 1. Authenticate Request
              const authHeader = req.headers['authorization'] || '';
              const customStudentId = req.headers['x-student-id'] as string | undefined;

              let studentId: string | null = null;

              if (authHeader.startsWith('Bearer ')) {
                const token = authHeader.substring(7).trim();
                // If token is in student-XXX or valid format
                if (token.startsWith('stu_') || token.startsWith('stu-')) {
                  studentId = token;
                } else if (token) {
                  // Map token or resolve student
                  const allStudents = LocalDatabase.getStudents();
                  const found = allStudents.find((s: Student) => s.id === token || s.email === token);
                  if (found) {
                    studentId = found.id;
                  }
                }
              }

              // Fallback to explicit header if provided in local test environment
              if (!studentId && customStudentId) {
                studentId = customStudentId;
              }

              if (!studentId) {
                res.statusCode = 401;
                res.end(
                  JSON.stringify({
                    success: false,
                    code: 'UNAUTHORIZED',
                    message: 'Authentication required. Missing or invalid Bearer token.',
                  })
                );
                return;
              }

              // 2. Parse Body
              let body: any = {};
              try {
                body = bodyStr ? JSON.parse(bodyStr) : {};
              } catch {
                res.statusCode = 400;
                res.end(
                  JSON.stringify({
                    success: false,
                    code: 'BAD_REQUEST',
                    message: 'Invalid JSON request payload.',
                  })
                );
                return;
              }

              const presenceKey = body.presence_key;
              if (!presenceKey || typeof presenceKey !== 'string') {
                res.statusCode = 400;
                res.end(
                  JSON.stringify({
                    success: false,
                    code: 'INVALID_KEY',
                    message: 'Presence key code is required in request body.',
                  })
                );
                return;
              }

              // 3. Validate Check-in
              const result = await LocalDatabase.validateStudentCheckIn(presenceKey, studentId);

              if (!result.success) {
                if (result.code === 'RATE_LIMITED') {
                  res.statusCode = 429;
                } else if (result.code === 'NOT_ENROLLED') {
                  res.statusCode = 403;
                } else if (result.code === 'SESSION_CLOSED') {
                  res.statusCode = 410; // Gone / Closed
                } else if (result.code === 'UNAUTHENTICATED') {
                  res.statusCode = 401;
                } else {
                  res.statusCode = 404; // Invalid or expired key
                }
              } else {
                res.statusCode = 200; // Success or idempotent duplicate
              }

              res.end(JSON.stringify(result));
            } catch (err: any) {
              console.error('Server error handling presence check-in:', err);
              res.statusCode = 500;
              res.end(
                JSON.stringify({
                  success: false,
                  code: 'INTERNAL_SERVER_ERROR',
                  message: 'An unexpected internal error occurred.',
                })
              );
            }
          });
          return;
        }

        next();
      });
    },
  };
}
