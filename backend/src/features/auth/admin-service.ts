import * as cognito from '../../shared/cognito/client.js'
import { AppError } from '../../shared/errors/AppError.js'

export async function adminOAuthSync(opts: { cognitoSub: string }) {
  const attrs = await cognito.getCognitoUserAttrsBySub('admin', opts.cognitoSub)
  if (!attrs) {
    throw AppError.unauthorized('Admin user not found in pool.')
  }

  const role = attrs['custom:admin_role'] ?? 'support_agent'

  return { adminId: opts.cognitoSub, role }
}

export async function adminLogin(email: string, password: string) {
  try {
    const tokens = await cognito.adminPasswordAuth(email, password)

    // Extract admin role from ID token claims
    const cognitoUser = await cognito.getCognitoUser('admin', email)
    const role = cognitoUser?.attributes['custom:admin_role'] ?? 'support_agent'
    const adminId = cognitoUser?.sub ?? ''

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      adminId,
      role,
    }
  } catch {
    throw AppError.unauthorized('Invalid credentials')
  }
}
