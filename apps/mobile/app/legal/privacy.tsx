import { PRIVACY_POLICY } from '@area-code/shared/constants/legal-content'

import { LegalDocumentView } from '../../src/components/LegalDocumentView'

export default function PrivacyPolicyScreen() {
  return <LegalDocumentView doc={PRIVACY_POLICY} />
}
