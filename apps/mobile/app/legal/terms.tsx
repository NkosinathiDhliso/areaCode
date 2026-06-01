import { TERMS_OF_SERVICE } from '@area-code/shared/constants/legal-content'

import { LegalDocumentView } from '../../src/components/LegalDocumentView'

export default function TermsScreen() {
  return <LegalDocumentView doc={TERMS_OF_SERVICE} />
}
