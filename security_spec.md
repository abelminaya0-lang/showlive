# Security Specification — ShowLive RBAC & Cloud Sync

## 1. Data Invariants
1. Only the bootstrapped owner (`abelminaya0@gmail.com`, verified email) or users listed in `/admins/{uid}` may list `/clients`, create/edit/revoke client access, view earnings (`amountPaid`), list `/accessRequests`, or read `/accessLogs`.
2. A client may only enter `/userWorkspaces/{uid}` or record an entry in `/accessLogs/{logId}` if their Google email is verified AND `/clients/{email}` exists with `active == true` (or they are an Admin).
3. A client reading their own `/clients/{email}` document can NEVER list other clients' PII or mutate `active`, `amountPaid`, `currency`, `planName`, `email`, `createdAt`, or `createdBy`.
4. All writes require `request.auth.token.email_verified == true` and strict server timestamps (`request.time`) for `createdAt`, `updatedAt`, `requestedAt`, `lastLoginAt`, and `enteredAt`.
5. Every entity validates exact allowed keys (`hasAll` + `hasOnly`) and type/size bounds on both `create` and `update`.

## 2. Dirty Dozen Attack Payloads (All Must Fail with PERMISSION_DENIED)
1. Unauthenticated user tries to read `/clients/cliente@gmail.com`.
2. Non-admin authenticated user tries to `list` `/clients` to scrape client emails/earnings.
3. Non-admin client tries to `create` `/clients/hacker@gmail.com` with `active: true` to self-authorize.
4. Authorized client tries to `update` `/clients/{ownEmail}` changing `active: false -> true` or `amountPaid: 0` (must only allow login telemetry fields).
5. Authorized client tries to `update` `/clients/{ownEmail}` with an extra shadow field `isAdmin: true`.
6. User with `email_verified: false` spoofing `abelminaya0@gmail.com` attempts admin write on `/clients`.
7. Non-admin user tries to create `/admins/{uid}` to escalate privileges.
8. Unapproved user tries to create `/userWorkspaces/{uid}` without an active `/clients/{email}` record.
9. Authorized client A tries to read or overwrite `/userWorkspaces/{clientB_uid}`.
10. Client tries to create `/accessRequests/{uid}` with `status: "approved"` instead of `"pending"`.
11. Client tries to forge `/accessLogs/{logId}` with another user's `uid` or backdated `enteredAt`.
12. Client tries to inject a 1MB string into `clientName`, `notes`, or `activeBankId`.
