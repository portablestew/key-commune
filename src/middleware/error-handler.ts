import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Global error handler for Fastify - works with both HTTP and HTTPS servers
 */
export function errorHandler(
  error: FastifyError,
  request: FastifyRequest<any, any, any, any, any, any, any>,
  reply: FastifyReply<any, any, any, any, any, any, any>
): void {
  // Log error
  request.log.error({
    err: error,
    url: request.url,
    method: request.method,
  }, 'Request error');

  // Handle specific error types
  if (error.validation) {
    reply.status(400).send({
      error: 'Bad Request',
      message: 'Invalid request parameters',
      details: error.validation,
    });
    return;
  }

  // Handle not found
  if (error.statusCode === 404) {
    reply.status(404).send({
      error: 'Not Found',
      message: 'The requested resource was not found',
    });
    return;
  }

  // Handle unauthorized
  if (error.statusCode === 401) {
    reply.status(401).send({
      error: 'Unauthorized',
      message: 'Authentication required',
    });
    return;
  }

  // Handle rate limiting
  if (error.statusCode === 429) {
    reply.status(429).send({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded',
    });
    return;
  }

  // Default to 500 Internal Server Error
  const statusCode = error.statusCode || 500;
  reply.status(statusCode).send({
    error: 'Internal Server Error',
    message: statusCode === 500 ? 'An unexpected error occurred' : error.message,
  });
}

/**
 * Send error response - works with both HTTP and HTTPS servers
 */
export function sendError(
  reply: FastifyReply<any, any, any, any, any, any, any>,
  statusCode: number,
  error: string,
  message: string
): void {
  reply.status(statusCode).send({
    error,
    message,
  });
}