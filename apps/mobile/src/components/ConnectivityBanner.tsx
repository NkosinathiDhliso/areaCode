import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useConnectivityStore } from '@area-code/shared/stores/connectivityStore'
import { colors } from '../theme'

export function ConnectivityBanner() {
  const { t } = useTranslation()
  const { state, lastUpdated } = useConnectivityStore()

  if (state === 'online') return null

  const relativeTime = lastUpdated
    ? `${Math.round((Date.now() - new Date(lastUpdated).getTime()) / 60000)}m`
    : ''

  return (
    <View style={[styles.banner, state === 'offline' ? styles.offline : styles.apiOnly]}>
      <Text style={[styles.text, state === 'offline' ? styles.offlineText : styles.apiOnlyText]}>
        {state === 'offline' ? t('offline.banner') : t('apiOnly.indicator')}
        {lastUpdated && state === 'offline' && ` · ${t('offline.lastUpdated', { time: relativeTime })}`}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  offline: { backgroundColor: 'rgba(239,68,68,0.2)' },
  apiOnly: { backgroundColor: 'rgba(245,158,11,0.2)' },
  text: { fontSize: 12, fontWeight: '500' },
  offlineText: { color: colors.danger },
  apiOnlyText: { color: colors.warning },
})
