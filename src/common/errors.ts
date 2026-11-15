import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import type { FastifyInstance } from "fastify";
import { ZodError, type ZodTypeAny, type z } from "zod";

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(400, "BAD_REQUEST", message, details);
  }

  static unauthorized(message = "Authentication required") {
    return new AppError(401, "UNAUTHORIZED", message);
  }

  static forbidden(message = "You do not have permission to perform this action") {
    return new AppError(403, "FORBIDDEN", message);
  }

  static notFound(message = "Resource not found") {
    return new AppError(404, "NOT_FOUND", message);
  }

  static conflict(message: string) {
    return new AppError(409, "CONFLICT", message);
  }

  static badGateway(message: string) {
    return new AppError(502, "UPSTREAM_ERROR", message);
  }
}

/** Parses untrusted input with a Zod schema and converts failures into a 400 AppError. */
export function parseOrThrow<S extends ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw AppError.badRequest("Invalid request", result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })));
  }
  return result.data;
}

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/** Maps every thrown error to a consistent JSON body. Internal details are never returned. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | AppError | ZodError, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(body(error.code, error.message, error.details));
    }

    if (error instanceof ZodError) {
      return reply.status(400).send(body("BAD_REQUEST", "Invalid request", error.issues));
    }

    const fastifyError = error as FastifyError;
    if (fastifyError.validation) {
      return reply.status(400).send(body("BAD_REQUEST", fastifyError.message, fastifyError.validation));
    }

    if (fastifyError.statusCode && fastifyError.statusCode < 500) {
      return reply.status(fastifyError.statusCode).send(
        body(fastifyError.code ?? "REQUEST_ERROR", fastifyError.message),
      );
    }

    request.log.error({ err: error }, "Unhandled error");
    return reply.status(500).send(body("INTERNAL_ERROR", "An unexpected error occurred"));
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send(body("NOT_FOUND", "Route not found"));
  });
}

function body(code: string, message: string, details?: unknown): ErrorBody {
  return details === undefined ? { error: { code, message } } : { error: { code, message, details } };
}
