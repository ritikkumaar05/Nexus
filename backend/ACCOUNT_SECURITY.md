# Account Security

## Authentication Methods

Users can have Google Sign-In, email/password Sign-In, or both on the same `User` document.

- `authProvider` records the originating or linked provider.
- `googleId` means Google Sign-In is connected.
- `passwordHash` means email/password Sign-In and Forgot Password are enabled.
- Setting a password for a Google account does not remove `googleId`.

## Endpoints

- `GET /api/account/security`
- `POST /api/account/set-password`
- `POST /api/account/change-password`
- `POST /api/account/delete/request`
- `POST /api/account/delete/confirm`

All endpoints require a valid access token.

## Deletion Strategy

Account deletion uses hard delete.

The delete request first verifies the primary factor:

- Password accounts must provide the current password.
- Google-only accounts must provide a fresh Google ID token that matches the account `googleId` and email.

After primary-factor verification, the backend sends a single-use `account-delete` OTP to the account email. Confirmation requires the OTP and typed confirmation text. The confirm step locks the user with `deletedAt` before cleanup to prevent concurrent deletion races.

Cleanup invalidates sessions, account tokens, reset tokens, and OTPs. Owned workspaces and their child data are deleted. Shared-workspace membership and user-authored records are removed or detached where appropriate. The final `account.deleted` audit event is retained with hashed user metadata and `actor: null` so the deleted user row is not retained.
