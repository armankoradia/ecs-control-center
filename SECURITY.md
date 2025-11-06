# Security Documentation: Multi-User Credential Management

## Overview

This document explains how AWS Access Key and Secret Key credentials are handled in a multi-user deployment scenario.

## Current Architecture

### Frontend (Browser)
- **Storage Location**: Credentials are stored in browser `localStorage` (client-side only)
- **Isolation**: Each user's browser has its own isolated `localStorage` per origin
- **Persistence**: Credentials persist until explicitly cleared by the user
- **Transmission**: Credentials are sent to the backend with each API request

### Backend (Server)
- **Storage**: **NO server-side storage** - credentials are never persisted on the server
- **Usage**: Credentials are received per-request and used to create boto3 sessions
- **Session Lifecycle**: Each API request creates a new, independent boto3 session
- **Stateless**: The backend is completely stateless regarding credentials

## Multi-User Security Model

### ✅ What Works Well

1. **User Isolation**
   - Each user's browser maintains separate `localStorage`
   - User A's credentials are **completely isolated** from User B's credentials
   - No credential sharing between users

2. **Backend Statelessness**
   - Backend does not store credentials
   - Each request is independent
   - No risk of credential leakage between requests

3. **Session Independence**
   - Multiple users can use the application simultaneously
   - Each user's requests use their own credentials
   - No credential mixing or cross-contamination

### ⚠️ Security Considerations

1. **Shared Browser/Computer**
   - **Risk**: If multiple users share the same browser/computer, they can access each other's credentials
   - **Mitigation**: Users should not use shared computers or should clear credentials after use

2. **HTTPS Requirement**
   - **Risk**: Credentials are transmitted in API requests (query params or body)
   - **Mitigation**: **MUST use HTTPS in production** to encrypt credentials in transit

3. **Browser Extensions**
   - **Risk**: Malicious browser extensions could potentially access `localStorage`
   - **Mitigation**: Users should only install trusted browser extensions

4. **XSS Vulnerabilities**
   - **Risk**: Cross-site scripting attacks could steal credentials from `localStorage`
   - **Mitigation**: Follow secure coding practices, use Content Security Policy (CSP)

5. **No Automatic Expiration**
   - **Risk**: Credentials persist indefinitely until manually cleared
   - **Mitigation**: Users should periodically refresh credentials; the UI now shows credential age warnings

6. **Plain Text Storage**
   - **Risk**: Credentials are stored in plain text in `localStorage`
   - **Mitigation**: Browser `localStorage` is isolated per origin, but consider encryption for sensitive environments

## Best Practices

### For Users
1. ✅ Use personal devices/browsers only
2. ✅ Clear credentials after use on shared computers
3. ✅ Verify HTTPS is enabled before entering credentials
4. ✅ Regularly refresh/rotate credentials
5. ✅ Use temporary credentials (session tokens) when possible

### For Administrators
1. ✅ **Enforce HTTPS** in production deployments
2. ✅ Implement Content Security Policy (CSP)
3. ✅ Monitor for suspicious activity
4. ✅ Consider implementing session-based authentication for enhanced security
5. ✅ Educate users about credential security

## Implementation Details

### Credential Storage Keys
- `ecs-ak-id`: AWS Access Key ID
- `ecs-ak-secret`: AWS Secret Access Key
- `ecs-ak-token`: AWS Session Token (optional)
- `ecs-ak-*-ts`: Timestamps for credential age tracking

### API Request Flow
1. User enters credentials in frontend
2. Credentials saved to browser `localStorage`
3. Frontend sends credentials with each API request
4. Backend receives credentials, creates boto3 session
5. Backend performs AWS operation
6. Backend returns response (credentials not stored)
7. Credentials remain in browser `localStorage` for next request

### Session Management
- Each API endpoint receives credentials as parameters
- `get_boto3_session()` creates a new session per request
- Sessions are not cached or reused
- No server-side session state

## Security Recommendations for Production

### Short Term
1. ✅ Add security warning banner (implemented)
2. ✅ Add "Clear Credentials" button (implemented)
3. ✅ Show credential age warnings (implemented)
4. ✅ Ensure HTTPS is enforced

### Medium Term
1. Consider implementing client-side encryption for `localStorage`
2. Add automatic credential expiration (e.g., 24 hours)
3. Implement credential rotation reminders
4. Add audit logging for credential usage

### Long Term
1. Consider server-side session management with secure cookies
2. Implement OAuth2/OIDC for AWS authentication
3. Use AWS IAM Roles with temporary credentials
4. Implement role-based access control (RBAC)

## FAQ

**Q: Can User A see User B's credentials?**
A: No, each user's browser has isolated `localStorage`. However, if they share the same browser/computer, yes.

**Q: Are credentials stored on the server?**
A: No, the backend never persists credentials. They are used per-request only.

**Q: What happens if multiple users use the app simultaneously?**
A: Each user's requests use their own credentials independently. No interference.

**Q: Are credentials encrypted?**
A: Credentials are stored in plain text in `localStorage`. HTTPS encrypts them in transit.

**Q: How long do credentials persist?**
A: Until explicitly cleared by the user or browser data is cleared.

**Q: Should I use this on a shared computer?**
A: No, credentials should only be used on personal devices. Clear credentials after use on shared computers.

## Conclusion

The current implementation provides **user isolation** and **stateless backend** architecture, which works well for multi-user deployments. The main security considerations are:
- Shared browser/computer usage
- HTTPS requirement
- No automatic expiration

The UI now includes security warnings and credential management features to help users understand and manage these risks.

