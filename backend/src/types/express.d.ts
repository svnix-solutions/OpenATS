import type { AuthenticatedUser } from "../shared/auth/verify-token";

declare global {
  namespace Express {
    interface Request {
      // Kept in step with what authMiddleware actually puts here, rather than
      // restated — the two drifting is how `organizationId` would silently go
      // missing on a route.
      user: AuthenticatedUser;
    }
  }
}
